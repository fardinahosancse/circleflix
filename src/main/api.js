// Thin client for the CircleFTP catalog API (the same one new.circleftp.net uses).
const API = 'http://new.circleftp.net:5000/api';
const VIDEO_TYPES = new Set(['singleVideo', 'series']);

async function get(path) {
  const res = await fetch(API + path, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`CircleFTP API ${res.status} for ${path}`);
  return res.json();
}

const onlyVideos = (posts) => (posts || []).filter((p) => VIDEO_TYPES.has(p.type));

async function home() {
  const d = await get('/home-page/getHomePagePosts');
  return {
    latest: onlyVideos(d.latestPost),
    mostVisited: onlyVideos(d.mostVisitedPosts),
    categories: (d.categoryPosts || [])
      .map((c) => ({ id: c.id, name: c.name, posts: onlyVideos(c.posts) }))
      .filter((c) => c.posts.length),
  };
}

const categories = () => get('/categories');
const post = (id) => get(`/posts/${encodeURIComponent(id)}`);

async function posts({ category, sub, searchTerm, page = 1, limit = 30 } = {}) {
  const q = new URLSearchParams({ order: 'desc', page: String(page), limit: String(limit) });
  if (category) q.set('categoryExact', sub ? `${category},${sub}` : String(category));
  if (searchTerm) q.set('searchTerm', searchTerm);
  const d = await get(`/posts?${q}`);
  return { posts: onlyVideos(d.posts), pagination: d.pagination || null };
}

// Media files live on h5ai/Apache index servers; subtitle files often sit next to the video.
async function siblingSubtitles(fileUrl) {
  assertMediaUrl(fileUrl);
  const dir = fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1);
  const res = await fetch(dir, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const html = await res.text();
  const out = new Set();
  for (const m of html.matchAll(/href="([^"]+\.(?:srt|vtt|ass|ssa))"/gi)) {
    out.add(new URL(m[1], dir).href);
  }
  return [...out].map((url) => ({ url, name: decodeURIComponent(url.split('/').pop()) }));
}

// Trust boundary: only ever hand CircleFTP-hosted http(s) URLs to ffmpeg / fetch.
function assertMediaUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid media URL'); }
  if (!/^https?:$/.test(u.protocol) || !/(^|\.)circleftp\.net$/i.test(u.hostname)) {
    throw new Error('Media URL must be on circleftp.net');
  }
  return u.href;
}

/* ---------- Direct FTP library (h5ai index servers) ---------- */

// Only video sections of the site's "Direct Link" menu; apps/software/games are skipped.
const VIDEO_GROUPS = /^(Movies|TV Series|Indian TV Shows|Award Shows|WWE|Documentary)$/i;

async function ftpRoots() {
  const d = await get('/index-links');
  return (d.indexLinks || [])
    .filter((g) => VIDEO_GROUPS.test(g.name.trim()))
    .map((g) => ({
      name: g.name.trim(),
      items: (g.children && g.children.length ? g.children : [{ name: g.name, link: g.link }])
        .filter((c) => /^https?:/.test(c.link || ''))
        .map((c) => ({ name: c.name.trim(), url: c.link })),
    }))
    .filter((g) => g.items.length);
}

const listCache = new Map(); // url -> { at, items }
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

// h5ai renders a plain <table> fallback with icon / name / date / size columns.
async function ftpList(url) {
  url = assertMediaUrl(url);
  const hit = listCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.items;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  const html = await res.text();
  const items = [];
  for (const row of html.matchAll(/<tr>(.*?)<\/tr>/gs)) {
    const m = row[1].match(/alt="([^"]+)".*?href="([^"]+)">(.*?)<\/a>.*?fb-d">(.*?)<.*?fb-s">(.*?)</s);
    if (!m || m[1] === 'folder-parent') continue;
    const kb = parseInt(m[5], 10);
    const name = decodeEntities(m[3]);
    items.push({
      kind: m[1] === 'folder' ? 'folder' : 'file',
      name,
      ...cleanTitle(name),
      url: new URL(decodeEntities(m[2]), url).href,
      date: m[4].trim(),
      size: Number.isFinite(kb) ? kb * 1024 : 0,
    });
  }
  listCache.set(url, { at: Date.now(), items });
  return items;
}

// "100.Streets.2016.720p.BluRay" -> { title: "100 Streets", year: "2016" }
function cleanTitle(raw) {
  let s = raw.replace(/\.(mkv|mp4|avi|m4v|webm)$/i, '');
  let year = '';
  const re = /(?:^|[\s.(_\[-])((?:19|20)\d{2})(?=$|[\s.)_\]-])/g;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > 0) { year = m[1]; s = s.slice(0, m.index); break; }
  }
  s = s.replace(/[._]/g, ' ').replace(/\((?:TV|Mini).*$/i, '').replace(/\[[^\]]*\]/g, '')
    .replace(/\b(480|720|1080|2160)p\b.*$/i, '').replace(/[\s(\-–]+$/g, '').replace(/\s+/g, ' ').trim();
  return { title: s, year };
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const posterCache = new Map();

// Best-effort poster: find the catalog post whose name matches the folder title exactly.
function ftpPoster(rawName) {
  const { title, year } = cleanTitle(rawName);
  const key = `${norm(title)}|${year}`;
  if (!title || title.length < 2) return Promise.resolve(null);
  if (!posterCache.has(key)) {
    posterCache.set(key, posts({ searchTerm: title, limit: 10 }).then(({ posts: list }) => {
      const same = list.filter((p) => norm(p.name) === norm(title));
      const p = same.find((x) => !year || x.year === year) || same[0];
      return p ? { id: p.id, name: p.name, image: p.image, imageSm: p.imageSm, metaData: p.metaData || '', year: p.year, quality: p.quality, type: p.type } : null;
    }).catch(() => { posterCache.delete(key); return null; }));
  }
  return posterCache.get(key);
}

module.exports = {
  home, categories, post, posts, siblingSubtitles, assertMediaUrl, ftpRoots, ftpList, ftpPoster, cleanTitle,
  IMAGE_BASE: 'http://new.circleftp.net:5000/uploads/',
};
