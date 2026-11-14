const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, v) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('sf', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickDir: () => ipcRenderer.invoke('files:pickDir'),
  expandPaths: (paths) => ipcRenderer.invoke('files:expand', paths),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  checkFiles: (paths) => ipcRenderer.invoke('file:check', paths),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  applyShortcuts: (entries) => ipcRenderer.invoke('shortcuts:apply', entries),
  onShortcut: on('sf:shortcut'),
  saveRecording: (opts) => ipcRenderer.invoke('rec:save', opts),
  mediaCut: (opts) => ipcRenderer.invoke('media:cut', opts),
  audioAutoSetup: (opts) => ipcRenderer.invoke('audio:autoSetup', opts),
  restoreMic: () => ipcRenderer.send('audio:restore'),
  ytEnsure: () => ipcRenderer.invoke('yt:ensure'),
  ytInfo: (url) => ipcRenderer.invoke('yt:info', url),
  ytDownload: (opts) => ipcRenderer.invoke('yt:download', opts),
  onYtProgress: on('sf:ytprogress'),
  onMenuAction: on('sf:menu'),
  menuState: (s) => ipcRenderer.send('menu:state', s),
  uiLog: (m) => ipcRenderer.send('ui:log', m),
  desktopSource: () => ipcRenderer.invoke('desktop:source'),
  audioTapStart: () => ipcRenderer.invoke('audio:tapStart'),
  audioTapStop: () => ipcRenderer.invoke('audio:tapStop'),
  cableEnsure: () => ipcRenderer.invoke('cable:ensure'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  seedSounds: () => ipcRenderer.invoke('sounds:seed'),
  onCableReady: on('sf:cableReady'),
  onCableState: on('sf:cableState'),
  onTapDead: on('sf:tapDead'),
  onTapPcm: on('sf:tapPcm'),
  onMicWatchOff: on('sf:micWatchOff'),
});
