const { contextBridge, ipcRenderer } = require('electron');

// Strip Electron's "Error invoking remote method 'x': Error:" wrapper so the UI shows the real message.
const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args).catch((e) => {
  throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, ''));
});

contextBridge.exposeInMainWorld('cf', {
  home: call('api:home'),
  categories: call('api:categories'),
  post: call('api:post'),
  posts: call('api:posts'),
  siblingSubs: call('api:siblingSubs'),
  ftpRoots: call('ftp:roots'),
  ftpList: call('ftp:list'),
  ftpPoster: call('ftp:poster'),
  ftpClean: call('ftp:clean'),
  mediaInfo: call('media:info'),
  probe: call('media:probe'),
  dl: {
    list: call('dl:list'), add: call('dl:add'), pause: call('dl:pause'), resume: call('dl:resume'),
    remove: call('dl:remove'), reveal: call('dl:reveal'),
    onUpdate: (fn) => ipcRenderer.on('downloads:update', (_e, item) => fn(item)),
  },
  setTheme: call('ui:theme'),
  openExternal: call('ui:open'),
  store: {
    setProfile: call('store:setProfile'),
    addWatch: call('store:addWatch'),
    get: call('store:get'),
    upsertHistory: call('store:upsertHistory'),
    removeHistory: call('store:removeHistory'),
    clearHistory: call('store:clearHistory'),
    toggleList: call('store:toggleList'),
    setPrefs: call('store:setPrefs'),
  },
});
