// Offline downloads: saves files to <Downloads>/Circle Download/<Title>/[<Season>/]<file>.
// Resumable (HTTP Range), two at a time, state persisted in the store.
const fs = require('fs');
const path = require('path');
const { assertMediaUrl } = require('./api');

const MAX_ACTIVE = 2;
const clean = (s) => String(s || '').replace(/[<>:"/\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120) || 'Untitled';

class Downloads {
  constructor(store, baseDir, notify) {
    this.store = store;
    this.baseDir = baseDir;
    this.notify = notify;
    this.active = new Map(); // url -> AbortController
    const items = this.items();
    for (const it of Object.values(items)) { // nothing survives a restart mid-transfer
      if (it.status === 'downloading' || it.status === 'queued') it.status = 'paused';
      it.speed = 0;
    }
  }

  items() { return this.store.data.downloads; }
  list() { return Object.values(this.items()).sort((a, b) => b.addedAt - a.addedAt); }

  localPath(url) {
    const it = this.items()[url];
    return it && it.status === 'done' && fs.existsSync(it.file) ? it.file : null;
  }

  add(meta) {
    const url = assertMediaUrl(meta.url);
    const existing = this.items()[url];
    if (existing) {
      if (existing.status === 'done' && !fs.existsSync(existing.file)) delete this.items()[url]; // file was deleted by hand
      else { if (['paused', 'error'].includes(existing.status)) this.resume(url); return existing; }
    }
    const fileName = clean(decodeURIComponent(new URL(url).pathname.split('/').pop()));
    const titleDir = clean(meta.name + (meta.year ? ` (${meta.year})` : ''));
    const dir = path.join(this.baseDir, titleDir, ...(meta.type === 'series' && meta.seasonName ? [clean(meta.seasonName)] : []));
    const it = {
      url, postId: meta.postId, name: meta.name, year: meta.year || '', type: meta.type, image: meta.image || '', imageSm: meta.imageSm || '',
      quality: meta.quality || '', season: meta.season || 0, episode: meta.episode || 0, seasonName: meta.seasonName || '', title: meta.title || meta.name,
      file: path.join(dir, fileName), size: 0, received: 0, speed: 0, status: 'queued', error: '', addedAt: Date.now(),
    };
    this.items()[url] = it;
    this.store.save();
    this.pump();
    this.notify(it);
    return it;
  }

  pump() {
    // oldest request first; a whole season added at once keeps episode order
    const order = Object.values(this.items()).sort((a, b) => a.addedAt - b.addedAt || a.season - b.season || a.episode - b.episode);
    for (const it of order) {
      if (this.active.size >= MAX_ACTIVE) break;
      if (it.status === 'queued' && !this.active.has(it.url)) this.run(it);
    }
  }

  async run(it) {
    const ac = new AbortController();
    this.active.set(it.url, ac);
    const part = it.file + '.part';
    let out;
    try {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const res = await fetch(it.url, { signal: ac.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
      if (res.status === 416) { have = 0; fs.rmSync(part, { force: true }); throw new Error('Restarting download'); }
      if (!res.ok) throw new Error(res.status === 404 ? 'File is no longer on the server' : `Server answered ${res.status}`);
      if (have && res.status !== 206) have = 0; // server ignored Range: start over
      const len = Number(res.headers.get('content-length')) || 0;
      it.size = have + len;
      it.received = have;
      it.status = 'downloading';
      it.error = '';
      out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let lastT = Date.now(), lastB = have, lastSave = Date.now();
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        it.received += chunk.length;
        const now = Date.now();
        if (now - lastT >= 700) {
          const inst = ((it.received - lastB) / (now - lastT)) * 1000;
          it.speed = it.speed ? it.speed * 0.6 + inst * 0.4 : inst;
          lastT = now; lastB = it.received;
          this.notify(it);
          if (now - lastSave > 5000) { lastSave = now; this.store.save(); }
        }
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      fs.renameSync(part, it.file);
      it.status = 'done'; it.speed = 0; it.doneAt = Date.now();
      if (!it.size) it.size = it.received;
    } catch (e) {
      if (out) out.destroy();
      it.speed = 0;
      if (it.status === 'removed') { fs.rmSync(part, { force: true }); }
      else if (ac.signal.aborted) it.status = 'paused';
      else {
        it.status = 'error';
        const host = new URL(it.url).hostname.split('.')[0];
        it.error = /fetch failed|ECONN|ETIMEDOUT|terminated|network/i.test(String(e.cause || e.message)) ? `Server "${host}" is not responding` : e.message;
      }
    }
    this.active.delete(it.url);
    this.store.save();
    if (it.status !== 'removed') this.notify(it);
    this.pump();
  }

  pause(url) {
    const it = this.items()[url];
    if (!it) return;
    const ac = this.active.get(url);
    if (ac) ac.abort(); else if (it.status === 'queued') { it.status = 'paused'; this.store.save(); this.notify(it); }
  }

  resume(url) {
    const it = this.items()[url];
    if (!it || it.status === 'done' || this.active.has(url)) return;
    it.status = 'queued'; it.error = '';
    this.store.save();
    this.notify(it);
    this.pump();
  }

  // Removes the entry and its file(s); empty title folders are cleaned up.
  remove(url) {
    const it = this.items()[url];
    if (!it) return;
    it.status = 'removed';
    const ac = this.active.get(url);
    if (ac) ac.abort();
    for (const f of [it.file, it.file + '.part']) { try { fs.rmSync(f, { force: true }); } catch { /* in use: left on disk */ } }
    for (let d = path.dirname(it.file); d.startsWith(this.baseDir) && d !== this.baseDir; d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
    delete this.items()[url];
    this.store.save();
    this.notify({ url, status: 'removed' });
  }
}

module.exports = { Downloads };
