// Watch history, My List and preferences, persisted as one JSON file in userData.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  history: {}, list: {}, downloads: {}, profile: null,
  stats: { seconds: 0, byHour: Array(24).fill(0), byCat: {}, byTitle: {}, byType: { movie: 0, series: 0 } },
  prefs: { volume: 1, audioLang: null, subLang: null, subSize: 'md', theme: 'dark' },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'circleflix-data.json');
    this.data = structuredClone(DEFAULTS);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw, prefs: { ...DEFAULTS.prefs, ...(raw.prefs || {}) }, stats: { ...this.data.stats, ...(raw.stats || {}) } };
    } catch { /* first run or unreadable: start fresh, keep the bad file untouched until next save */ }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file); // atomic replace: a crash mid-write never corrupts history
  }

  snapshot() { return this.data; }

  upsertHistory(entry) {
    if (!entry || !entry.key) return;
    this.data.history[entry.key] = { ...this.data.history[entry.key], ...entry, updatedAt: Date.now() };
    this.save();
  }

  removeHistory(keys) {
    for (const k of [].concat(keys)) delete this.data.history[k];
    this.save();
  }

  clearHistory() { this.data.history = {}; this.save(); }

  toggleList(item) {
    const id = String(item.id);
    if (this.data.list[id]) delete this.data.list[id];
    else this.data.list[id] = { ...item, addedAt: Date.now() };
    this.save();
    return Boolean(this.data.list[id]);
  }

  setProfile(p) {
    const name = String((p && p.name) || '').trim().slice(0, 40);
    if (!name) throw new Error('Name is required');
    const picture = typeof p.picture === 'string' && p.picture.startsWith('data:image/') && p.picture.length < 400000 ? p.picture : '';
    this.data.profile = { name, picture, createdAt: (this.data.profile && this.data.profile.createdAt) || Date.now() };
    this.save();
    return this.data.profile;
  }

  // Watch-time accounting for the profile page.
  addWatch({ seconds, hour, cats, name, imageSm, postId, type }) {
    seconds = Number(seconds);
    if (!(seconds > 0 && seconds < 3600)) return;
    const st = this.data.stats;
    st.seconds += seconds;
    st.byHour[Math.min(23, Math.max(0, hour | 0))] += seconds;
    st.byType[type === 'series' ? 'series' : 'movie'] += seconds;
    for (const c of (cats || []).slice(0, 4)) st.byCat[c] = (st.byCat[c] || 0) + seconds;
    if (name) {
      const t = st.byTitle[name] || (st.byTitle[name] = { sec: 0 });
      t.sec += seconds; t.imageSm = imageSm || t.imageSm || ''; t.postId = postId; t.type = type;
      const keys = Object.keys(st.byTitle);
      if (keys.length > 300) keys.sort((a, b) => st.byTitle[a].sec - st.byTitle[b].sec).slice(0, 50).forEach((k) => delete st.byTitle[k]);
    }
    this.save();
  }

  setPrefs(p) { this.data.prefs = { ...this.data.prefs, ...p }; this.save(); }
}

module.exports = { Store };
