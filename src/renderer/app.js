import { icon } from './icons.js';
import { openPlayer, isPlayerOpen } from './player.js';
import { ftpRootsView, ftpFolderView, loadFtpPost } from './library.js';
import { initExtras, applyTheme, downloadsView, profileView, profileDialog, renderAvatar, dlBtn, downloadMany } from './extras.js';

/* ---------------- state & helpers ---------------- */
export const S = { store: null, media: null, home: null, cats: null, posts: new Map(), downloads: {} };

const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const img = (name) => (name ? S.media.imageBase + encodeURIComponent(name) : '');
const titleOf = (p) => p.name || p.title || 'Untitled';

// Generated poster art for titles without catalog artwork (FTP folders).
const artCache = new Map();
export function art(title = '') {
  if (artCache.has(title)) return artCache.get(title);
  const h = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11);
  const initials = title.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 450'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h},68%,44%)'/><stop offset='1' stop-color='hsl(${(h + 50) % 360},72%,12%)'/></linearGradient></defs><rect width='300' height='450' fill='url(#g)'/><circle cx='250' cy='70' r='140' fill='white' opacity='.07'/><circle cx='40' cy='420' r='110' fill='black' opacity='.18'/><text x='150' y='262' font-family='Impact,Arial Black,sans-serif' font-size='128' fill='white' fill-opacity='.92' text-anchor='middle'>${initials}</text></svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  artCache.set(title, uri);
  return uri;
}
const poster = (p, big = false) => (big ? img(p.image || p.imageSm) : img(p.imageSm || p.image)) || art(titleOf(p));
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtLeft = (h) => {
  const left = Math.max(0, (h.duration || 0) - (h.position || 0));
  const m = Math.round(left / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
};

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'alert' : 'sparkle', 18)}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

export async function getPost(id) {
  id = String(id);
  if (!S.posts.has(id)) {
    const p = id.startsWith('ftp:') ? loadFtpPost(id.slice(4)) : window.cf.post(id);
    S.posts.set(id, p);
    p.catch(() => S.posts.delete(id));
  }
  return S.posts.get(id);
}

// Flatten a post into a playable list. Series: [{season, episode, ...}], movies: one item.
export function playlist(post) {
  if (post.items) return post.items; // prebuilt list (offline downloads)
  if (post.type === 'series' && Array.isArray(post.content)) {
    const out = [];
    post.content.forEach((s, si) => (s.episodes || []).forEach((ep, ei) => out.push({
      season: si, episode: ei, seasonName: s.seasonName || `Season ${si + 1}`, title: ep.title || `Episode ${ei + 1}`, url: ep.link,
    })));
    return out.filter((x) => x.url);
  }
  const url = Array.isArray(post.content) ? (post.content[0] && (post.content[0].link || post.content[0])) : post.content;
  return url ? [{ season: 0, episode: 0, seasonName: '', title: titleOf(post), url }] : [];
}

export const histKey = (postId, item) => `${postId}:${item.season}:${item.episode}`;
const history = () => Object.values(S.store.history).sort((a, b) => b.updatedAt - a.updatedAt);
const lastFor = (postId) => history().find((h) => String(h.postId) === String(postId));
const pct = (h) => (h && h.duration ? Math.min(100, (h.position / h.duration) * 100) : 0);

function continueWatching() {
  const seen = new Set();
  return history().filter((h) => {
    if (seen.has(h.postId)) return false;
    seen.add(h.postId);
    return !h.completed;
  });
}

export async function refreshStore() { S.store = await window.cf.store.get(); }

/* ---------------- card templates ---------------- */
function posterCard(p) {
  const h = lastFor(p.id);
  const progress = h && !h.completed && pct(h) > 1 ? `<div class="bar"><i style="width:${pct(h)}%"></i></div>` : '';
  const sub = [p.year, p.quality].filter(Boolean).join(' · ');
  return `<div class="card" data-open="${esc(p.id)}" title="${esc(p.title || titleOf(p))}">
    <div class="pic">
      <img loading="lazy" src="${poster(p)}" alt="">
      ${p.type === 'series' ? '<span class="badge-s">S</span>' : ''}
      ${/2160|4k/i.test(p.quality || '') ? '<span class="badge-q">4K</span>' : /1080/.test(p.quality || '') ? '<span class="badge-q">HD</span>' : ''}
      <span class="play-hint">${icon('play', 22)}</span>
      ${progress}
    </div>
    <h3>${esc(titleOf(p))}</h3>
    <p class="sub">${esc(sub || (p.type === 'series' ? 'Series' : 'Movie'))}</p>
  </div>`;
}

function contCard(h, removable = true) {
  const ep = String(h.postId).startsWith('ftp:') ? (h.type === 'series' ? `#${h.episode + 1} · ${h.epTitle}` : 'Direct FTP')
    : h.type === 'series' ? `S${h.season + 1} · E${h.episode + 1}` : (h.year || 'Movie');
  const status = h.completed ? `<span class="chip accent up">${icon('check', 14)} Watched</span>`
    : h.position < 5 ? `<span class="chip accent up">Up next</span>` : `<span class="left">${fmtLeft(h)}</span>`;
  return `<div class="ccard" data-resume="${esc(h.key)}">
    <div class="frame">
      <img class="bgimg" src="${poster(h, true)}" alt="">
      <img class="thumb" src="${poster(h)}" alt="">
      <div class="txt"><b>${esc(h.name)}</b><span>${esc(ep)}</span></div>
      ${status}
      <div class="bar"><i style="width:${h.completed ? 100 : pct(h)}%"></i></div>
      <span class="play-hint">${icon('play', 18)}</span>
    </div>
    ${removable ? `<button class="rm" data-rm="${esc(h.key)}" title="Remove from history">${icon('x', 14)}</button>` : ''}
  </div>`;
}

function row(title, itemsHtml, { id = '', see = '', ic = '' } = {}) {
  if (!itemsHtml) return '';
  return `<section class="row" ${id ? `id="${id}"` : ''}>
    <div class="row-head">${ic}<h2>${esc(title)}</h2>${see ? `<a class="see" href="${see}">See all ${icon('chevR', 14)}</a>` : ''}</div>
    <div class="row-wrap">
      <button class="arrow l" data-scroll="-1"><span>${icon('chevL', 18)}</span></button>
      <div class="track">${itemsHtml}</div>
      <button class="arrow r" data-scroll="1"><span>${icon('chevR', 18)}</span></button>
    </div>
  </section>`;
}

const skeletonRows = () => `<div class="page">${[0, 1].map(() => `
  <div class="skel" style="height:22px;width:220px;margin:10px 0 16px"></div>
  <div style="display:flex;gap:16px;overflow:hidden">${Array(8).fill('<div class="skel" style="flex:none;width:178px;aspect-ratio:2/3"></div>').join('')}</div>`).join('')}</div>`;

const emptyState = (ic, title, text) => `<div class="empty"><div class="big">${icon(ic, 34)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

/* ---------------- views ---------------- */
let cleanup = null;
const view = () => $('#view');
export const setCleanup = (fn) => { const prev = cleanup; cleanup = () => { if (prev) prev(); fn(); }; };

async function homeView() {
  view().innerHTML = `<div class="hero"><div class="hero-bg skel" style="border-radius:0"></div></div>${skeletonRows()}`;
  if (!S.home) S.home = await window.cf.home();
  const { mostVisited, latest, categories } = S.home;
  const heroItems = mostVisited.slice(0, 7);
  const cw = continueWatching();

  view().innerHTML = `
    <section class="hero" id="hero">
      <div class="hero-bg"><img id="heroBg" alt=""></div>
      <div class="hero-poster"><img id="heroPoster" alt=""></div>
      <div class="hero-shade"></div>
      <div class="hero-content" id="heroContent"></div>
      <div class="hero-dots">${heroItems.map((_, i) => `<button data-hero="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>
    </section>
    <div class="rows">
      ${row('Continue Watching', cw.map((h) => contCard(h)).join(''), { id: 'cwRow', see: '#/history' })}
      ${row('Trending on CircleFTP', mostVisited.map(posterCard).join(''), { ic: `<span style="color:#ff7a45">${icon('flame', 20)}</span>` })}
      ${row('Fresh Uploads', latest.map(posterCard).join(''))}
      ${categories.map((c) => row(c.name, c.posts.map(posterCard).join(''), { see: `#/browse/${c.id}` })).join('')}
    </div>`;

  let idx = 0;
  let timer;
  const show = async (i) => {
    idx = (i + heroItems.length) % heroItems.length;
    const p = heroItems[idx];
    document.querySelectorAll('[data-hero]').forEach((b, k) => b.classList.toggle('active', k === idx));
    $('#heroBg').src = img(p.image || p.imageSm);
    $('#heroPoster').src = img(p.image || p.imageSm);
    const h = lastFor(p.id);
    const c = $('#heroContent');
    c.classList.remove('swap'); void c.offsetWidth; c.classList.add('swap');
    c.innerHTML = `
      <div class="hero-badge"><img class="logo-sm" src="logo.svg" alt=""> CircleFTP ${p.type === 'series' ? 'Series' : 'Movie'}</div>
      <h1 class="hero-title">${esc(titleOf(p))}</h1>
      <div class="meta">${[p.year, p.watchTime].filter(Boolean).map(esc).join('<span class="dot"></span>')}${p.quality ? `<span class="chip">${esc(p.quality)}</span>` : ''}</div>
      <div class="hero-rank">${icon('flame', 22)} #${idx + 1} Most Viewed Today</div>
      <p class="hero-desc" id="heroDesc">&nbsp;</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-play="${esc(p.id)}">${icon('play', 18)} ${h && !h.completed ? 'Resume' : 'Play'}</button>
        <a class="btn btn-glass" href="#/title/${esc(p.id)}">${icon('info', 18)} More Info</a>
      </div>`;
    getPost(p.id).then((full) => {
      const d = $('#heroDesc');
      if (d && heroItems[idx] === p) d.textContent = full.metaData || '';
    }).catch(() => {});
    clearTimeout(timer);
    timer = setTimeout(() => show(idx + 1), 9000);
  };
  if (heroItems.length) show(0);
  const onHeroDot = (e) => { const b = e.target.closest('[data-hero]'); if (b) show(Number(b.dataset.hero)); };
  view().addEventListener('click', onHeroDot);
  cleanup = () => { clearTimeout(timer); view().removeEventListener('click', onHeroDot); };
}

async function categoriesList() {
  if (!S.cats) S.cats = await window.cf.categories();
  return S.cats;
}

// Only video categories are shown; Software, Games, Apps, Comics, Tutorials, Islamic, others and
// "Featured Post" never appear. Their sub-categories are all year buckets ("English 2023").
const CAT_GROUPS = [
  ['Movies', 'film', [6, 2, 4, 3, 7, 8, 1, 20]],
  ['TV Series', 'tvSeries', [9, 22, 21, 5, 238]],
  ['More', 'sparkle', [85, 251, 15]],
];
const MOVIE_CATS = [...CAT_GROUPS[0][2], 85];
const SERIES_CATS = [...CAT_GROUPS[1][2], 251];
const subLabel = (s) => ((s.name.match(/((?:19|20)\d{2}.*)$/) || [s.name])[0]).replace(/&\s*Before/i, '& earlier');
const subYear = (s) => Number((s.name.match(/(?:19|20)\d{2}/) || [0])[0]);

async function shelfView(kind) {
  view().innerHTML = skeletonRows();
  const cats = await categoriesList();
  const ids = kind === 'movies' ? MOVIE_CATS : SERIES_CATS;
  const chosen = ids.map((id) => cats.find((c) => c.id === id)).filter(Boolean);
  const results = await Promise.all(chosen.map((c) => window.cf.posts({ category: c.id, limit: 24 }).catch(() => ({ posts: [] }))));
  const cw = continueWatching().filter((h) => (kind === 'series' ? h.type === 'series' : h.type !== 'series'));
  view().innerHTML = `<div class="page" style="padding-left:0;padding-right:0">
    <div class="page-title" style="padding:0 40px"><h1>${kind === 'movies' ? 'Movies' : 'TV Series'}</h1></div>
    <div class="rows flat">
      ${row('Continue Watching', cw.map((h) => contCard(h)).join(''))}
      ${chosen.map((c, i) => row(c.name, results[i].posts.map(posterCard).join(''), { see: `#/browse/${c.id}` })).join('')}
    </div></div>`;
}

async function browseView(catId, subId) {
  const all = await categoriesList();
  const byId = new Map(all.map((c) => [c.id, c]));
  const groups = CAT_GROUPS.map(([label, ic, ids]) => [label, ic, ids.map((id) => byId.get(id)).filter(Boolean)]);
  const cat = byId.get(Number(catId)) && groups.some((g) => g[2].some((c) => c.id === Number(catId))) ? byId.get(Number(catId)) : groups[0][2][0];
  const subs = (cat.subCategory || []).filter((s) => /(?:19|20)\d{2}/.test(s.name)).sort((a, b) => subYear(b) - subYear(a));
  view().innerHTML = `<div class="page">
    <div class="page-title"><h1>${esc(cat.name)}</h1><span class="count" id="count"></span></div>
    <div class="cat-groups">${groups.map(([label, ic, cs]) => `<div class="cat-group"><span class="cat-label">${icon(ic, 15)} ${esc(label)}</span>
      <div class="cat-bar">${cs.map((c) => `<a class="chip ${c.id === cat.id ? 'on' : ''}" href="#/browse/${c.id}">${esc(c.name)}</a>`).join('')}</div></div>`).join('')}</div>
    ${subs.length ? `<div class="sub-bar"><span class="cat-label">${icon('calendar', 15)} Year</span><a class="chip ${!subId ? 'accent' : ''}" href="#/browse/${cat.id}">All years</a>${subs.map((s) => `<a class="chip ${String(s.id) === String(subId) ? 'accent' : ''}" href="#/browse/${cat.id}/${s.id}">${esc(subLabel(s))}</a>`).join('')}</div>` : ''}
    <div class="grid" id="grid"></div>
    <div class="sentinel" id="sentinel"><div class="spinner"></div></div>
  </div>`;
  let page = 1, pages = Infinity, busy = false;
  const load = async () => {
    if (busy || page > pages) return;
    busy = true;
    try {
      const r = await window.cf.posts({ category: cat.id, sub: subId, page, limit: 36 });
      pages = r.pagination ? r.pagination.pages : page;
      if (r.pagination) $('#count') && ($('#count').textContent = `${r.pagination.total.toLocaleString()} titles`);
      $('#grid') && $('#grid').insertAdjacentHTML('beforeend', r.posts.map(posterCard).join(''));
      page++;
      if (page > pages && $('#sentinel')) $('#sentinel').innerHTML = '';
    } catch (e) { toast(e.message, 'err'); }
    busy = false;
  };
  const io = new IntersectionObserver((en) => en[0].isIntersecting && load(), { root: view(), rootMargin: '600px' });
  io.observe($('#sentinel'));
  cleanup = () => io.disconnect();
}

async function searchView(q) {
  $('#searchInput').value = q;
  view().innerHTML = `<div class="page"><div class="page-title"><h1>Results</h1><span class="count">for “${esc(q)}”</span></div><div class="center-load" style="height:40vh"><div class="spinner"></div></div></div>`;
  const r = await window.cf.posts({ searchTerm: q, limit: 60 });
  if (location.hash !== `#/search/${encodeURIComponent(q)}`) return;
  view().innerHTML = `<div class="page"><div class="page-title"><h1>Results</h1><span class="count">${r.posts.length} for “${esc(q)}”</span></div>
    ${r.posts.length ? `<div class="grid">${r.posts.map(posterCard).join('')}</div>` : emptyState('search', 'Nothing found', 'Try another title, or a shorter keyword.')}</div>`;
}

function historyView() {
  const all = history();
  view().innerHTML = `<div class="page">
    <div class="page-title"><h1>Watch History</h1><span class="count">${all.length} items</span>
      ${all.length ? `<div class="actions"><button class="btn btn-glass btn-sm" id="clearHist">${icon('trash', 16)} Clear all</button></div>` : ''}</div>
    ${all.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${all.map((h) => contCard(h)).join('').replaceAll('class="ccard"', 'class="ccard" style="width:auto"')}</div>`
      : emptyState('clock', 'No history yet', 'Everything you watch shows up here with your progress.')}
  </div>`;
  const btn = $('#clearHist');
  if (btn) btn.onclick = async () => {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.innerHTML = `${icon('alert', 16)} Click again to clear`; return; }
    await window.cf.store.clearHistory(); await refreshStore(); historyView();
  };
}

function listView() {
  const items = Object.values(S.store.list).sort((a, b) => b.addedAt - a.addedAt);
  view().innerHTML = `<div class="page"><div class="page-title"><h1>My List</h1><span class="count">${items.length} titles</span></div>
    ${items.length ? `<div class="grid">${items.map(posterCard).join('')}</div>` : emptyState('bookmark', 'Your list is empty', 'Tap “My List” on any title to save it for later.')}</div>`;
}

async function detailView(id) {
  view().innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  const post = await getPost(id);
  const list = playlist(post);
  const last = lastFor(post.id);
  const inList = Boolean(S.store.list[String(post.id)]);
  const isSeries = post.type === 'series';
  const seasons = isSeries ? post.content || [] : [];
  let season = last && isSeries ? last.season : 0;
  if (season >= seasons.length) season = 0;

  const resumeLabel = !last ? (isSeries ? 'Play S1 E1' : 'Play')
    : last.completed && !isSeries ? 'Watch again'
    : isSeries ? `${last.position > 5 ? 'Resume' : 'Play'} S${last.season + 1} E${last.episode + 1}` : 'Resume';
  const cats = (post.categories || []).map((c) => `<a class="chip" href="#/browse/${c.parentId || c.id}${c.parentId ? '/' + c.id : ''}">${esc(c.name)}</a>`).join('');
  const epCount = list.length;

  view().innerHTML = `<div class="detail">
    <div class="detail-bg"><img src="${img(post.image)}" alt=""></div>
    <div class="detail-top">
      <div class="detail-poster"><img src="${img(post.image || post.imageSm)}" alt=""></div>
      <div class="detail-info">
        <div class="hero-badge"><img class="logo-sm" src="logo.svg" alt=""> CircleFTP ${isSeries ? 'Series' : 'Movie'}</div>
        <h1 class="hero-title">${esc(titleOf(post))}</h1>
        <div class="meta">${[post.year, post.watchTime, isSeries ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''} · ${epCount} Episodes` : ''].filter(Boolean).map(esc).join('<span class="dot"></span>')}
          ${post.quality ? `<span class="chip">${esc(post.quality)}</span>` : ''}
          ${post.view ? `<span class="chip accent">${icon('flame', 13)} ${Number(post.view).toLocaleString()} views</span>` : ''}</div>
        <div class="chips">${cats}</div>
        <p class="hero-desc">${esc(post.metaData || 'No description available.')}</p>
        ${last && !last.completed && last.duration ? `<div style="display:flex;align-items:center;gap:12px;max-width:420px;margin:-10px 0 22px"><div class="bar" style="flex:1"><i style="width:${pct(last)}%"></i></div><small style="color:var(--muted);font-weight:600">${fmtLeft(last)}</small></div>` : ''}
        <div class="hero-actions">
          ${epCount ? `<button class="btn btn-primary" id="mainPlay">${icon('play', 18)} ${esc(resumeLabel)}</button>` : `<span class="chip">No playable files</span>`}
          ${last && !isSeries && !last.completed ? `<button class="btn btn-glass" id="restart">${icon('rewind', 18)} Start over</button>` : ''}
          <button class="btn btn-glass" id="listBtn">${icon(inList ? 'check' : 'plus', 18)} My List</button>
          ${!isSeries && list[0] ? dlBtn(post, list[0], true) : ''}
        </div>
        ${!isSeries && list[0] ? `<div class="file-name">${esc(decodeURIComponent(list[0].url.split('/').pop()))}</div>` : ''}
      </div>
    </div>
    ${isSeries ? `<section class="episodes">
      <div class="ep-head"><h2>Episodes</h2><div class="seasons" id="seasons"></div>
        <button class="btn btn-glass btn-sm" id="dlSeason" style="margin-left:auto">${icon('download', 15)} Download season</button></div>
      <div class="ep-grid" id="epGrid"></div>
    </section>` : ''}
  </div>`;

  const renderEpisodes = () => {
    $('#seasons').innerHTML = seasons.map((s, i) => `<button class="chip ${i === season ? 'active' : ''}" data-season="${i}">${esc(s.seasonName || `Season ${i + 1}`)}</button>`).join('');
    const eps = list.filter((x) => x.season === season);
    $('#epGrid').innerHTML = eps.map((x) => {
      const h = S.store.history[histKey(post.id, x)];
      const cur = last && last.season === x.season && last.episode === x.episode;
      return `<div class="ep ${cur ? 'current' : ''}" data-ep="${x.season}:${x.episode}">
        <img src="${img(post.imageSm || post.image)}" alt="">
        <span class="num">${x.episode + 1}</span>
        <div class="tags"><span>E${x.episode + 1}</span>${h && h.completed ? `<span class="done">${icon('check', 12)} Watched</span>` : h && h.duration && h.position > 5 ? `<span>${fmtLeft(h)}</span>` : ''}</div>
        <div class="t">${esc(x.title)}</div>
        <span class="play-hint">${icon('play', 20)}</span>
        ${dlBtn(post, x)}
        ${h && h.duration ? `<div class="bar"><i style="width:${h.completed ? 100 : pct(h)}%"></i></div>` : ''}
      </div>`;
    }).join('');
  };
  if (isSeries) {
    renderEpisodes();
    $('#seasons').onclick = (e) => { const b = e.target.closest('[data-season]'); if (b) { season = Number(b.dataset.season); renderEpisodes(); } };
    $('#dlSeason').onclick = () => downloadMany(post, list.filter((x) => x.season === season));
    $('#epGrid').onclick = (e) => {
      const el = e.target.closest('[data-ep]'); if (!el) return;
      const [s, ep] = el.dataset.ep.split(':').map(Number);
      const item = list.find((x) => x.season === s && x.episode === ep);
      const h = S.store.history[histKey(post.id, item)];
      openPlayer(post, item, h && !h.completed ? h.position : 0);
    };
  }
  const mp = $('#mainPlay');
  if (mp) mp.onclick = () => playPost(post);
  const rs = $('#restart');
  if (rs) rs.onclick = () => openPlayer(post, list[0], 0);
  $('#listBtn').onclick = async () => {
    const on = await window.cf.store.toggleList({ id: post.id, name: titleOf(post), title: post.title, image: post.image, imageSm: post.imageSm, quality: post.quality, year: post.year, type: post.type });
    await refreshStore();
    $('#listBtn').innerHTML = `${icon(on ? 'check' : 'plus', 18)} My List`;
    toast(on ? 'Added to My List' : 'Removed from My List');
  };
}

// Play a title from its most relevant point: resume last unfinished item, else the next one.
export async function playPost(postOrId) {
  const post = typeof postOrId === 'object' && postOrId.content ? postOrId : await getPost(postOrId.id || postOrId);
  const list = playlist(post);
  if (!list.length) return toast('No playable file for this title', 'err');
  const last = lastFor(post.id);
  let item = list[0], start = 0;
  if (last) {
    const i = list.findIndex((x) => x.season === last.season && x.episode === last.episode);
    if (i >= 0 && !last.completed) { item = list[i]; start = last.position || 0; }
    else if (i >= 0 && list[i + 1]) item = list[i + 1];
  }
  openPlayer(post, item, start);
}

/* ---------------- router ---------------- */
const NAV = [
  ['home', 'Home', 'home'], ['movies', 'Movies', 'film'], ['series', 'Series', 'tv'],
  ['browse', 'Browse', 'grid'], ['ftp', 'FTP Library', 'library'], ['history', 'History', 'clock'], ['list', 'My List', 'bookmark'], ['downloads', 'Downloads', 'download'],
];

function renderNav(active) {
  $('#sideNav').innerHTML = NAV.map(([r, label, ic]) => `<a href="#/${r}" class="${r === active ? 'active' : ''}">${icon(ic, 22)}<span class="tip">${label}</span></a>`).join('');
  $('#topNav').innerHTML = NAV.slice(0, 5).map(([r, label]) => `<a href="#/${r}" class="${r === active ? 'active' : ''}">${label}</a>`).join('');
}

export async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [name = 'home', a, b] = location.hash.replace(/^#\/?/, '').split('/');
  renderNav(name === 'title' ? '' : name === 'search' ? '' : name);
  view().scrollTop = 0;
  $('#topbar').classList.toggle('solid', !['home', 'title'].includes(name) && !(name === 'ftp' && a));
  try {
    if (name === 'movies' || name === 'series') await shelfView(name);
    else if (name === 'downloads') downloadsView(view());
    else if (name === 'profile') await profileView(view());
    else if (name === 'browse') await browseView(a, b);
    else if (name === 'search') await searchView(decodeURIComponent(a || ''));
    else if (name === 'history') historyView();
    else if (name === 'list') listView();
    else if (name === 'ftp') await (a ? ftpFolderView(view(), decodeURIComponent(a)) : ftpRootsView(view()));
    else if (name === 'title') await detailView(a);
    else await homeView();
  } catch (e) {
    console.error(e);
    view().innerHTML = `<div class="page">${emptyState('alert', 'Can’t reach CircleFTP', `${e.message || e}. Make sure you are on the CircleNetwork connection.`)}<div style="text-align:center"><button class="btn btn-primary btn-sm" data-reload>Retry</button></div></div>`;
  }
}

/* ---------------- global events ---------------- */
function bindGlobal() {
  view().addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-reload]')) { S.home = null; S.cats = null; route(); return; }
    const rm = t.closest('[data-rm]');
    if (rm) {
      e.stopPropagation();
      await window.cf.store.removeHistory(rm.dataset.rm);
      await refreshStore();
      rm.closest('.ccard').remove();
      return;
    }
    const sc = t.closest('[data-scroll]');
    if (sc) { const tr = sc.parentElement.querySelector('.track'); tr.scrollBy({ left: Number(sc.dataset.scroll) * tr.clientWidth * 0.85 }); return; }
    const resume = t.closest('[data-resume]');
    if (resume) {
      const h = S.store.history[resume.dataset.resume];
      if (!h) return;
      const post = await getPost(h.postId);
      const item = playlist(post).find((x) => x.season === h.season && x.episode === h.episode);
      if (item) openPlayer(post, item, h.completed ? 0 : h.position);
      return;
    }
    const play = t.closest('[data-play]');
    if (play) { playPost(play.dataset.play); return; }
    const open = t.closest('[data-open]');
    if (open) location.hash = `#/title/${open.dataset.open}`;
  });

  view().addEventListener('scroll', () => {
    const name = location.hash.split('/')[1] || 'home';
    if (['home', 'title', 'ftp'].includes(name)) $('#topbar').classList.toggle('solid', view().scrollTop > 60);
  }, { passive: true });

  const input = $('#searchInput');
  let deb;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      const q = input.value.trim();
      if (q.length >= 2) location.hash = `#/search/${encodeURIComponent(q)}`;
    }, 380);
  });
  document.addEventListener('keydown', (e) => {
    if (isPlayerOpen()) return;
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape' && document.activeElement === input) input.blur();
  });
  window.addEventListener('hashchange', route);
  // Fade posters in once loaded (inline onload handlers are blocked by the CSP).
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
}

(async function boot() {
  $('#searchIcon').innerHTML = icon('search', 18);
  const splashDone = new Promise((r) => setTimeout(r, 2300));
  [S.media] = await Promise.all([window.cf.mediaInfo(), refreshStore()]);
  applyTheme(S.store.prefs.theme);
  $('#ver').textContent = `v${S.media.version}`;
  $('#avatar').onclick = () => { location.hash = '#/profile'; };
  await initExtras();
  bindGlobal();
  await splashDone;
  $('#splash').classList.add('out');
  setTimeout(() => $('#splash').remove(), 700);
  if (!S.store.profile) await profileDialog(false); // first run: name required, picture optional
  renderAvatar();
  if (!location.hash) location.hash = '#/home';
  else route();
})();

// Player calls this after closing so progress bars everywhere reflect the new position.
export async function afterPlayerClose() {
  await refreshStore();
  const name = location.hash.split('/')[1] || 'home';
  if (name === 'search' || name === 'browse') return; // keep scroll + loaded pages
  const top = view().scrollTop;
  await route();
  view().scrollTop = top;
}
