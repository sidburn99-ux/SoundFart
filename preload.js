const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, v) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('sf', {
  // process.platform est expose par le polyfill de preload sandboxe ;
  // sert a desactiver les fonctions Windows-only cote UI.
  platform: (typeof process !== 'undefined' && process.platform) || '',
  getVersion: () => ipcRenderer.invoke('app:version'),
  getDataDir: () => ipcRenderer.invoke('app:dataDir'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickDir: () => ipcRenderer.invoke('files:pickDir'),
  expandPaths: (paths) => ipcRenderer.invoke('files:expand', paths),
  importFiles: (paths, dir) => ipcRenderer.invoke('files:import', paths, dir),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  checkFiles: (paths) => ipcRenderer.invoke('file:check', paths),
  listImports: (dir) => ipcRenderer.invoke('imports:list', dir),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  applyShortcuts: (entries) => ipcRenderer.invoke('shortcuts:apply', entries),
  onShortcut: on('sf:shortcut'),
  saveRecording: (opts) => ipcRenderer.invoke('rec:save', opts),
  mediaCut: (opts) => ipcRenderer.invoke('media:cut', opts),
  audioAutoSetup: (opts) => ipcRenderer.invoke('audio:autoSetup', opts),
  restoreMic: (force) => ipcRenderer.send('audio:restore', !!force),
  ytEnsure: () => ipcRenderer.invoke('yt:ensure'),
  ytInfo: (url) => ipcRenderer.invoke('yt:info', url),
  ytDownload: (opts) => ipcRenderer.invoke('yt:download', opts),
  ytCancel: () => ipcRenderer.invoke('yt:cancel'),
  onYtProgress: on('sf:ytprogress'),
  onMenuAction: on('sf:menu'),
  menuState: (s) => ipcRenderer.send('menu:state', s),
  uiLog: (m) => ipcRenderer.send('ui:log', m),
  // Rapports d'erreurs opt-in : le renderer ne fait que relayer des
  // evenements d'erreur JS ; le main decide seul si quelque chose est
  // collecte/envoye (consentement settings.crashReport).
  reportError: (r) => ipcRenderer.send('report:error', r),
  reportConsent: (v) => ipcRenderer.send('report:consent', v),
  desktopSource: () => ipcRenderer.invoke('desktop:source'),
  audioTapStart: () => ipcRenderer.invoke('audio:tapStart'),
  audioTapStop: () => ipcRenderer.invoke('audio:tapStop'),
  cableDownload: () => ipcRenderer.invoke('cable:openPage'),
  openDir: (d) => ipcRenderer.invoke('shell:openDir', d),
  seedSounds: () => ipcRenderer.invoke('sounds:seed'),
  onTapDead: on('sf:tapDead'),
  onTapPcm: on('sf:tapPcm'),
  onMicWatchOff: on('sf:micWatchOff'),
  onPowerResume: on('sf:powerResume'),
});
