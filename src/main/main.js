const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const api = require('./api');
const { Store } = require('./store');
const fs = require('fs');
const { startServer, probe, setLocalResolver } = require('./media');
const { Downloads } = require('./downloads');
const pkg = require('../../package.json');

let store;
let media;
let downloads;
let win;

const OVERLAY = {
  dark: { color: '#00000000', symbolColor: '#e8e8f0', height: 40 },
  light: { color: '#00000000', symbolColor: '#1a1a2e', height: 40 },
};

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, area.width),
    height: Math.min(900, area.height),
    backgroundColor: store.data.prefs.theme === 'light' ? '#f4f4fa' : '#07070c',
    title: 'CircleFlix',
    icon: path.join(__dirname, '..', '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: OVERLAY[store.data.prefs.theme] || OVERLAY.dark,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Two window states only: the default size, or maximized/fullscreen. Dragging an edge does nothing.
  win.on('will-resize', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

if (process.platform === 'win32') app.setAppUserModelId('net.circleflix.app');

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  media = await startServer();

  handle('api:home', () => api.home());
  handle('api:categories', () => api.categories());
  handle('api:post', (id) => api.post(id));
  handle('api:posts', (q) => api.posts(q));
  handle('api:siblingSubs', (url) => api.siblingSubtitles(url).catch(() => []));
  handle('ftp:roots', () => api.ftpRoots());
  handle('ftp:list', (url) => api.ftpList(url));
  handle('ftp:poster', (name) => api.ftpPoster(name));
  handle('ftp:clean', (name) => api.cleanTitle(name));
  downloads = new Downloads(store, path.join(app.getPath('downloads'), 'Circle Download'), (item) => {
    if (win && !win.isDestroyed()) win.webContents.send('downloads:update', item);
  });
  setLocalResolver((url) => downloads.localPath(url));

  handle('media:info', () => ({
    port: media.port, token: media.token, imageBase: api.IMAGE_BASE, version: app.getVersion(),
    repo: pkg.homepage, bugs: pkg.bugs.url, author: pkg.author.name, authorUrl: pkg.author.url, downloadDir: downloads.baseDir,
  }));
  handle('dl:list', () => downloads.list());
  handle('dl:add', (meta) => downloads.add(meta));
  handle('dl:pause', (url) => downloads.pause(url));
  handle('dl:resume', (url) => downloads.resume(url));
  handle('dl:remove', (url) => downloads.remove(url));
  handle('dl:reveal', (url) => {
    const it = url && downloads.items()[url];
    if (it && fs.existsSync(it.file)) shell.showItemInFolder(it.file);
    else { fs.mkdirSync(downloads.baseDir, { recursive: true }); shell.openPath(downloads.baseDir); }
  });
  handle('store:setProfile', (p) => store.setProfile(p));
  handle('store:addWatch', (w) => store.addWatch(w));
  handle('ui:theme', (theme) => {
    theme = theme === 'light' ? 'light' : 'dark';
    store.setPrefs({ theme });
    if (win && !win.isDestroyed() && process.platform === 'win32') win.setTitleBarOverlay(OVERLAY[theme]);
  });
  handle('ui:open', (url) => { if (String(url).startsWith('https://github.com/')) shell.openExternal(url); });
  handle('media:probe', (url) => probe(url));
  handle('store:get', () => store.snapshot());
  handle('store:upsertHistory', (entry) => store.upsertHistory(entry));
  handle('store:removeHistory', (keys) => store.removeHistory(keys));
  handle('store:clearHistory', () => store.clearHistory());
  handle('store:toggleList', (item) => store.toggleList(item));
  handle('store:setPrefs', (p) => store.setPrefs(p));

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => {
  if (downloads) for (const it of downloads.list()) if (it.status === 'downloading' || it.status === 'queued') it.status = 'paused';
  if (store) store.flush();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
