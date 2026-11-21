// Local media gateway. CircleFTP files are mostly MKV with EAC3/AC3/DTS audio, several audio
// languages and embedded subtitles. Chromium can't decode those codecs nor switch MKV tracks,
// so ffmpeg remuxes on the fly: video copied (or transcoded when Chromium can't decode it),
// chosen audio track -> AAC stereo, output as fragmented MP4 that <video> plays progressively.
// Subtitle tracks are extracted separately as WebVTT and rendered by the player overlay.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { assertMediaUrl } = require('./api');

// Binaries: env override > bundled (ffmpeg-static / ffprobe-static) > PATH.
function bundled(pkg, pick) {
  try {
    const p = pick(require(pkg));
    const real = p && p.replace('app.asar', 'app.asar.unpacked');
    return real && fs.existsSync(real) ? real : null;
  } catch { return null; }
}
const FFMPEG = process.env.FFMPEG_PATH || bundled('ffmpeg-static', (m) => m) || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || bundled('ffprobe-static', (m) => m.path) || 'ffprobe';

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const HTTP_IN = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', '15000000'];

// Downloaded titles play from disk: main.js installs a resolver (remote url -> local file or null).
let localFor = () => null;
const setLocalResolver = (fn) => { localFor = fn; };
function source(url) {
  url = assertMediaUrl(url);
  const file = localFor(url);
  return file ? { src: file, pre: [], local: true } : { src: url, pre: HTTP_IN, local: false };
}

// Turn ffmpeg/ffprobe failures into something a viewer can act on.
function explain(url, stderr, err) {
  const host = new URL(url).hostname.split('.')[0];
  const s = String(stderr || '');
  if (err && err.code === 'ENOENT') return 'FFmpeg is missing. Reinstall CircleFlix, or install FFmpeg and add it to PATH.';
  if (/404|Not Found/i.test(s)) return 'This file is no longer on the server. It may have been moved or removed.';
  if (/403|Forbidden/i.test(s)) return `Server "${host}" refused access to this file.`;
  if ((err && err.killed) || /-138|-10060|-10061|timed out|Connection.*failed|refused|Network is unreachable|resolve host/i.test(s)) {
    return `Server "${host}" is not responding. It looks offline right now — other titles on different servers still work. Try again later.`;
  }
  if (/Invalid data|moov atom not found|EBML/i.test(s)) return 'This file looks damaged or incomplete on the server.';
  return 'Could not read this video from the FTP server.';
}

const probeCache = new Map();

function probe(url) {
  const { src, local } = source(url);
  const key = src;
  if (probeCache.has(key)) return probeCache.get(key);
  const p = new Promise((resolve, reject) => {
    execFile(FFPROBE, ['-v', 'error', ...(local ? [] : ['-rw_timeout', '12000000']), '-print_format', 'json', '-show_format', '-show_streams', src],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // FFprobe's own wording varies by version ("Unknown error"), so ask the server directly.
          if (local) return reject(new Error('The downloaded file could not be read. It may have been moved or deleted.'));
          return fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
            .then((r) => reject(new Error(explain(url, r.ok ? stderr : String(r.status), err))),
              () => reject(new Error(explain(url, 'Connection failed', err))));
        }
        let j;
        try { j = JSON.parse(stdout); } catch { return reject(new Error(explain(url, 'Invalid data'))); }
        const streams = j.streams || [];
        const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
        const lang = (s) => (s.tags && (s.tags.language || s.tags.LANGUAGE)) || '';
        const title = (s) => (s.tags && (s.tags.title || s.tags.TITLE)) || '';
        resolve({
          local,
          duration: Number(j.format && j.format.duration) || 0,
          video: v ? { codec: v.codec_name, width: v.width, height: v.height, pixFmt: v.pix_fmt || '', profile: v.profile || '' } : null,
          audio: streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
            index: i, codec: s.codec_name, lang: lang(s), title: title(s), channels: s.channels || 2,
            isDefault: Boolean(s.disposition && s.disposition.default),
          })),
          subs: streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => ({
            index: i, codec: s.codec_name, lang: lang(s), title: title(s),
            supported: TEXT_SUBS.has(s.codec_name),
            forced: Boolean(s.disposition && s.disposition.forced),
          })),
        });
      });
  });
  probeCache.set(key, p);
  p.catch(() => probeCache.delete(key));
  return p;
}

// Copied video can only start on a keyframe, so a seek to `t` really starts a little earlier.
// The player needs that real start time to keep the timeline and subtitles exact.
function keyframeAt({ src, pre }, t) {
  return new Promise((resolve) => {
    execFile(FFPROBE, ['-v', 'error', ...(pre.length ? ['-rw_timeout', '10000000'] : []), '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time', '-read_intervals', `${t}%+#1`, '-of', 'csv=p=0', src],
    { timeout: 15000, windowsHide: true }, (err, stdout) => {
      const k = parseFloat(String(stdout).trim().split(/\s+/)[0]);
      resolve(!err && Number.isFinite(k) && k <= t + 0.5 ? Math.max(0, k) : t);
    });
  });
}

// Chromium (Electron) decodes H.264 8-bit and, with GPU support on Windows, HEVC; everything
// else (10-bit H.264, MPEG-4 ASP/XviD, VC-1, ...) gets transcoded to H.264.
function videoArgs(info, forceTranscode) {
  const v = info.video;
  const tenBitH264 = v && v.codec === 'h264' && /10/.test(v.pixFmt + v.profile);
  if (!forceTranscode && v && v.codec === 'h264' && !tenBitH264) return ['-c:v', 'copy'];
  if (!forceTranscode && v && v.codec === 'hevc') return ['-c:v', 'copy', '-tag:v', 'hvc1'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:min(ih\\,1080)'];
}

// Read-ahead: Chromium only pulls a little ahead of the playhead, so ffmpeg output is queued in
// memory (bounded) and ffmpeg keeps downloading/remuxing ahead. The player shows this as "cached".
const READ_AHEAD_BYTES = 256 * 1024 * 1024;
const sessions = new Map(); // sid -> { start, preparedSec, bytes, queued, done }

function pipeFfmpeg(req, res, args, contentType, sid, stats) {
  if (sid) {
    sessions.set(sid, stats);
    args = [...args.slice(0, -1), '-progress', 'pipe:2', '-stats_period', '0.5', args[args.length - 1]];
  }
  const ff = spawn(FFMPEG, args, { windowsHide: true });
  let started = false;
  let ended = false;
  let waitingDrain = false;
  const queue = [];
  let queued = 0;
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });

  const pump = () => {
    waitingDrain = false;
    while (queue.length) {
      const c = queue.shift();
      queued -= c.length;
      if (!res.write(c)) { waitingDrain = true; res.once('drain', pump); break; }
    }
    if (stats) stats.queued = queued;
    if (queued < READ_AHEAD_BYTES && ff.stdout.isPaused()) ff.stdout.resume();
    if (ended && !queue.length && !waitingDrain) res.end();
  };
  ff.stdout.on('data', (c) => {
    started = true;
    queue.push(c);
    queued += c.length;
    if (stats) { stats.bytes += c.length; stats.queued = queued; }
    if (queued >= READ_AHEAD_BYTES) ff.stdout.pause();
    if (!waitingDrain) pump();
  });
  ff.stdout.on('end', () => { ended = true; if (stats) stats.done = true; if (!waitingDrain) pump(); });

  let err = '';
  ff.stderr.on('data', (d) => {
    const s = String(d);
    if (stats) {
      const m = s.match(/out_time_us=(\d+)/g);
      if (m) stats.preparedSec = Number(m[m.length - 1].split('=')[1]) / 1e6;
    }
    err = (err + s.replace(/^\w+=.*$/gm, '')).slice(-2000);
  });
  ff.on('error', (e) => { console.error('[ffmpeg]', e.message); res.destroy(); });
  ff.on('close', (code) => {
    if (code && !started) console.error('[ffmpeg] exited', code, err.trim());
    ended = true;
    if (!waitingDrain) pump();
  });
  const kill = () => {
    if (ff.exitCode === null) ff.kill('SIGKILL');
    if (sid) setTimeout(() => { if (sessions.get(sid) === stats) sessions.delete(sid); }, 30000);
  };
  req.on('close', kill);
  res.on('close', kill);
}

function startServer() {
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.searchParams.get('t') !== token) { res.writeHead(403).end(); return; }
      if (u.pathname === '/stats') {
        const s = sessions.get(u.searchParams.get('sid') || '');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(s || null));
        return;
      }
      const url = assertMediaUrl(u.searchParams.get('url') || '');
      const start = Math.max(0, Number(u.searchParams.get('start')) || 0);
      const ss = start.toFixed(3);
      const input = source(url);

      if (u.pathname === '/stream') {
        const info = await probe(url);
        const audio = Math.max(0, parseInt(u.searchParams.get('audio'), 10) || 0);
        const sid = (u.searchParams.get('sid') || '').slice(0, 40);
        const stats = { start: start > 0 ? null : 0, preparedSec: 0, bytes: 0, queued: 0, done: false, local: input.local };
        if (start > 0) keyframeAt(input, start).then((k) => { stats.start = k; });
        // -noaccurate_seek: video and audio both begin at the keyframe before `start`. With the
        // default accurate seek the transcoded audio begins later than the copied video, leaving
        // a gap at the head of the audio track that players collapse -> lips out of sync.
        const args = ['-hide_banner', '-loglevel', 'error', ...input.pre, '-noaccurate_seek', '-ss', ss, '-i', input.src,
          '-map', '0:v:0', '-map', `0:a:${audio}?`,
          ...videoArgs(info, u.searchParams.get('mode') === 'transcode'),
          '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-af', 'aresample=async=1', '-sn', '-dn', '-map_chapters', '-1',
          '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'];
        return pipeFfmpeg(req, res, args, 'video/mp4', sid, stats);
      }
      if (u.pathname === '/subs') { // embedded track; cue times are relative to `start`
        const track = Math.max(0, parseInt(u.searchParams.get('track'), 10) || 0);
        const args = ['-hide_banner', '-loglevel', 'error', ...input.pre, '-ss', ss, '-i', input.src,
          '-map', `0:s:${track}`, '-f', 'webvtt', 'pipe:1'];
        return pipeFfmpeg(req, res, args, 'text/vtt; charset=utf-8');
      }
      if (u.pathname === '/extsub') { // sidecar .srt/.ass/.vtt; cue times are absolute
        const args = ['-hide_banner', '-loglevel', 'error', '-i', url, '-f', 'webvtt', 'pipe:1'];
        return pipeFfmpeg(req, res, args, 'text/vtt; charset=utf-8');
      }
      res.writeHead(404).end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(e.message);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, token, server }));
  });
}

module.exports = { startServer, probe, setLocalResolver };
