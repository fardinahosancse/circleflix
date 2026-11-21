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

function dlRow(d) {
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
    <div class="dl-main"><b>${esc(ep)}</b><small class="${d.status === 'error' ? 'err' : ''}">${esc(status)}</small><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="dl-acts">
      ${d.status === 'done' ? `<button class="ibtn" data-dlplay="${esc(d.url)}" title="Play offline">${icon('play', 16)}</button><button class="ibtn" data-dlreveal="${esc(d.url)}" title="Show in folder">${icon('folderOpen', 17)}</button>` : ''}
      ${d.status === 'downloading' || d.status === 'queued' ? `<button class="ibtn" data-dlpause="${esc(d.url)}" title="Pause">${icon('pause', 16)}</button>` : ''}
      ${d.status === 'paused' || d.status === 'error' ? `<button class="ibtn" data-dlresume="${esc(d.url)}" title="Resume">${icon('download', 17)}</button>` : ''}
      <button class="ibtn danger" data-dlremove="${esc(d.url)}" title="Delete download">${icon('trash', 16)}</button>
    </div></div>`;
}

export function downloadsView(view) {
  const all = Object.values(S.downloads).sort((a, b) => b.addedAt - a.addedAt);
  const groups = new Map();
  for (const d of all) { if (!groups.has(d.postId)) groups.set(d.postId, []); groups.get(d.postId).push(d); }
  const total = all.filter((d) => d.status === 'done').reduce((s, d) => s + d.size, 0);
  view.innerHTML = `<div class="page">
    <div class="page-title"><h1>Downloads</h1><span class="count">${all.length} file${all.length === 1 ? '' : 's'}${total ? ' · ' + fmtSize(total) + ' on disk' : ''}</span>
      <div class="actions"><button class="btn btn-glass btn-sm" data-dlreveal="">${icon('folderOpen', 16)} Open folder</button></div></div>
    ${all.length ? [...groups.values()].map((list) => {
      list.sort((a, b) => a.season - b.season || a.episode - b.episode);
      return `<section class="dl-group"><h2>${esc(list[0].name)} <small>${list.length} file${list.length > 1 ? 's' : ''}</small></h2>${list.map(dlRow).join('')}</section>`;
    }).join('') : `<div class="empty"><div class="big">${icon('download', 34)}</div><h3>Nothing downloaded yet</h3><p>Use the download button on any movie or episode to watch it offline.<br>Files are saved in ${esc(S.media.downloadDir)}</p></div>`}
  </div>`;
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

function readPicture(file) { // center-crop to a 256px square JPEG data URL
  return new Promise((resolve, reject) => {
    const im = new Image();
    const src = URL.createObjectURL(file);
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const s = Math.min(im.width, im.height);
      c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(src);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = () => { URL.revokeObjectURL(src); reject(new Error('That file is not an image')); };
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
      try { picture = await readPicture(f); paint(); } catch (err) { $('#ppErr', back).textContent = err.message; }
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
    if (location.hash.startsWith('#/downloads')) {
      const row = document.querySelector(`[data-row="${CSS.escape(item.url)}"]`);
      if (row && item.status !== 'removed') row.outerHTML = dlRow(item);
      else downloadsView(document.getElementById('view'));
    }
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
      else if ((el = q('data-dlremove'))) {
        stop();
        if (!el.dataset.armed) { el.dataset.armed = '1'; el.innerHTML = icon('check', 16); el.title = 'Click again to delete the file'; el.style.background = '#ff4d6d'; el.style.color = '#fff'; return; }
        await window.cf.dl.remove(el.dataset.dlremove);
      }
    } catch (err) { toast(err.message, 'err'); }
  }, true);
  refreshDlButtons();
}
