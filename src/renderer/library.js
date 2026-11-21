// FTP Library: browse the CircleFTP index servers ("Direct Link" menu) like a streaming catalog.
import { icon } from './icons.js';
import { S, esc, img, art, histKey, setCleanup, playPost } from './app.js';
import { openPlayer } from './player.js';
import { dlBtn, downloadMany } from './extras.js';

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|webm|mov|ts|wmv|flv)$/i;
const GENERIC = /^(?:(?:19|20)\d{2}(?:\s*&\s*before)?|season\s*\d+.*|s\d{1,2}\b.*|\d{3,4}p|part\s*\d+|vol(?:ume)?\.?\s*\d+|complete.*|specials?|extras?|ova|movies?)$/i;
const GROUP_ICON = { 'movies': 'film', 'tv series': 'tvSeries', 'indian tv shows': 'tv', 'award shows': 'award', 'wwe': 'trophy', 'documentary': 'globe' };

const enc = (url) => encodeURIComponent(url);
const href = (url) => `#/ftp/${enc(url)}`;
const lastSeg = (url) => decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || '');
// "…/Show (TV Series 2016)/Season 1 1080p/" -> "Show (TV Series 2016)" (title + poster come from the show folder)
const showName = (url) => {
  const segs = url.replace(/\/$/, '').split('/').map((x) => decodeURIComponent(x));
  let i = segs.length - 1;
  while (i > 3 && GENERIC.test(segs[i].trim())) i--;
  return segs[i];
};
const fmtSize = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b ? `${Math.round(b / 1048576)} MB` : '');
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

async function roots() {
  if (!S.ftpRoots) S.ftpRoots = await window.cf.ftpRoots();
  return S.ftpRoots;
}

function epLabel(name) {
  const m = name.match(/S(\d{1,2})[\s._-]*E(\d{1,3})/i) || name.match(/\b(\d{1,2})x(\d{2,3})\b/);
  const tag = m ? `S${Number(m[1])} E${Number(m[2])}` : '';
  const pretty = name.replace(VIDEO_EXT, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return { tag, pretty };
}

/* ---------- pseudo post (lets the player + history treat a folder like a catalog title) ---------- */
export async function loadFtpPost(url) {
  const [items, clean, poster] = await Promise.all([
    window.cf.ftpList(url), window.cf.ftpClean(showName(url)), window.cf.ftpPoster(showName(url)).catch(() => null),
  ]);
  return buildPost(url, items, clean, poster);
}

function buildPost(url, items, clean, poster) {
  const videos = items.filter((i) => i.kind === 'file' && VIDEO_EXT.test(i.name));
  const folder = lastSeg(url);
  const base = {
    id: `ftp:${url}`, title: folder, name: (poster && poster.name) || clean.title || folder, year: (poster && poster.year) || clean.year,
    image: poster ? poster.image : '', imageSm: poster ? poster.imageSm : '', metaData: poster ? poster.metaData : '',
    quality: (folder.match(/\b(2160p|1080p|720p|480p)\b/i) || [''])[0], ftp: true,
  };
  if (videos.length > 1) {
    return { ...base, type: 'series', content: [{ seasonName: folder, episodes: videos.map((v) => ({ title: epLabel(v.name).pretty, link: v.url })) }] };
  }
  return { ...base, type: 'singleVideo', content: videos[0] ? videos[0].url : '' };
}

/* ---------- roots ---------- */
export async function ftpRootsView(view) {
  const groups = await roots();
  view.innerHTML = `<div class="page">
    <div class="page-title"><h1>FTP Library</h1><span class="count">Browse every CircleFTP server folder directly</span></div>
    ${groups.map((g) => `<section class="srv-group">
      <h2>${icon(GROUP_ICON[g.name.toLowerCase()] || 'folder', 20)} ${esc(g.name)} <span>${g.items.length}</span></h2>
      <div class="srv-grid">${g.items.map((it) => {
        const u = new URL(it.url);
        return `<a class="srv" href="${href(it.url)}">
          <span class="srv-ic" style="--h:${hue(it.name)}">${icon(GROUP_ICON[g.name.toLowerCase()] || 'folder', 22)}</span>
          <span class="srv-t"><b>${esc(it.name)}</b><small>${icon('server', 12)} ${esc(u.hostname.split('.')[0])} · ${esc(decodeURIComponent(u.pathname))}</small></span>
          ${icon('chevR', 18)}
        </a>`;
      }).join('')}</div>
    </section>`).join('')}
  </div>`;
}

/* ---------- folder ---------- */
export async function ftpFolderView(view, url) {
  view.innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  const [items, groups] = await Promise.all([window.cf.ftpList(url), roots()]);
  const allRoots = groups.flatMap((g) => g.items);
  const root = allRoots.filter((r) => url.startsWith(r.url)).sort((a, b) => b.url.length - a.url.length)[0];
  const folderName = root && root.url === url ? root.name : lastSeg(url);
  const titleName = root && root.url === url ? root.name : showName(url);
  const folders = items.filter((i) => i.kind === 'folder');
  const videos = items.filter((i) => i.kind === 'file' && VIDEO_EXT.test(i.name));

  // breadcrumbs
  const crumbs = [`<a href="#/ftp">${icon('library', 14)} Library</a>`];
  if (root) {
    crumbs.push(`<a href="${href(root.url)}">${esc(root.name)}</a>`);
    const segs = url.slice(root.url.length).split('/').filter(Boolean);
    segs.forEach((s, i) => crumbs.push(`<a href="${href(root.url + segs.slice(0, i + 1).join('/') + '/')}">${esc(decodeURIComponent(s))}</a>`));
  }
  const crumbHtml = `<nav class="crumbs">${crumbs.join(icon('chevR', 14))}</nav>`;

  let html = '';
  if (videos.length) {
    const clean = await window.cf.ftpClean(titleName);
    const post = buildPost(url, items, clean, null);
    const totalSize = videos.reduce((s, v) => s + v.size, 0);
    html += `<div class="detail">
      <div class="detail-bg"><img id="fBg" src="${art(post.name)}" alt=""></div>
      <div class="detail-top" style="padding-top:calc(var(--top) + 20px)">
        <div class="detail-poster"><img id="fPoster" src="${art(post.name)}" alt=""></div>
        <div class="detail-info">
          ${crumbHtml}
          <h1 class="hero-title" id="fTitle">${esc(post.name)}</h1>
          <div class="meta">${[post.year, videos.length > 1 ? `${videos.length} episodes` : 'Movie', fmtSize(totalSize)].filter(Boolean).map(esc).join('<span class="dot"></span>')}
            ${post.quality ? `<span class="chip">${esc(post.quality)}</span>` : ''}<span class="chip accent">${icon('server', 12)} Direct FTP</span></div>
          ${titleName !== folderName ? `<div class="chips"><span class="chip accent">${icon('layers', 13)} ${esc(folderName)}</span></div>` : ''}
          <p class="hero-desc" id="fDesc" style="margin-top:18px">${esc(titleName)}</p>
          <div class="hero-actions"><button class="btn btn-primary" id="fPlay">${icon('play', 18)} Play</button>
            ${videos.length > 1 ? `<button class="btn btn-glass" id="fDlAll">${icon('download', 18)} Download all</button>` : `<span id="fDlOne"></span>`}</div>
        </div>
      </div>
      ${videos.length > 1 ? `<section class="episodes"><div class="ep-head"><h2>Episodes</h2></div><div class="ep-grid" id="fEps"></div></section>` : ''}
      ${folders.length ? `<section class="episodes"><div class="ep-head"><h2>Folders</h2></div><div id="fFolders"></div></section>` : ''}
    </div>`;
    view.innerHTML = html;
    let current = post;
    const list = () => (current.type === 'series' ? current.content[0].episodes.map((e, i) => ({ season: 0, episode: i, seasonName: folderName, title: e.title, url: e.link })) : [{ season: 0, episode: 0, seasonName: '', title: current.name, url: current.content }]);
    const renderEps = () => {
      const el = view.querySelector('#fEps');
      if (!el) return;
      el.innerHTML = videos.map((v, i) => {
        const { tag, pretty } = epLabel(v.name);
        const h = S.store.history[histKey(current.id, { season: 0, episode: i })];
        const pct = h && h.duration ? (h.completed ? 100 : (h.position / h.duration) * 100) : 0;
        return `<div class="ep" data-fep="${i}">
          <img src="${current.imageSm ? img(current.imageSm) : art(current.name)}" alt="">
          <span class="num">${i + 1}</span>
          <div class="tags"><span>${esc(tag || `#${i + 1}`)}</span>${v.size ? `<span>${fmtSize(v.size)}</span>` : ''}${h && h.completed ? `<span class="done">${icon('check', 12)} Watched</span>` : ''}</div>
          <div class="t">${esc(pretty)}</div>
          <span class="play-hint">${icon('play', 20)}</span>
          ${dlBtn(current, list()[i])}
          ${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
        </div>`;
      }).join('');
    };
    renderEps();
    const one = view.querySelector('#fDlOne');
    const paintOne = () => { if (one) one.innerHTML = dlBtn(current, list()[0], true); };
    paintOne();
    const all = view.querySelector('#fDlAll');
    if (all) all.onclick = () => downloadMany(current, list());
    view.querySelector('#fPlay').onclick = () => playPost(current);
    const eps = view.querySelector('#fEps');
    if (eps) eps.onclick = (e) => {
      const el = e.target.closest('[data-fep]'); if (!el) return;
      const item = list()[Number(el.dataset.fep)];
      const h = S.store.history[histKey(current.id, item)];
      openPlayer(current, item, h && !h.completed ? h.position : 0);
    };
    const last = Object.values(S.store.history).filter((h) => h.postId === post.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last && !last.completed) view.querySelector('#fPlay').innerHTML = `${icon('play', 18)} Resume${videos.length > 1 ? ` ${esc(epLabel(videos[last.episode] ? videos[last.episode].name : '').tag || `#${last.episode + 1}`)}` : ''}`;
    window.cf.ftpPoster(titleName).then((p) => {
      if (!p || !view.querySelector('#fPoster')) return;
      current = buildPost(url, items, clean, p);
      view.querySelector('#fPoster').src = img(p.image || p.imageSm);
      view.querySelector('#fBg').src = img(p.image || p.imageSm);
      if (p.name) view.querySelector('#fTitle').textContent = p.name;
      if (p.metaData) view.querySelector('#fDesc').textContent = p.metaData;
      renderEps();
      paintOne();
    }).catch(() => {});
    if (folders.length) renderFolders(view.querySelector('#fFolders'), folders, false);
    return;
  }

  view.innerHTML = `<div class="page">
    ${crumbHtml}
    <div class="page-title"><h1>${esc(folderName)}</h1><span class="count" id="fCount">${folders.length.toLocaleString()} folders</span>
      ${folders.length > 12 ? `<div class="actions">
        <label class="search ftp-filter">${icon('search', 16)}<input id="fFilter" type="search" placeholder="Filter this folder…" autocomplete="off" spellcheck="false"></label>
        <button class="btn btn-glass btn-sm" id="fSort">${icon('sort', 16)} <span>A–Z</span></button></div>` : ''}
    </div>
    <div id="fFolders"></div>
    ${!folders.length ? `<div class="empty"><div class="big">${icon('folderOpen', 34)}</div><h3>No videos here</h3><p>This folder has no playable files.</p></div>` : ''}
  </div>`;
  renderFolders(view.querySelector('#fFolders'), folders, true);
}

function renderFolders(host, folders, withTools) {
  const genericShare = folders.filter((f) => GENERIC.test(f.name.trim())).length / (folders.length || 1);
  const asChips = genericShare > 0.5;
  let sort = 'az';
  let query = '';
  let shown = 0;
  let list = [];
  const BATCH = 96;

  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 4 && queue.length) {
      const { el, f } = queue.shift();
      if (!el.isConnected) continue;
      active++;
      window.cf.ftpPoster(f.name).then((p) => {
        if (p && el.isConnected) {
          const im = el.querySelector('img');
          im.src = img(p.imageSm || p.image);
          el.classList.add('has-poster');
        }
      }).catch(() => {}).finally(() => { active--; pump(); });
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      if (en.target.id === 'fMore') { more(); continue; }
      queue.push({ el: en.target, f: list[Number(en.target.dataset.i)] });
    }
    pump();
  }, { root: document.getElementById('view'), rootMargin: '400px' });
  setCleanup(() => io.disconnect());

  const tile = (f, i) => {
    if (asChips) {
      return `<a class="ftile-chip" href="${href(f.url)}">${icon('folder', 20)}<span>${esc(f.name)}</span><small>${esc(f.date.slice(0, 10))}</small></a>`;
    }
    const tags = (f.name.match(/\b(2160p|1080p|720p|Dual Audio|Hindi|x265|HEVC|WEB-?DL|BluRay)\b/gi) || []).slice(0, 2);
    return `<a class="card ftile" data-i="${i}" href="${href(f.url)}" title="${esc(f.name)}">
      <div class="pic"><img src="${art(f.title || f.name)}" alt="" class="ok">
        ${/TV Series|Season|Mini-Series|Anime/i.test(f.name) ? '<span class="badge-s">S</span>' : ''}
        <span class="play-hint">${icon('folderOpen', 22)}</span></div>
      <h3>${esc(f.title || f.name)}</h3>
      <p class="sub">${esc([f.year, ...tags].filter(Boolean).join(' · ') || f.date.slice(0, 10))}</p>
    </a>`;
  };

  const more = () => {
    const grid = host.querySelector('.fgrid');
    const next = list.slice(shown, shown + BATCH);
    grid.insertAdjacentHTML('beforeend', next.map((f, k) => tile(f, shown + k)).join(''));
    if (!asChips) grid.querySelectorAll('.ftile:not([data-o])').forEach((el) => { el.dataset.o = '1'; io.observe(el); });
    shown += next.length;
    const m = host.querySelector('#fMore');
    if (m) { if (shown >= list.length) m.remove(); else io.observe(m); }
  };

  const render = () => {
    const q = query.toLowerCase();
    list = folders.filter((f) => !q || f.name.toLowerCase().includes(q));
    list.sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) : (a, b) => b.date.localeCompare(a.date));
    if (asChips && sort === 'az' && list.every((f) => /^(19|20)\d{2}/.test(f.name))) list.reverse(); // newest year first
    shown = 0;
    host.innerHTML = `<div class="${asChips ? 'fchips' : 'grid'} fgrid"></div>${list.length > BATCH ? '<div class="sentinel" id="fMore"><div class="spinner"></div></div>' : ''}`;
    const c = document.getElementById('fCount');
    if (c) c.textContent = `${list.length.toLocaleString()} ${list.length === 1 ? 'folder' : 'folders'}`;
    more();
  };
  render();

  if (withTools) {
    const fi = document.getElementById('fFilter');
    const fs = document.getElementById('fSort');
    let deb;
    if (fi) fi.oninput = () => { clearTimeout(deb); deb = setTimeout(() => { query = fi.value.trim(); render(); }, 200); };
    if (fs) fs.onclick = () => { sort = sort === 'az' ? 'new' : 'az'; fs.querySelector('span').textContent = sort === 'az' ? 'A–Z' : 'Newest'; render(); };
  }
}
