import { icon } from './icons.js';
import { S, esc, img, art, fmtTime, toast, playlist, histKey, afterPlayerClose } from './app.js';

// The video is served by the local ffmpeg gateway as a live fMP4 stream that starts at `offset`.
// So the absolute position is offset + video.currentTime, and the timeline comes from ffprobe.

let P = null;
export const isPlayerOpen = () => Boolean(P && !P.mini); // a minimized player leaves the app usable

const LANGS = { eng: 'English', en: 'English', hin: 'Hindi', hi: 'Hindi', ben: 'Bengali', bn: 'Bengali', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German', de: 'German', ita: 'Italian', chi: 'Chinese', zho: 'Chinese', rus: 'Russian', por: 'Portuguese', ara: 'Arabic', tur: 'Turkish', urd: 'Urdu', ind: 'Indonesian', tha: 'Thai', und: 'Unknown' };
const langName = (code) => (code ? LANGS[code.toLowerCase()] || code.toUpperCase() : 'Unknown');
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const $p = (sel) => document.querySelector(`#player ${sel}`);

function mediaUrl(path, params) {
  const q = new URLSearchParams({ t: S.media.token, ...params });
  return `http://127.0.0.1:${S.media.port}/${path}?${q}`;
}

/* ---------------- open / close ---------------- */
export async function openPlayer(post, item, startAt = 0) {
  if (P) await closePlayer(false);
  const root = document.getElementById('player');
  root.hidden = false;
  P = {
    post, list: playlist(post), item, info: null, offset: 0, duration: 0,
    audio: 0, sub: null, cues: [], subAbort: null, subFrom: 0, subTo: 0, subDone: false, external: [],
    mode: 'copy', rate: 1, lastSave: 0, nextQueued: false, upnextDismissed: false, uiTimer: null, raf: 0, panel: null,
    subSize: S.store.prefs.subSize || 'md', seekVisual: null, mini: false, watchAcc: 0, lastStatCT: null,
  };
  renderShell();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', syncFsIcon);
  await loadItem(item, startAt);
}

async function closePlayer(refresh = true) {
  if (!P) return;
  saveProgress(true);
  flushWatch();
  if (P.subAbort) P.subAbort.abort();
  cancelAnimationFrame(P.raf);
  clearTimeout(P.uiTimer);
  clearInterval(P.statsTimer);
  clearTimeout(P.upnextTimer);
  const v = $p('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // drops the HTTP request -> ffmpeg is killed
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('fullscreenchange', syncFsIcon);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const root = document.getElementById('player');
  root.hidden = true;
  root.innerHTML = '';
  root.className = 'player';
  P = null;
  if (refresh) await afterPlayerClose();
}

/* ---------------- shell ---------------- */
function renderShell() {
  const isSeries = P.post.type === 'series';
  document.getElementById('player').innerHTML = `
    <video id="pv" preload="auto"></video>
    <div class="p-cover" id="pCover"><img id="pCoverImg" src="${img(P.post.image || P.post.imageSm) || art(P.post.name || P.post.title || '')}" alt="">
      <div class="inner"><h2 id="pCoverTitle"></h2><p id="pCoverSub"></p></div></div>
    <div class="p-loading" id="pLoad" hidden><div class="spinner"></div></div>
    <div class="p-subs ${P.subSize}" id="pSubs"></div>
    <div class="p-ui">
      <div class="p-top">
        <button class="pbtn" data-a="close" title="Back (Esc)">${icon('back', 24)}</button>
        <button class="pbtn" data-a="mini" title="Minimize — keep watching while you browse (I)">${icon('pip', 22)}</button>
        <div class="t"><b id="pTitle"></b><span id="pSub"></span></div>
      </div>
      <div class="p-click" data-a="surface"></div>
      <div class="p-bottom">
        <div class="seek" id="seek">
          <div class="rail"><div class="buf" id="pBuf"></div><div class="fill" id="pFill"></div><div class="knob" id="pKnob"></div></div>
          <div class="hover-t" id="pHover">0:00</div>
        </div>
        <div class="p-row">
          <button class="pbtn big" data-a="toggle" id="pPlay" title="Play/Pause (Space)">${icon('play', 28)}</button>
          <button class="pbtn" data-a="back10" title="Back 10s (←)">${icon('rewind', 24)}</button>
          <button class="pbtn" data-a="fwd10" title="Forward 10s (→)">${icon('forward', 24)}</button>
          <div class="vol">
            <button class="pbtn" data-a="mute" id="pVolBtn" title="Mute (M)">${icon('volume', 24)}</button>
            <input type="range" id="pVol" min="0" max="1" step="0.01">
          </div>
          <span class="p-time" id="pTime">0:00 / 0:00</span>
          <span class="p-net" id="pNet" title="Download speed · how far ahead is cached"></span>
          <span class="spacer"></span>
          ${isSeries ? `<button class="pbtn" data-a="next" id="pNext" title="Next episode (N)">${icon('next', 24)}</button>
          <button class="pbtn" data-a="eps" title="Episodes">${icon('list', 24)}</button>` : ''}
          <button class="pbtn" data-a="tracks" id="pCC" title="Audio & Subtitles (C)">${icon('cc', 24)}</button>
          <button class="pbtn" data-a="speed" title="Playback speed">${icon('speed', 24)}</button>
          <button class="pbtn" data-a="fs" id="pFs" title="Fullscreen (F)">${icon('expand', 24)}</button>
        </div>
      </div>
    </div>
    <div id="pPanelHost"></div>
    <div id="pUpnext"></div>
    <div id="pErr"></div>
    <div class="p-mini"><div class="t" id="pMiniT"></div>
      <div class="tr"><button class="pbtn" data-m="expand" title="Expand">${icon('maximize2', 17)}</button><button class="pbtn" data-m="close" title="Close">${icon('x', 18)}</button></div>
      <div class="c"><button class="pbtn" data-m="toggle" id="pMiniPlay">${icon('pause', 24)}</button></div></div>
    <div class="p-minibar"><i id="pMiniFill"></i></div>`;

  const v = $p('video');
  v.volume = S.store.prefs.volume ?? 1;
  const vol = $p('#pVol');
  vol.value = v.volume;
  vol.style.setProperty('--v', `${v.volume * 100}%`);
  vol.oninput = () => { v.muted = false; v.volume = Number(vol.value); };

  v.addEventListener('playing', () => { $p('#pCover').classList.add('gone'); P.seekVisual = null; syncPlayIcon(); });
  v.addEventListener('pause', () => { syncPlayIcon(); showUi(); });
  v.addEventListener('play', syncPlayIcon);
  v.addEventListener('timeupdate', onTime);
  v.addEventListener('volumechange', onVolume);
  v.addEventListener('ended', () => { if (nextItem()) playNext(); else { saveProgress(true); closePlayer(); } });
  v.addEventListener('error', onVideoError);

  const root = document.getElementById('player');
  root.addEventListener('mousemove', showUi);
  root.addEventListener('click', onClick);
  root.addEventListener('dblclick', onDblClick);
  bindSeek();
  showUi();
  P.raf = requestAnimationFrame(tick);
  P.statsTimer = setInterval(pollStats, 1000);
}

function onDblClick(e) { if (P && !P.mini && e.target.closest('[data-a="surface"]')) toggleFs(); }

/* ---------------- mini player ---------------- */
function minimize() {
  if (!P || P.mini) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  closePanel();
  P.mini = true;
  const root = document.getElementById('player');
  root.classList.add('mini');
  root.classList.remove('ui', 'idle');
  saveProgress(true);
  afterPlayerClose(); // refresh progress bars on the page underneath
}

function expand() {
  if (!P || !P.mini) return;
  P.mini = false;
  document.getElementById('player').classList.remove('mini');
  showUi();
}

// Watch-time accounting for the profile page (content seconds actually played).
function flushWatch() {
  if (!P || P.watchAcc < 1) return;
  const post = P.post;
  const cats = post.ftp ? ['FTP Library'] : (post.categories || []).filter((c) => c.type === 'main' && c.name !== 'Featured Post').map((c) => c.name);
  window.cf.store.addWatch({ seconds: P.watchAcc, hour: new Date().getHours(), cats, name: post.name || post.title, imageSm: post.imageSm || post.image || '', postId: post.id, type: post.type });
  P.watchAcc = 0;
}

// Server-side read-ahead stats: how far ffmpeg has prepared the stream and how fast it downloads.
async function pollStats() {
  if (!P || !P.sid) return;
  const sid = P.sid;
  try {
    const s = await (await fetch(mediaUrl('stats', { sid }))).json();
    if (!P || P.sid !== sid || !s) return;
    const now = performance.now();
    if (P.netLast && s.bytes >= P.netLast.bytes) {
      const inst = ((s.bytes - P.netLast.bytes) / ((now - P.netLast.t) / 1000)) || 0;
      P.speed = P.speed == null ? inst : P.speed * 0.6 + inst * 0.4; // smoothed
    }
    P.netLast = { bytes: s.bytes, t: now };
    if (s.start != null && !P.startFixed) { P.startFixed = true; P.offset = s.start; } // copied video starts on a keyframe
    P.prepared = P.offset + s.preparedSec;
    P.prepDone = s.done;
    const ahead = Math.max(0, P.prepared - cur());
    const mbps = (P.speed || 0) / 1048576;
    $p('#pNet').innerHTML = s.local ? `${icon('circleCheck', 14)} Offline · playing from disk` : s.done
      ? `${icon('check', 14)} Fully cached`
      : `${icon('zap', 14)} ${mbps >= 0.1 ? mbps.toFixed(1) : '0.0'} MB/s <i></i> ${fmtTime(ahead)} cached`;
  } catch { /* stream switching; next poll catches up */ }
}

function updateSpinner(v, now) {
  if (!v.paused && v.currentTime !== P.lastCT) { P.lastCT = v.currentTime; P.lastAdv = now; }
  const stalled = !v.paused && now - (P.lastAdv || 0) > 700;
  const el = $p('#pLoad');
  if (el.hidden === stalled) el.hidden = !stalled;
}

/* ---------------- loading an item ---------------- */
async function loadItem(item, startAt) {
  flushWatch();
  const s = P;
  P.item = item;
  P.cues = []; P.sub = null; P.external = []; P.nextQueued = false; P.upnextDismissed = false; P.mode = 'copy';
  if (P.subAbort) P.subAbort.abort();
  $p('#pSubs').innerHTML = '';
  $p('#pUpnext').innerHTML = '';
  $p('#pErr').innerHTML = '';
  $p('#pCover').classList.remove('gone');
  const isSeries = P.post.type === 'series';
  const name = P.post.name || P.post.title;
  const sub = P.post.ftp ? (isSeries ? `#${item.episode + 1} · ${item.title}` : 'Direct FTP') : isSeries ? `S${item.season + 1} E${item.episode + 1} · ${item.title}` : [P.post.year, P.post.quality].filter(Boolean).join(' · ');
  $p('#pTitle').textContent = name;
  $p('#pSub').textContent = sub;
  $p('#pCoverTitle').textContent = name;
  $p('#pMiniT').textContent = isSeries ? `${name} · ${P.post.ftp ? '#' + (item.episode + 1) : `S${item.season + 1} E${item.episode + 1}`}` : name;
  $p('#pCoverSub').textContent = isSeries ? sub : 'Preparing stream…';
  const nb = $p('#pNext');
  if (nb) nb.style.display = nextItem() ? '' : 'none';

  try {
    P.info = await window.cf.probe(item.url);
  } catch (e) {
    if (s !== P) return;
    return showError(e.message || 'Could not open this file.');
  }
  if (s !== P) return;
  P.duration = P.info.duration || 0;

  // Default audio: remembered language > file default > first track.
  const prefs = S.store.prefs;
  const a = P.info.audio;
  const byLang = prefs.audioLang && a.find((t) => t.lang === prefs.audioLang);
  P.audio = (byLang || a.find((t) => t.isDefault) || a[0] || { index: 0 }).index;

  if (startAt > P.duration - 15) startAt = 0; // finished? start over
  startStream(startAt);

  // Default subtitle: remembered language, preferring non-forced tracks.
  if (prefs.subLang) {
    const cands = P.info.subs.filter((t) => t.supported && t.lang === prefs.subLang);
    const pick = cands.find((t) => !t.forced) || cands[0];
    if (pick) selectSub({ kind: 'emb', index: pick.index, lang: pick.lang }, false);
  }
  window.cf.siblingSubs(item.url).then((list) => {
    if (s !== P) return;
    P.external = list || [];
    if (!P.sub && prefs.subLang && P.external.length && !P.info.subs.some((t) => t.supported)) {
      selectSub({ kind: 'ext', url: P.external[0].url, lang: prefs.subLang }, false);
    }
  });
}

function startStream(t) {
  const v = $p('video');
  t = Math.max(0, Math.min(t, Math.max(0, P.duration - 2)));
  P.offset = t;
  P.seekVisual = t;
  P.sid = Math.random().toString(36).slice(2);
  P.netLast = null; P.speed = null; P.prepared = t; P.prepDone = false; P.startFixed = false; P.lastStatCT = null;
  setTimeout(pollStats, 350); setTimeout(pollStats, 800);
  P.lastAdv = performance.now(); P.lastCT = -1;
  $p('#pLoad').hidden = false;
  v.src = mediaUrl('stream', { url: P.item.url, start: t, audio: P.audio, mode: P.mode, sid: P.sid });
  v.defaultPlaybackRate = P.rate;
  v.playbackRate = P.rate;
  v.play().catch(() => {});
  if (P.sub && P.sub.kind === 'emb' && (t < P.subFrom + 12 || (!P.subDone && t > P.subTo + 5))) loadSubs(P.sub, Math.max(0, t - 12));
}

const cur = () => (P.seekVisual != null ? P.seekVisual : P.offset + ($p('video').currentTime || 0));

function seekTo(t) {
  const v = $p('video');
  t = Math.max(0, Math.min(t, P.duration - 1));
  const rel = t - P.offset;
  const b = v.buffered;
  for (let i = 0; i < b.length; i++) {
    if (rel >= b.start(i) && rel <= b.end(i) - 0.5) { v.currentTime = rel; return; }
  }
  startStream(t);
}

function onVideoError() {
  if (!P) return;
  const v = $p('video');
  if (!v.getAttribute('src')) return;
  const at = cur();
  if (P.mode === 'copy') {
    P.mode = 'transcode';
    toast('This video needs conversion — switching to compatibility mode');
    startStream(at);
    return;
  }
  showError('Playback failed. The file may be unavailable on the FTP server right now.');
}

function showError(msg) {
  expand();
  $p('#pLoad').hidden = true;
  $p('#pErr').innerHTML = `<div class="p-error">${icon('alert', 46)}<h2 style="margin:0">Can’t play this title</h2><p>${esc(msg)}</p>
    <div style="display:flex;gap:10px;justify-content:center"><button class="btn btn-primary btn-sm" data-a="retry">Try again</button><button class="btn btn-glass btn-sm" data-a="close">Close</button></div></div>`;
}

/* ---------------- progress / history ---------------- */
function nextItem() {
  const i = P.list.findIndex((x) => x.season === P.item.season && x.episode === P.item.episode);
  return i >= 0 ? P.list[i + 1] : null;
}

function entryFor(item, position, duration, completed) {
  const p = P.post;
  return {
    key: histKey(p.id, item), postId: p.id, type: p.type, name: p.name || p.title, image: p.image, imageSm: p.imageSm,
    quality: p.quality, year: p.year, season: item.season, episode: item.episode, epTitle: item.title, url: item.url,
    position, duration, completed,
  };
}

function saveProgress(force = false) {
  if (!P || !P.duration) return;
  const t = cur();
  const now = Date.now();
  if (!force && now - P.lastSave < 5000) return;
  if (t < 3) return;
  P.lastSave = now;
  const completed = t / P.duration > 0.94 || P.duration - t < 45;
  const e = entryFor(P.item, completed ? P.duration : t, P.duration, completed);
  window.cf.store.upsertHistory(e);
  S.store.history[e.key] = { ...e, updatedAt: now };
  const nx = completed && nextItem();
  if (nx && !P.nextQueued) { // queue the next episode so "Continue Watching" offers it
    P.nextQueued = true;
    const k = histKey(P.post.id, nx);
    if (!S.store.history[k] || S.store.history[k].completed) {
      const ne = entryFor(nx, 0, 0, false);
      setTimeout(() => window.cf.store.upsertHistory(ne), 50);
      S.store.history[k] = { ...ne, updatedAt: now + 50 };
    }
  }
}

function playNext() {
  const nx = nextItem();
  if (!nx) return;
  saveProgress(true);
  const h = S.store.history[histKey(P.post.id, nx)];
  loadItem(nx, h && !h.completed ? h.position : 0);
}

/* ---------------- subtitles ---------------- */
function selectSub(sel, remember = true) {
  if (P.subAbort) P.subAbort.abort();
  P.cues = [];
  P.sub = sel;
  $p('#pSubs').innerHTML = '';
  $p('#pCC').classList.toggle('on', Boolean(sel));
  if (remember) window.cf.store.setPrefs({ subLang: sel ? sel.lang || 'und' : null }), (S.store.prefs.subLang = sel ? sel.lang || 'und' : null);
  if (sel) loadSubs(sel, sel.kind === 'emb' ? P.offset : 0);
}

const parseTs = (s) => {
  const p = s.trim().split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

async function loadSubs(sel, from) {
  if (P.subAbort) P.subAbort.abort();
  const ac = new AbortController();
  P.subAbort = ac;
  const shift = sel.kind === 'emb' ? from : 0;
  P.subFrom = shift; P.subTo = shift; P.subDone = false;
  const url = sel.kind === 'emb'
    ? mediaUrl('subs', { url: P.item.url, start: from, track: sel.index })
    : mediaUrl('extsub', { url: sel.url });
  const seen = new Set(P.cues.map((c) => `${c.s.toFixed(2)}|${c.text}`));
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const flush = (final) => {
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = final ? '' : blocks.pop();
      for (const b of blocks) {
        const lines = b.split(/\r?\n/);
        const i = lines.findIndex((l) => l.includes('-->'));
        if (i < 0) continue;
        const [a, z] = lines[i].split('-->');
        const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
        if (!text) continue;
        const c = { s: parseTs(a) + shift, e: parseTs(z.trim().split(/\s+/)[0]) + shift, text };
        const key = `${c.s.toFixed(2)}|${c.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        P.cues.push(c);
        if (c.e > P.subTo) P.subTo = c.e;
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      flush(false);
    }
    flush(true);
    if (P && P.subAbort === ac) { P.subDone = true; P.cues.sort((x, y) => x.s - y.s); }
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not load subtitles', 'err');
  }
}

let lastSubText = '';
function tick() {
  if (!P) return;
  const t = cur();
  let text = '';
  if (P.sub) {
    const act = [];
    for (const c of P.cues) if (t >= c.s && t <= c.e) act.push(c.text);
    text = act.join('\n');
  }
  if (text !== lastSubText) {
    lastSubText = text;
    $p('#pSubs').innerHTML = text ? `<span>${esc(text)}</span>` : '';
  }
  if (P.seekVisual == null || $p('#seek').classList.contains('drag')) drawProgress();
  updateSpinner($p('video'), performance.now());
  P.raf = requestAnimationFrame(tick);
}

/* ---------------- time / UI sync ---------------- */
function drawProgress(at) {
  const d = P.duration || 1;
  const t = at ?? cur();
  const v = $p('video');
  $p('#pFill').style.width = `${(t / d) * 100}%`;
  $p('#pKnob').style.left = `${(t / d) * 100}%`;
  $p('#pMiniFill').style.width = `${(t / d) * 100}%`;
  // Cached range = what this stream has prepared so far (player buffer + server read-ahead).
  const b = v.buffered;
  const clientEnd = b.length ? P.offset + b.end(b.length - 1) : P.offset;
  const end = Math.min(d, P.prepDone ? d : Math.max(clientEnd, P.prepared || 0));
  $p('#pBuf').style.left = `${(P.offset / d) * 100}%`;
  $p('#pBuf').style.width = `${(Math.max(0, end - P.offset) / d) * 100}%`;
  $p('#pTime').textContent = `${fmtTime(t)} / ${fmtTime(P.duration)}`;
}

function onTime() {
  if (!P) return;
  const ct = $p('video').currentTime;
  if (P.lastStatCT != null) { const d = ct - P.lastStatCT; if (d > 0 && d < 2) P.watchAcc += d; }
  P.lastStatCT = ct;
  if (P.watchAcc >= 30) flushWatch();
  saveProgress();
  const left = P.duration - cur();
  const nx = nextItem();
  if (nx && !P.upnextDismissed && P.duration > 300 && left < 30 && !$p('#pUpnext').innerHTML) {
    $p('#pUpnext').innerHTML = `<div class="upnext"><small>Next episode</small><b>S${nx.season + 1} E${nx.episode + 1} · ${esc(nx.title)}</b>
      <div class="acts"><button class="btn btn-primary btn-sm" data-a="next"><i style="animation-duration:10s"></i>${icon('play', 14)} Play now</button>
      <button class="btn btn-glass btn-sm" data-a="dismiss">Watch credits</button></div></div>`;
    P.upnextTimer = setTimeout(() => { if (P && !P.upnextDismissed && $p('#pUpnext').innerHTML) playNext(); }, 10000);
  }
}

function onVolume() {
  const v = $p('video');
  const vol = v.muted ? 0 : v.volume;
  $p('#pVol').value = vol;
  $p('#pVol').style.setProperty('--v', `${vol * 100}%`);
  $p('#pVolBtn').innerHTML = icon(vol === 0 ? 'mute' : vol < 0.5 ? 'volumeLow' : 'volume', 24);
  clearTimeout(onVolume.t);
  onVolume.t = setTimeout(() => { window.cf.store.setPrefs({ volume: v.volume }); S.store.prefs.volume = v.volume; }, 500);
}

function syncPlayIcon() {
  const v = $p('video');
  if (v) { $p('#pPlay').innerHTML = icon(v.paused ? 'play' : 'pause', 28); $p('#pMiniPlay').innerHTML = icon(v.paused ? 'play' : 'pause', 24); }
}
function syncFsIcon() { const b = $p('#pFs'); if (b) b.innerHTML = icon(document.fullscreenElement ? 'shrink' : 'expand', 24); }

function showUi() {
  const root = document.getElementById('player');
  if (!P || P.mini) return;
  root.classList.add('ui');
  root.classList.remove('idle');
  clearTimeout(P.uiTimer);
  P.uiTimer = setTimeout(() => {
    const v = $p('video');
    if (P && v && !v.paused && !P.panel && !$p('#seek').classList.contains('drag')) {
      root.classList.remove('ui');
      root.classList.add('idle');
    }
  }, 3000);
}

function flash(name) {
  const el = document.createElement('div');
  el.className = 'flash';
  el.innerHTML = icon(name, 40);
  document.getElementById('player').append(el);
  setTimeout(() => el.remove(), 650);
}

function togglePlay() {
  const v = $p('video');
  if (v.paused) { v.play().catch(() => {}); flash('play'); } else { v.pause(); flash('pause'); }
}

function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* ---------------- seek bar ---------------- */
function bindSeek() {
  const seek = $p('#seek');
  const at = (e) => {
    const r = seek.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * P.duration;
  };
  seek.addEventListener('mousemove', (e) => {
    const t = at(e);
    const h = $p('#pHover');
    h.textContent = fmtTime(t);
    h.style.left = `${(t / (P.duration || 1)) * 100}%`;
  });
  seek.addEventListener('pointerdown', (e) => {
    if (!P.duration) return;
    seek.setPointerCapture(e.pointerId);
    seek.classList.add('drag');
    P.seekVisual = at(e);
    drawProgress(P.seekVisual);
    const move = (ev) => { P.seekVisual = at(ev); drawProgress(P.seekVisual); };
    const up = (ev) => {
      seek.removeEventListener('pointermove', move);
      seek.removeEventListener('pointerup', up);
      seek.classList.remove('drag');
      const t = at(ev);
      P.seekVisual = null;
      seekTo(t);
      showUi();
    };
    seek.addEventListener('pointermove', move);
    seek.addEventListener('pointerup', up);
  });
}

/* ---------------- panels ---------------- */
function openPanel(kind) {
  const host = $p('#pPanelHost');
  if (P.panel === kind) { closePanel(); return; }
  P.panel = kind;
  const ck = (on) => `<span class="ck">${on ? icon('check', 18) : ''}</span>`;
  if (kind === 'tracks') {
    const a = P.info ? P.info.audio : [];
    const s = P.info ? P.info.subs : [];
    const sub = P.sub;
    host.innerHTML = `<div class="p-panel">
      <div class="col"><h4>Audio</h4>
        ${a.length ? a.map((t) => `<button class="opt ${t.index === P.audio ? 'sel' : ''}" data-audio="${t.index}">${ck(t.index === P.audio)}${esc(langName(t.lang))}${t.title ? ` · ${esc(t.title)}` : ''}<small>${esc((t.codec || '').toUpperCase())} ${t.channels}ch</small></button>`).join('') : '<div class="opt" disabled>No audio tracks</div>'}
      </div>
      <div class="col"><h4>Subtitles</h4>
        <button class="opt ${!sub ? 'sel' : ''}" data-sub="off">${ck(!sub)}Off</button>
        ${s.map((t) => `<button class="opt ${sub && sub.kind === 'emb' && sub.index === t.index ? 'sel' : ''}" data-sub="emb:${t.index}" ${t.supported ? '' : 'disabled title="Image-based subtitles are not supported"'}>${ck(sub && sub.kind === 'emb' && sub.index === t.index)}${esc(langName(t.lang))}${t.title ? ` · ${esc(t.title)}` : ''}${t.forced ? ' (Forced)' : ''}<small>${t.supported ? '' : 'PGS'}</small></button>`).join('')}
        ${P.external.map((x, i) => `<button class="opt ${sub && sub.kind === 'ext' && sub.url === x.url ? 'sel' : ''}" data-sub="ext:${i}">${ck(sub && sub.kind === 'ext' && sub.url === x.url)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${esc(x.name)}</span><small>File</small></button>`).join('')}
        <div class="sizes">${['sm', 'md', 'lg'].map((z) => `<button class="chip ${P.subSize === z ? 'active' : ''}" data-size="${z}">${{ sm: 'Small', md: 'Medium', lg: 'Large' }[z]}</button>`).join('')}</div>
      </div></div>`;
  } else if (kind === 'speed') {
    host.innerHTML = `<div class="p-panel" style="min-width:200px"><div class="col"><h4>Speed</h4>
      ${SPEEDS.map((r) => `<button class="opt ${r === P.rate ? 'sel' : ''}" data-rate="${r}">${ck(r === P.rate)}${r === 1 ? 'Normal' : `${r}×`}</button>`).join('')}</div></div>`;
  } else if (kind === 'eps') {
    const items = P.list.filter((x) => x.season === P.item.season);
    host.innerHTML = `<div class="p-panel eps"><h4 style="margin:6px 12px">${esc(P.item.seasonName)}</h4>
      ${items.map((x) => {
        const h = S.store.history[histKey(P.post.id, x)];
        const on = x.episode === P.item.episode;
        return `<button class="opt ${on ? 'sel' : ''}" data-epi="${x.season}:${x.episode}">${ck(on)}<b style="width:34px">E${x.episode + 1}</b><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title)}</span>${h && h.duration ? `<div class="bar"><i style="width:${h.completed ? 100 : (h.position / h.duration) * 100}%"></i></div>` : ''}</button>`;
      }).join('')}</div>`;
    const sel = host.querySelector('.opt.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
  }
  showUi();
}

function closePanel() {
  if (!P) return;
  P.panel = null;
  $p('#pPanelHost').innerHTML = '';
}

/* ---------------- input ---------------- */
function onClick(e) {
  if (P && P.mini) { // mini player: its own three buttons, anything else expands
    const m = e.target.closest('[data-m]');
    const act = m && m.dataset.m;
    if (act === 'close') closePlayer();
    else if (act === 'toggle') { const v = $p('video'); if (v.paused) v.play().catch(() => {}); else v.pause(); }
    else expand();
    return;
  }
  const t = e.target;
  const a = t.closest('[data-a]');
  const act = a && a.dataset.a;
  if (t.closest('[data-audio]')) {
    const idx = Number(t.closest('[data-audio]').dataset.audio);
    if (idx !== P.audio) {
      P.audio = idx;
      const tr = P.info.audio.find((x) => x.index === idx);
      if (tr && tr.lang) { window.cf.store.setPrefs({ audioLang: tr.lang }); S.store.prefs.audioLang = tr.lang; }
      startStream(cur());
      toast(`Audio: ${langName(tr && tr.lang)}`);
    }
    return closePanel();
  }
  const sb = t.closest('[data-sub]');
  if (sb) {
    const v = sb.dataset.sub;
    if (v === 'off') selectSub(null);
    else if (v.startsWith('emb:')) { const tr = P.info.subs[Number(v.slice(4))]; selectSub({ kind: 'emb', index: tr.index, lang: tr.lang || 'und' }); }
    else { const x = P.external[Number(v.slice(4))]; selectSub({ kind: 'ext', url: x.url, lang: 'ext' }); }
    return closePanel();
  }
  const sz = t.closest('[data-size]');
  if (sz) {
    P.subSize = sz.dataset.size;
    $p('#pSubs').className = `p-subs ${P.subSize}`;
    window.cf.store.setPrefs({ subSize: P.subSize });
    S.store.prefs.subSize = P.subSize;
    P.panel = null; return openPanel('tracks');
  }
  const rt = t.closest('[data-rate]');
  if (rt) { P.rate = Number(rt.dataset.rate); $p('video').playbackRate = P.rate; $p('video').defaultPlaybackRate = P.rate; return closePanel(); }
  const ep = t.closest('[data-epi]');
  if (ep) {
    const [s, n] = ep.dataset.epi.split(':').map(Number);
    const item = P.list.find((x) => x.season === s && x.episode === n);
    closePanel();
    if (item && n !== P.item.episode) {
      saveProgress(true);
      const h = S.store.history[histKey(P.post.id, item)];
      loadItem(item, h && !h.completed ? h.position : 0);
    }
    return;
  }
  if (!act) return;
  const v = $p('video');
  switch (act) {
    case 'close': closePlayer(); break;
    case 'mini': minimize(); break;
    case 'surface': if (P.panel) closePanel(); else togglePlay(); break;
    case 'toggle': togglePlay(); break;
    case 'back10': seekTo(cur() - 10); break;
    case 'fwd10': seekTo(cur() + 10); break;
    case 'mute': v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; break;
    case 'next': clearTimeout(P.upnextTimer); playNext(); break;
    case 'dismiss': P.upnextDismissed = true; clearTimeout(P.upnextTimer); $p('#pUpnext').innerHTML = ''; break;
    case 'tracks': case 'speed': case 'eps': openPanel(act); break;
    case 'fs': toggleFs(); break;
    case 'retry': $p('#pErr').innerHTML = ''; loadItem(P.item, cur()); break;
  }
}

function onKey(e) {
  if (!P || P.mini) return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const v = $p('video');
  const k = e.key;
  const handled = () => { e.preventDefault(); e.stopPropagation(); showUi(); };
  if (k === ' ' || k === 'k') { handled(); togglePlay(); }
  else if (k === 'ArrowLeft' || k === 'j') { handled(); seekTo(cur() - 10); flash('rewind'); }
  else if (k === 'ArrowRight' || k === 'l') { handled(); seekTo(cur() + 10); flash('forward'); }
  else if (k === 'ArrowUp') { handled(); v.muted = false; v.volume = Math.min(1, v.volume + 0.05); }
  else if (k === 'ArrowDown') { handled(); v.volume = Math.max(0, v.volume - 0.05); }
  else if (k === 'm') { handled(); v.muted = !v.muted; }
  else if (k === 'f') { handled(); toggleFs(); }
  else if (k === 'n' && nextItem()) { handled(); playNext(); }
  else if (k === 'c') { handled(); openPanel('tracks'); }
  else if (k === 'i') { handled(); minimize(); }
  else if (k === 'Escape') {
    handled();
    if (P.panel) closePanel();
    else if (document.fullscreenElement) document.exitFullscreen();
    else closePlayer();
  }
}
