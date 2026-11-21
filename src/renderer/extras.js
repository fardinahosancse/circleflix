// Downloads, profile + onboarding, theme, about.
import { icon } from './icons.js';
import { S, esc, img, art, toast, getPost, playlist, refreshStore } from './app.js';
import { openPlayer } from './player.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fmtSize = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${Math.round((b || 0) / 1048576)} MB`);
const fmtDur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const poster = (o) => img(o.imageSm || o.image) || art(o.name || '');

/* ================= Theme ================= */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}
async function setTheme(theme) {
  applyTheme(theme);
  S.store.prefs.theme = theme;
  await window.cf.setTheme(theme);
}

/* ================= Downloads ================= */
const metas = new Map(); // url -> metadata needed to start a download

function dlInner(url, big) {
  const d = S.downloads[url];
  const label = (ic, text) => `${icon(ic, big ? 18 : 15)}${big ? ` ${text}` : ''}`;
  if (!d) return label('download', 'Download');
  if (d.status === 'done') return label('circleCheck', 'Downloaded');
  if (d.status === 'downloading') return `${big ? icon('download', 18) + ' ' : ''}${d.size ? Math.floor((d.received / d.size) * 100) : 0}%`;
  if (d.status === 'queued') return label('timer', 'Queued');
  if (d.status === 'error') return label('alert', 'Retry download');
  return label('pause', 'Paused');
}

// A download button for one playable item. Clicks are handled globally (see initExtras).
export function dlBtn(post, item, big = false) {
  metas.set(item.url, {
    url: item.url, postId: post.id, name: post.name || post.title, year: post.year, type: post.type,
    image: post.image, imageSm: post.imageSm, quality: post.quality,
    season: item.season, episode: item.episode, seasonName: item.seasonName, title: item.title,
  });
  const d = S.downloads[item.url];
  return `<button class="dlbtn ${big ? 'btn btn-glass' : ''} ${d && d.status === 'done' ? 'is-done' : ''}" data-dlurl="${esc(item.url)}" ${big ? 'data-big="1"' : ''} title="Download for offline">${dlInner(item.url, big)}</button>`;
}

export async function downloadMany(post, items) {
  let n = 0;
  for (const item of items) {
    if (S.downloads[item.url]) continue;
    dlBtn(post, item);
    S.downloads[item.url] = await window.cf.dl.add(metas.get(item.url));
    n++;
  }
  toast(n ? `${n} download${n > 1 ? 's' : ''} added` : 'Already in Downloads');
  refreshDlButtons();
}

function refreshDlButtons(url) {
  document.querySelectorAll('[data-dlurl]').forEach((b) => {
    if (url && b.dataset.dlurl !== url) return;
    const d = S.downloads[b.dataset.dlurl];
    b.innerHTML = dlInner(b.dataset.dlurl, Boolean(b.dataset.big));
    b.classList.toggle('is-done', Boolean(d && d.status === 'done'));
  });
  const active = Object.values(S.downloads).filter((d) => d.status === 'downloading' || d.status === 'queued').length;
  const nav = $('#sideNav a[href="#/downloads"]');
  if (nav) {
    let dot = nav.querySelector('.dot');
    if (active && !dot) { dot = document.createElement('span'); dot.className = 'dot'; nav.append(dot); }
    if (dot) { if (active) dot.textContent = active; else dot.remove(); }
  }
}

async function onDlClick(btn) {
  const url = btn.dataset.dlurl;
  const d = S.downloads[url];
  if (!d) {
    S.downloads[url] = await window.cf.dl.add(metas.get(url));
    toast('Download started — saved in Downloads › Circle Download');
  } else if (d.status === 'done') { location.hash = '#/downloads'; return; }
  else if (d.status === 'downloading' || d.status === 'queued') await window.cf.dl.pause(url);
  else await window.cf.dl.resume(url);
  refreshDlButtons(url);
}

function dlRow(d, standalone = false) {
  const pct = d.status === 'done' ? 100 : d.size ? (d.received / d.size) * 100 : 0;
  const secLeft = d.speed > 0 && d.size ? (d.size - d.received) / d.speed : 0;
  const left = secLeft ? (secLeft < 60 ? `${Math.ceil(secLeft)}s left` : `${fmtDur(secLeft)} left`) : '';
  const status = {
    done: `${fmtSize(d.size)} · Ready to watch offline`,
    downloading: `${fmtSize(d.received)} of ${fmtSize(d.size)} · ${(d.speed / 1048576).toFixed(1)} MB/s${left ? ' · ' + left : ''}`,
    queued: 'Waiting in queue…',
    paused: `Paused · ${fmtSize(d.received)}${d.size ? ' of ' + fmtSize(d.size) : ''}`,
    error: d.error || 'Download failed',
  }[d.status] || '';
  const ep = d.type === 'series' ? (String(d.postId).startsWith('ftp:') ? d.title : `S${d.season + 1} E${d.episode + 1} · ${d.title}`) : [d.year, d.quality].filter(Boolean).join(' · ') || 'Movie';
  return `<div class="dl-row ${d.status}" data-row="${esc(d.url)}">
    <div class="dl-thumb" data-dlplay="${esc(d.url)}"><img src="${poster(d)}" alt=""><span>${icon('play', 20)}</span></div>
    <div class="dl-main"><b>${standalone ? esc(d.name) + ' <span style="color:var(--muted);font-weight:600">· ' + esc(ep) + '</span>' : esc(ep)}</b><small class="${d.status === 'error' ? 'err' : ''}">${esc(status)}</small><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="dl-acts">
      ${d.status === 'done' ? `<button class="ibtn" data-dlplay="${esc(d.url)}" title="Play offline">${icon('play', 16)}</button><button class="ibtn" data-dlreveal="${esc(d.url)}" title="Show in folder">${icon('folderOpen', 17)}</button>` : ''}
      ${d.status === 'downloading' || d.status === 'queued' ? `<button class="ibtn" data-dlpause="${esc(d.url)}" title="Pause">${icon('pause', 16)}</button>` : ''}
      ${d.status === 'paused' || d.status === 'error' ? `<button class="ibtn" data-dlresume="${esc(d.url)}" title="Resume">${icon('download', 17)}</button>` : ''}
      <button class="ibtn danger" data-dlremove="${esc(d.url)}" title="Delete download">${icon('trash', 16)}</button>
    </div></div>`;
}

// Downloads are shown as folders: one per title, with a section per season inside. A title with
// several files starts collapsed and shows one combined progress line, so a whole season does
// not flood the page.
const openGroups = new Set();
const groupOf = (postId) => Object.values(S.downloads).filter((d) => d.postId === postId)
  .sort((x, y) => x.season - y.season || x.episode - y.episode);

function groupSummary(list) {
  const done = list.filter((d) => d.status === 'done').length;
  const active = list.filter((d) => d.status === 'downloading');
  const queued = list.filter((d) => d.status === 'queued').length;
  const paused = list.filter((d) => d.status === 'paused').length;
  const failed = list.filter((d) => d.status === 'error').length;
  const size = list.reduce((n, d) => n + (d.size || 0), 0);
  const got = list.reduce((n, d) => n + (d.status === 'done' ? d.size : d.received || 0), 0);
  const speed = active.reduce((n, d) => n + (d.speed || 0), 0);
  const allSized = list.every((d) => d.size);
  const pct = done === list.length ? 100 : allSized && size ? (got / size) * 100 : (done / list.length) * 100;
  const bits = [`${done} of ${list.length} downloaded`];
  if (active.length) bits.push(`${active.length} downloading · ${(speed / 1048576).toFixed(1)} MB/s`);
  if (queued) bits.push(`${queued} queued`);
  if (paused) bits.push(`${paused} paused`);
  if (failed) bits.push(`${failed} failed`);
  if (got) bits.push(fmtSize(got));
  return { text: bits.join(' · '), pct, done: done === list.length, busy: active.length + queued > 0, resumable: paused + failed > 0 };
}

function groupHead(list) {
  const g = groupSummary(list);
  const id = esc(list[0].postId);
  const seasons = new Set(list.map((d) => d.seasonName || d.season)).size;
  return `<div class="dl-folder-head ${g.done ? 'done' : ''}" data-gtoggle="${id}">
    <div class="dl-thumb"><img src="${poster(list[0])}" alt=""></div>
    <div class="dl-main"><b>${icon('folder', 15)} ${esc(list[0].name)}</b>
      <small>${seasons > 1 ? `${seasons} seasons · ` : ''}${list.length} episodes · ${esc(g.text)}</small>
      <div class="bar"><i style="width:${g.pct}%"></i></div></div>
    <div class="dl-acts">
      ${g.busy ? `<button class="ibtn" data-gpause="${id}" title="Pause all">${icon('pause', 16)}</button>` : ''}
      ${g.resumable ? `<button class="ibtn" data-gresume="${id}" title="Resume all">${icon('download', 17)}</button>` : ''}
      <button class="ibtn" data-dlreveal="${esc(list[0].url)}" title="Open folder">${icon('folderOpen', 17)}</button>
      <button class="ibtn danger" data-gremove="${id}" title="Delete all files of this title">${icon('trash', 16)}</button>
      <span class="ibtn chev">${icon('chevDown', 18)}</span>
    </div></div>`;
}

function groupHtml(list) {
  if (list.length === 1) return `<section class="dl-group">${dlRow(list[0], true)}</section>`;
  const id = list[0].postId;
  const bySeason = new Map();
  for (const d of list) { const k = d.seasonName || `Season ${d.season + 1}`; if (!bySeason.has(k)) bySeason.set(k, []); bySeason.get(k).push(d); }
  return `<section class="dl-group dl-folder ${openGroups.has(id) ? 'open' : ''}" data-group="${esc(id)}">
    ${groupHead(list)}
    <div class="dl-children">${[...bySeason].map(([name, items]) => `<h4>${icon('layers', 14)} ${esc(name)} <small>${items.length} file${items.length > 1 ? 's' : ''}</small></h4>${items.map((d) => dlRow(d)).join('')}`).join('')}</div>
  </section>`;
}

export function downloadsView(view) {
  const all = Object.values(S.downloads).sort((a, b) => b.addedAt - a.addedAt);
  const ids = [...new Set(all.map((d) => d.postId))];
  const total = all.filter((d) => d.status === 'done').reduce((s, d) => s + d.size, 0);
  view.innerHTML = `<div class="page">
    <div class="page-title"><h1>Downloads</h1><span class="count">${ids.length} title${ids.length === 1 ? '' : 's'} · ${all.length} file${all.length === 1 ? '' : 's'}${total ? ' · ' + fmtSize(total) + ' on disk' : ''}</span>
      <div class="actions"><button class="btn btn-glass btn-sm" data-dlreveal="">${icon('folderOpen', 16)} Open folder</button></div></div>
    ${all.length ? ids.map((id) => groupHtml(groupOf(id))).join('') : `<div class="empty"><div class="big">${icon('download', 34)}</div><h3>Nothing downloaded yet</h3><p>Use the download button on any movie or episode to watch it offline.<br>Files are saved in ${esc(S.media.downloadDir)}</p></div>`}
  </div>`;
}

// Live update of one item without rebuilding the page (keeps folders open and scroll position).
function updateDownloadsPage(item, prev) {
  const view = document.getElementById('view');
  const row = document.querySelector(`[data-row="${CSS.escape(item.url)}"]`);
  const structural = item.status === 'removed' || !row || !prev;
  if (structural) { const top = view.scrollTop; downloadsView(view); view.scrollTop = top; return; }
  row.outerHTML = dlRow(item, !row.closest('.dl-folder'));
  const folder = document.querySelector(`[data-group="${CSS.escape(String(item.postId))}"]`);
  if (folder) folder.querySelector('.dl-folder-head').outerHTML = groupHead(groupOf(item.postId));
}

// Plays a finished download. Works offline: if the catalog can't be reached, a title is rebuilt
// from the downloaded files (same ids, so history and resume still line up).
async function playDownload(url) {
  const d = S.downloads[url];
  if (!d || d.status !== 'done') return;
  let post;
  try {
    post = await getPost(d.postId);
    if (!playlist(post).some((x) => x.url === url)) throw new Error('moved');
  } catch {
    const items = Object.values(S.downloads).filter((x) => x.postId === d.postId && x.status === 'done')
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
      .map((x) => ({ season: x.season, episode: x.episode, seasonName: x.seasonName, title: x.title, url: x.url }));
    post = { id: d.postId, type: d.type, name: d.name, title: d.name, image: d.image, imageSm: d.imageSm, year: d.year, quality: d.quality, ftp: String(d.postId).startsWith('ftp:'), items };
  }
  const item = playlist(post).find((x) => x.url === url);
  const h = S.store.history[`${post.id}:${item.season}:${item.episode}`];
  openPlayer(post, item, h && !h.completed ? h.position : 0);
}

/* ================= Profile ================= */
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function renderAvatar() {
  const el = $('#avatar');
  const p = S.store.profile;
  if (!el || !p) return;
  el.title = `${p.name} — profile`;
  el.style.backgroundImage = p.picture ? `url("${p.picture}")` : '';
  el.textContent = p.picture ? '' : initials(p.name);
}

// Photo cropper: drag to position, slider / mouse wheel to zoom. Resolves a 256px JPEG data URL, or null.
function cropDialog(file) {
  return new Promise((resolve, reject) => {
    const SIZE = 280;
    const src = URL.createObjectURL(file);
    const im = new Image();
    im.onerror = () => { URL.revokeObjectURL(src); reject(new Error('That file could not be opened as an image')); };
    im.onload = () => {
      const base = SIZE / Math.min(im.naturalWidth, im.naturalHeight); // zoom 1 = image just covers the circle
      let zoom = 1;
      let x = (SIZE - im.naturalWidth * base) / 2;
      let y = (SIZE - im.naturalHeight * base) / 2;
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.style.zIndex = 410;
      back.innerHTML = `<div class="modal">
        <h2>Adjust your photo</h2><p>Drag to move. Use the slider or mouse wheel to zoom.</p>
        <div class="crop" id="cropBox"></div>
        <div class="crop-zoom">${icon('user', 14)}<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1">${icon('user', 22)}</div>
        <button class="btn btn-primary" id="cropOk" type="button">${icon('check', 18)} Use photo</button>
        <button class="skip" id="cropCancel" type="button">Cancel</button>
      </div>`;
      document.body.append(back);
      const box = $('#cropBox', back);
      const slider = $('#cropZoom', back);
      im.draggable = false;
      box.append(im);
      const draw = () => {
        const k = base * zoom;
        x = Math.min(0, Math.max(SIZE - im.naturalWidth * k, x));
        y = Math.min(0, Math.max(SIZE - im.naturalHeight * k, y));
        im.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        slider.style.setProperty('--v', `${((zoom - 1) / 3) * 100}%`);
      };
      const setZoom = (z) => { // keep the centre of the circle fixed while zooming
        z = Math.min(4, Math.max(1, z));
        const k0 = base * zoom, k1 = base * z;
        x = SIZE / 2 - ((SIZE / 2 - x) / k0) * k1;
        y = SIZE / 2 - ((SIZE / 2 - y) / k0) * k1;
        zoom = z;
        slider.value = z;
        draw();
      };
      draw();
      slider.oninput = () => setZoom(Number(slider.value));
      box.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.926)); }, { passive: false });
      box.addEventListener('pointerdown', (e) => {
        box.setPointerCapture(e.pointerId);
        box.classList.add('drag');
        let px = e.clientX, py = e.clientY;
        const move = (ev) => { x += ev.clientX - px; y += ev.clientY - py; px = ev.clientX; py = ev.clientY; draw(); };
        const up = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.classList.remove('drag'); };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', up);
      });
      const close = (v) => { back.remove(); URL.revokeObjectURL(src); resolve(v); };
      $('#cropCancel', back).onclick = () => close(null);
      $('#cropOk', back).onclick = () => {
        const k = base * zoom;
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        c.getContext('2d').drawImage(im, -x / k, -y / k, SIZE / k, SIZE / k, 0, 0, 256, 256);
        close(c.toDataURL('image/jpeg', 0.88));
      };
    };
    im.src = src;
  });
}

// First-run welcome (name required, picture optional); also used to edit the profile.
export function profileDialog(edit = false) {
  return new Promise((resolve) => {
    const cur = S.store.profile || { name: '', picture: '' };
    let picture = cur.picture;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal" novalidate>
      <h2>${edit ? 'Edit profile' : 'Welcome to CircleFlix'}</h2>
      <p>${edit ? 'Change your name or picture.' : 'Tell us who is watching. Your profile stays on this computer.'}</p>
      <label class="pic-pick" title="Choose a picture (optional)"><span id="ppI"></span><span class="cam">${icon('camera', 16)}</span>
        <input type="file" id="ppFile" accept="image/*" hidden></label>
      <label class="field"><span>Your name</span><input id="ppName" maxlength="40" placeholder="e.g. Fardin" value="${esc(cur.name)}" autocomplete="off" spellcheck="false"><small id="ppErr"></small></label>
      <button class="btn btn-primary" type="submit">${edit ? 'Save' : 'Start watching'}</button>
      ${edit ? '<button class="skip" type="button" id="ppCancel">Cancel</button>' : '<div class="skip">Picture is optional</div>'}
    </form>`;
    document.body.append(back);
    const name = $('#ppName', back);
    const pick = $('.pic-pick', back);
    const paint = () => {
      pick.style.backgroundImage = picture ? `url("${picture}")` : '';
      $('#ppI', back).textContent = picture ? '' : (name.value.trim() ? initials(name.value) : '?');
    };
    paint();
    name.oninput = () => { $('#ppErr', back).textContent = ''; paint(); };
    $('#ppFile', back).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = ''; // allow picking the same file again
      try { const out = await cropDialog(f); if (out) { picture = out; paint(); } } catch (err) { $('#ppErr', back).textContent = err.message; }
    };
    const close = (v) => { back.remove(); resolve(v); };
    if (edit) $('#ppCancel', back).onclick = () => close(null);
    $('form', back).onsubmit = async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { $('#ppErr', back).textContent = 'Please enter your name'; name.focus(); return; }
      S.store.profile = await window.cf.store.setProfile({ name: name.value, picture });
      renderAvatar();
      close(S.store.profile);
    };
    setTimeout(() => name.focus(), 50);
  });
}

const DAYPARTS = [
  ['Morning', 'sunrise', 5, 12], ['Afternoon', 'sun', 12, 17], ['Evening', 'sunset', 17, 21], ['Night', 'moon', 21, 29],
];

export async function profileView(view) {
  await refreshStore();
  const p = S.store.profile;
  const st = S.store.stats;
  const hist = Object.values(S.store.history);
  const titles = new Set(hist.map((h) => h.postId)).size;
  const finished = hist.filter((h) => h.completed).length;
  const maxH = Math.max(1, ...st.byHour);
  const part = DAYPARTS.map(([label, ic, a, b]) => ({ label, ic, sec: st.byHour.reduce((s, v, h) => s + (((h >= a && h < b) || (h + 24 >= a && h + 24 < b)) ? v : 0), 0) }))
    .sort((x, y) => y.sec - x.sec)[0];
  const peak = st.byHour.indexOf(Math.max(...st.byHour));
  const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tops = Object.entries(st.byTitle).sort((a, b) => b[1].sec - a[1].sec).slice(0, 10);
  const typeTotal = st.byType.movie + st.byType.series || 1;
  const theme = S.store.prefs.theme === 'light' ? 'light' : 'dark';
  const watched = st.seconds > 0;

  view.innerHTML = `<div class="page">
    <section class="prof-head">
      <div class="prof-pic" style="${p.picture ? `background-image:url('${p.picture}')` : ''}">${p.picture ? '' : esc(initials(p.name))}</div>
      <div><h1>${esc(p.name)}</h1><p>Member since ${new Date(p.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p></div>
      <div class="actions"><button class="btn btn-glass btn-sm" id="editProf">${icon('pencil', 15)} Edit profile</button></div>
    </section>

    <div class="stats">
      <div class="stat">${icon('timer', 24)}<b>${watched ? fmtDur(st.seconds) : '0m'}</b><span>Total watch time</span></div>
      <div class="stat">${icon('film', 24)}<b>${titles}</b><span>Titles started</span></div>
      <div class="stat">${icon('circleCheck', 24)}<b>${finished}</b><span>Movies & episodes finished</span></div>
      <div class="stat">${icon(watched ? part.ic : 'moon', 24)}<b>${watched ? part.label : '—'}</b><span>${watched ? `You watch most around ${hourLabel(peak)}` : 'Your favourite time to watch'}</span></div>
    </div>

    <div class="panels">
      <div class="panel"><h3>${icon('chart', 18)} When you watch</h3><p class="hint">${watched ? `Mostly in the ${part.label.toLowerCase()} — peak hour ${hourLabel(peak)}` : 'Start watching to see your daily rhythm'}</p>
        <div class="hours">${st.byHour.map((v, h) => `<i class="${watched && h === peak ? 'hot' : ''}" style="height:${Math.max(3, (v / maxH) * 100)}%" title="${hourLabel(h)} · ${fmtDur(v)}"></i>`).join('')}</div>
        <div class="hours-x"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div></div>
      <div class="panel"><h3>${icon('heart', 18)} Your favourites</h3><p class="hint">${cats.length ? 'What you spend the most time on' : 'Your top categories will appear here'}</p>
        <div class="fav">${cats.map(([c, sec]) => `<div class="fav-row"><span>${esc(c)}</span><small>${fmtDur(sec)}</small><div class="bar"><i style="width:${(sec / cats[0][1]) * 100}%"></i></div></div>`).join('')}
          <div class="fav-row" style="margin-top:6px"><span>Movies ${Math.round((st.byType.movie / typeTotal) * 100)}%</span><small>Series ${Math.round((st.byType.series / typeTotal) * 100)}%</small><div class="bar"><i style="width:${(st.byType.movie / typeTotal) * 100}%"></i></div></div>
        </div></div>
    </div>

    ${tops.length ? `<div class="panel" style="margin-bottom:14px"><h3>${icon('star', 18)} Most watched</h3><p class="hint">Titles you keep coming back to</p>
      <div class="tops">${tops.map(([name, t]) => `<div class="top" data-top="${esc(t.postId || '')}"><img src="${img(t.imageSm) || art(name)}" alt=""><b>${esc(name)}</b><small>${fmtDur(t.sec)}</small></div>`).join('')}</div></div>` : ''}

    <div class="panels">
      <div class="panel"><h3>${icon('sparkle', 18)} Settings</h3><p class="hint">Appearance and storage</p>
        <div class="set-row"><div><b>Theme</b><small>Dark for movie nights, light for daytime</small></div>
          <div class="seg"><button data-theme-set="dark" class="${theme === 'dark' ? 'on' : ''}">${icon('moon', 15)} Dark</button><button data-theme-set="light" class="${theme === 'light' ? 'on' : ''}">${icon('sun', 15)} Light</button></div></div>
        <div class="set-row"><div><b>Download folder</b><small>${esc(S.media.downloadDir)}</small></div><button class="btn btn-glass btn-sm" data-dlreveal="">${icon('folderOpen', 15)} Open</button></div>
      </div>
      <div class="panel"><h3>${icon('info', 18)} About</h3><p class="hint">Built for CircleNetwork users</p>
        <div class="about"><img src="logo.svg" alt=""><div>
          <h3>CircleFlix <small style="font:700 13px 'Plus Jakarta Sans';color:var(--muted)">v${esc(S.media.version)}</small></h3>
          <p>Developer: <span class="link" data-ext="${esc(S.media.authorUrl)}">${esc(S.media.author)}</span></p>
          <div class="links">
            <button class="btn btn-glass btn-sm" data-ext="${esc(S.media.repo)}">${icon('git', 15)} GitHub repository</button>
            <button class="btn btn-glass btn-sm" data-ext="${esc(S.media.bugs)}">${icon('bug', 15)} Report a bug</button>
          </div></div></div>
        <p class="hint" style="margin:14px 0 0">Source: ${esc(S.media.repo)}<br>Issues: ${esc(S.media.bugs)}</p>
      </div>
    </div>
  </div>`;

  $('#editProf', view).onclick = async () => { if (await profileDialog(true)) profileView(view); };
  view.querySelectorAll('[data-theme-set]').forEach((b) => {
    b.onclick = async () => { await setTheme(b.dataset.themeSet); profileView(view); };
  });
  view.querySelectorAll('[data-top]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.top;
      if (id) location.hash = id.startsWith('ftp:') ? `#/ftp/${encodeURIComponent(id.slice(4))}` : `#/title/${id}`;
    };
  });
}

/* ================= wiring ================= */
export async function initExtras() {
  S.downloads = Object.fromEntries((await window.cf.dl.list()).map((d) => [d.url, d]));
  window.cf.dl.onUpdate((item) => {
    const prev = S.downloads[item.url];
    if (item.status === 'removed') delete S.downloads[item.url]; else S.downloads[item.url] = item;
    refreshDlButtons(item.url);
    if (location.hash.startsWith('#/downloads')) updateDownloadsPage(item, prev);
    if (item.status === 'done' && prev && prev.status !== 'done') toast(`Downloaded: ${item.title}`);
    if (item.status === 'error' && prev && prev.status !== 'error') toast(`Download failed: ${item.error}`, 'err');
  });

  // Capture phase so a download button inside a clickable card doesn't also open the card.
  document.addEventListener('click', async (e) => {
    const q = (attr) => e.target.closest(`[${attr}]`);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    let el;
    try {
      if ((el = q('data-dlurl'))) { stop(); await onDlClick(el); }
      else if ((el = q('data-dlplay'))) { stop(); await playDownload(el.dataset.dlplay); }
      else if ((el = q('data-dlpause'))) { stop(); await window.cf.dl.pause(el.dataset.dlpause); }
      else if ((el = q('data-dlresume'))) { stop(); await window.cf.dl.resume(el.dataset.dlresume); }
      else if ((el = q('data-dlreveal'))) { stop(); await window.cf.dl.reveal(el.dataset.dlreveal); }
      else if ((el = q('data-ext'))) { stop(); await window.cf.openExternal(el.dataset.ext); }
      else if ((el = q('data-gpause'))) { stop(); for (const d of groupOf(el.dataset.gpause)) if (d.status === 'downloading' || d.status === 'queued') await window.cf.dl.pause(d.url); }
      else if ((el = q('data-gresume'))) { stop(); for (const d of groupOf(el.dataset.gresume)) if (d.status === 'paused' || d.status === 'error') await window.cf.dl.resume(d.url); }
      else if ((el = q('data-gremove'))) {
        stop();
        if (!el.dataset.armed) { el.dataset.armed = '1'; el.innerHTML = icon('check', 16); el.title = 'Click again to delete every file of this title'; el.style.background = '#ff4d6d'; el.style.color = '#fff'; return; }
        for (const d of groupOf(el.dataset.gremove)) await window.cf.dl.remove(d.url);
      }
      else if ((el = q('data-gtoggle'))) {
        const id = el.dataset.gtoggle;
        if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
        el.closest('.dl-folder').classList.toggle('open', openGroups.has(id));
      }
      else if ((el = q('data-dlremove'))) {
        stop();
        if (!el.dataset.armed) { el.dataset.armed = '1'; el.innerHTML = icon('check', 16); el.title = 'Click again to delete the file'; el.style.background = '#ff4d6d'; el.style.color = '#fff'; return; }
        await window.cf.dl.remove(el.dataset.dlremove);
      }
    } catch (err) { toast(err.message, 'err'); }
  }, true);
  refreshDlButtons();
}
