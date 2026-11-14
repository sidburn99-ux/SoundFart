const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.webm', '.mp4', '.mkv', '.mov', '.m4v'];
let win = null;

// ---------- journal d'erreurs : %APPDATA%\SoundFart\soundfart.log ----------
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'soundfart.log');
    // Borne la taille : au-dela de 2 Mo on ne garde que les 500 derniers Ko
    try {
      if (fs.statSync(f).size > 2 * 1024 * 1024) {
        fs.writeFileSync(f, fs.readFileSync(f).slice(-500 * 1024));
      }
    } catch {}
    fs.appendFileSync(f, new Date().toISOString() + ' ' + msg + '\n');
  } catch {}
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Mode test : --test-profile isole config/outils/logs dans %TEMP%\SoundFart-test (config reelle intacte)
if (process.argv.includes('--test-profile')) {
  app.setPath('userData', path.join(os.tmpdir(), 'SoundFart-test'));
}

const configFile = () => path.join(app.getPath('userData'), 'config.json');

// ---------- config ----------
function migrateOldConfig() {
  // Reprise des sons de l'ancienne version Python (chemins uniquement)
  try {
    const old = path.join(app.getPath('appData'), 'DiscordSoundboard', 'config.json');
    const j = JSON.parse(fs.readFileSync(old, 'utf-8'));
    if (!Array.isArray(j.sounds) || !j.sounds.length) return null;
    const now = Date.now();
    return {
      version: 1,
      sounds: j.sounds.map((s, i) => ({
        id: 's' + now.toString(36) + i,
        name: s.name || path.basename(s.path, path.extname(s.path)),
        path: s.path,
        categoryId: null,
        volume: 100,
        addedAt: now + i,
        plays: 0,
      })),
    };
  } catch {
    return null;
  }
}

// ---------- menu application (F11) ----------
let menuState = {};
const sendMenu = (action) => () => { if (win && !win.isDestroyed()) win.webContents.send('sf:menu', action); };

function buildMenu() {
  const st = menuState || {};
  const views = [['all', 'Tous les sons'], ['fav', '★ Favoris'], ['none', 'Sans catégorie']]
    .concat((st.categories || []).map((c) => [c.id, c.name]));
  return Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Ajouter des sons…', accelerator: 'CmdOrCtrl+O', click: sendMenu('add') },
      { label: 'Importer depuis YouTube…', click: sendMenu('youtube') },
      { label: 'Enregistreur', click: sendMenu('recorder') },
      { type: 'separator' },
      { label: 'Exporter la configuration…', click: sendMenu('export') },
      { label: 'Importer une configuration…', click: sendMenu('import') },
      { type: 'separator' },
      { label: 'Quitter', role: 'quit' },
    ]},
    { label: 'Édition', submenu: [
      { label: 'Rechercher un son…', accelerator: 'CmdOrCtrl+F', click: sendMenu('search') },
    ]},
    { label: 'Audio', submenu: [
      { label: 'Stopper tous les sons', accelerator: st.stopShortcut || undefined, click: sendMenu('stop') },
      { type: 'separator' },
      { label: 'Réglages audio…', click: sendMenu('settings') },
    ]},
    { label: 'Affichage', submenu: [
      { label: 'Vue', submenu: views.map(([id, name]) => ({
        label: name, type: 'radio', checked: st.cat === id, click: sendMenu('view:' + id),
      })) },
      { type: 'separator' },
      { label: 'Regrouper par catégorie', type: 'checkbox', checked: !!st.groupByCat, click: sendMenu('group') },
    ]},
    { label: 'Aide', submenu: [
      { label: 'Outils de développement', accelerator: 'F12', click: () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); } },
      { type: 'separator' },
      { label: 'À propos de SoundFart', click: sendMenu('about') },
    ]},
  ]);
}

ipcMain.on('menu:state', (_e, s) => {
  menuState = s || {};
  try { Menu.setApplicationMenu(buildMenu()); } catch {}
});

ipcMain.on('ui:log', (_e, m) => log('[ui] ' + String(m).slice(0, 800)));

ipcMain.handle('desktop:source', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  } catch { return null; }
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('config:load', () => {
  const f = configFile();
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return migrateOldConfig();
    try { fs.renameSync(f, f + '.broken'); } catch {}
    return null;
  }
});

ipcMain.handle('config:save', (_e, cfg) => {
  const f = configFile();
  const tmp = f + '.tmp';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, f);
  return true;
});

// ---------- fichiers ----------
function expand(paths, depth = 0, seen = { n: 0 }) {
  const out = [];
  for (const p of paths) {
    if (seen.n >= 5000) break; // garde-fou : pas plus de 5000 entrees inspectees
    seen.n++;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (depth < 3) out.push(...expand(fs.readdirSync(p).map((n) => path.join(p, n)), depth + 1, seen));
      } else if (AUDIO_EXT.includes(path.extname(p).toLowerCase())) {
        out.push(p);
      }
    } catch {}
  }
  return out;
}

ipcMain.handle('files:expand', (_e, paths) => expand(paths || []));

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Ajouter des sons',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT.map((e) => e.slice(1)) }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('files:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir le dossier de stockage',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('file:read', async (_e, p) => {
  if (!AUDIO_EXT.includes(path.extname(String(p)).toLowerCase())) throw new Error('Format non autorise');
  return fs.promises.readFile(p);
});

ipcMain.handle('file:check', (_e, paths) => (paths || []).filter((p) => !fs.existsSync(p)));
ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));

// ---------- raccourcis clavier globaux ----------
ipcMain.handle('shortcuts:apply', (_e, entries) => {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const { key, accel } of entries || []) {
    if (!key || !accel) continue;
    try {
      const ok = globalShortcut.register(accel, () => {
        if (win && !win.isDestroyed()) win.webContents.send('sf:shortcut', key);
      });
      if (!ok) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return failed;
});

// ---------- enregistreur : sauvegarde d'un fichier audio ----------
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'son';

ipcMain.handle('rec:save', async (_e, { data, name, ext, dir }) => {
  const rdir = path.join(storageRoot(dir), 'recordings');
  fs.mkdirSync(rdir, { recursive: true });
  const base = safeName(name);
  const extOk = ['.webm', '.m4a', '.mp4', '.ogg', '.wav', '.opus'].includes(ext) ? ext : '.webm';
  let p = path.join(rdir, base + extOk);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(rdir, `${base}-${i}${extOk}`);
  const buf = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data);
  await fs.promises.writeFile(p, buf);
  return p;
});

// ---------- ffmpeg : coupe physique des extraits (MP3) ----------
function findFile(dir, name, depth = 0) {
  if (depth > 4) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name, depth + 1); if (r) return r; }
    else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

// Telecharge et extrait ffmpeg.exe une seule fois (~80 Mo, build "essentials" de gyan.dev)
async function ensureFfmpeg() {
  if (fs.existsSync(ffmpegPath())) return ffmpegDir();
  // ffmpeg.exe deja extrait quelque part dans ffmpegDir() : on l'utilise tel quel, sans recopier
  if (fs.existsSync(ffmpegDir())) {
    const existing = findFile(ffmpegDir(), 'ffmpeg.exe');
    if (existing) return path.dirname(existing);
  }
  fs.mkdirSync(toolsDir(), { recursive: true });
  const zip = path.join(toolsDir(), 'ffmpeg.zip');
  try {
    await downloadFile(FFMPEG_URL, zip, (f) => {
      if (win && !win.isDestroyed()) win.webContents.send('sf:ytprogress', Math.round(f * 100));
    });
    const dest = ffmpegDir();
    fs.mkdirSync(dest, { recursive: true });
    try {
      await execFileP('tar', ['-xf', zip, '-C', dest, '*ffmpeg.exe'], { timeout: 180000 });
    } catch {
      await execFileP('tar', ['-xf', zip, '-C', dest], { timeout: 300000 });
    }
    const found = findFile(dest, 'ffmpeg.exe');
    if (found && found !== ffmpegPath()) {
      // deplacer (rename) plutot que copier quand c'est possible
      try { fs.renameSync(found, ffmpegPath()); } catch { fs.copyFileSync(found, ffmpegPath()); }
    }
  } finally {
    try { fs.unlinkSync(zip); } catch {}
  }
  if (!fs.existsSync(ffmpegPath())) throw new Error('ffmpeg.exe introuvable dans l\'archive téléchargée.');
  return ffmpegDir();
}

ipcMain.handle('media:cut', async (_e, { input, start, end, dir }) => {
  const fdir = await ensureFfmpeg();
  const outDir = path.join(storageRoot(dir), 'cuts');
  fs.mkdirSync(outDir, { recursive: true });
  const base = safeName(path.basename(String(input), path.extname(String(input)))) + '_extrait';
  let out = path.join(outDir, base + '.mp3');
  for (let i = 1; fs.existsSync(out); i++) out = path.join(outDir, `${base}-${i}.mp3`);
  const dur = Math.max(0.1, (+end || 0) - (+start || 0));
  await execFileP(path.join(fdir, 'ffmpeg.exe'),
    ['-y', '-ss', String(Math.max(0, +start || 0)), '-i', String(input), '-t', String(dur), '-vn', '-c:a', 'libmp3lame', '-q:a', '4', out],
    { timeout: 600000 });
  return out;
});

// ---------- import YouTube (yt-dlp, telecharge au premier usage) ----------
const toolsDir = () => path.join(app.getPath('userData'), 'tools');
const ytdlpPath = () => path.join(toolsDir(), 'yt-dlp.exe');
const ffmpegDir = () => path.join(toolsDir(), 'ffmpeg');
const ffmpegPath = () => path.join(ffmpegDir(), 'ffmpeg.exe');
const audioToolPath = () => path.join(toolsDir(), 'AudioEndpoint.exe');
const audioTapPath = () => path.join(toolsDir(), 'AudioTap.exe');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

// Dossier de stockage choisi par l'utilisateur (imports/, recordings/, cuts/) ; defaut = userData
function storageRoot(dir) {
  const d = dir && String(dir).trim();
  return d || app.getPath('userData');
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, n) => {
      const req = https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (n > 5) return reject(new Error('trop de redirections'));
          return get(res.headers.location, n + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => { got += c.length; if (total) onProgress(got / total); });
        res.on('error', (e) => { out.destroy(); reject(e); });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    };
    get(url, 0);
  });
}

async function ensureYtDlp() {
  if (fs.existsSync(ytdlpPath())) return;
  fs.mkdirSync(toolsDir(), { recursive: true });
  const tmp = ytdlpPath() + '.part';
  try {
    await downloadFile(YTDLP_URL, tmp, (f) => {
      if (win && !win.isDestroyed()) win.webContents.send('sf:ytprogress', Math.round(f * 100));
    });
    fs.renameSync(tmp, ytdlpPath());
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function runYt(args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlpPath(), args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', (d) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(String(d));
      if (m) onProgress(parseFloat(m[1]));
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('yt-dlp a échoué : ' + err.slice(-500).trim()))));
  });
}

const ytProgress = (f) => {
  if (win && !win.isDestroyed()) win.webContents.send('sf:ytprogress', typeof f === 'number' && f <= 1 ? Math.round(f * 100) : Math.round(f));
};

ipcMain.handle('yt:ensure', async () => { await ensureYtDlp(); ytProgress(-1); return true; });

ipcMain.handle('yt:info', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('URL invalide');
  await ensureYtDlp();
  ytProgress(-1);
  const { stdout } = await execFileP(ytdlpPath(), ['--dump-single-json', '--no-playlist', '--no-warnings', url], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  const j = JSON.parse(stdout);
  return { title: j.title || '', duration: j.duration || 0, url: j.webpage_url || url };
});

ipcMain.handle('yt:download', async (_e, { url, start, end, dir }) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('URL invalide');
  await ensureYtDlp();
  const impDir = path.join(storageRoot(dir), 'imports');
  fs.mkdirSync(impDir, { recursive: true });
  const before = new Set(fs.readdirSync(impDir));
  const outTpl = path.join(impDir, '%(id)s.%(ext)s');
  const baseArgs = ['--no-playlist', '--no-warnings', '-o', outTpl];
  let sectioned = false;
  // ffmpeg permet de ne telecharger + convertir que l'extrait (MP3 leger) ; sinon repli sur l'audio complet + trim
  let ffDir = null;
  try { ffDir = await ensureFfmpeg(); } catch {}
  if (ffDir && end > start) {
    try {
      await runYt([...baseArgs, '--ffmpeg-location', ffDir, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--download-sections', `*${start}-${end}`, url], ytProgress);
      sectioned = true;
    } catch {}
  }
  if (!sectioned) {
    ytProgress(-1);
    await runYt([...baseArgs, '-f', 'bestaudio/best', url], ytProgress);
  }
  const created = fs.readdirSync(impDir).filter((f) => !before.has(f) && !f.startsWith('.'));
  if (!created.length) throw new Error('Aucun fichier audio produit.');
  const newest = created.map((f) => path.join(impDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  ytProgress(-1);
  return { path: newest, sectioned };
});

// ---------- bascule automatique de l'entree micro (CABLE Output) ----------
// Au lancement : si active, le peripherique d'enregistrement par defaut passe sur le cable virtuel.
// A la fermeture (ou au prochain lancement si crash) : le peripherique d'origine est restaure.
// Discord doit utiliser « Defaut / OS default » comme peripherique d'entree pour suivre ce changement.
const restoreFile = () => path.join(app.getPath('userData'), 'audio-restore.json');
const VIRTUAL_RE_MAIN = /cable|virtual|voicemeeter|vb-audio/i;
const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

let audioToolPromise = null; // evite deux csc.exe simultanes sur le meme exe

async function ensureAudioTool() {
  if (fs.existsSync(audioToolPath())) return audioToolPath();
  if (audioToolPromise) return audioToolPromise;
  audioToolPromise = (async () => {
    try {
      const csInAsar = path.join(__dirname, 'AudioEndpoint.cs');
      const csc = CSC_CANDIDATES.find((p) => fs.existsSync(p));
      // dans l'exe package, __dirname est dans app.asar : illisible par csc.exe externe.
      // On extrait la source vers un vrai fichier temporaire avant compilation.
      const cs = path.join(toolsDir(), 'AudioEndpoint.cs');
      if (!csc || !fs.existsSync(csInAsar)) return null;
      fs.mkdirSync(toolsDir(), { recursive: true });
      fs.writeFileSync(cs, fs.readFileSync(csInAsar));
      await execFileP(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/out:' + audioToolPath(), cs], { timeout: 60000 });
      return fs.existsSync(audioToolPath()) ? audioToolPath() : null;
    } finally {
      audioToolPromise = null;
    }
  })();
  return audioToolPromise;
}

function audioExec(tool, args) {
  return execFileSync(tool, args, { encoding: 'utf8', timeout: 15000 });
}

function parseEndpoints(out) {
  return String(out).split(/\r?\n/).filter(Boolean).map((l) => {
    const [flow, id, ...rest] = l.split('|');
    return { flow, id, name: rest.join('|') || id };
  });
}

function parseGet(out) {
  const r = { console: '', comm: '' };
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^(console|comm|multi)=(.*)$/.exec(line.trim());
    if (m) r[m[1]] = m[2];
  }
  return r;
}

function findCableCapture(endpoints, cableLabel) {
  const caps = endpoints.filter((e) => e.flow === 'capture');
  if (!caps.length) return null;
  const base = String(cableLabel || '');
  const candidates = [];
  if (base) {
    candidates.push(base.replace(/input/ig, 'Output'));
    candidates.push(base.replace(/input/ig, 'output'));
    candidates.push(base);
  }
  for (const cand of candidates) {
    const hit = caps.find((e) => e.name.toLowerCase().includes(cand.toLowerCase()));
    if (hit) return hit;
  }
  return caps.find((e) => /output/i.test(e.name) && VIRTUAL_RE_MAIN.test(e.name))
    || caps.find((e) => /cable/i.test(e.name));
}

function restoreMicNow(tool) {
  try {
    if (!tool || !fs.existsSync(restoreFile())) return false;
    const prev = JSON.parse(fs.readFileSync(restoreFile(), 'utf-8'));
    // Priorite : peripherique par defaut Windows (role multimedia, non ecrase par le role comm),
    // puis le peripherique d'origine enregistre, puis le 1er peripherique non virtuel.
    // Comme ca la restauration suit le micro par defaut de l'utilisateur, quel qu'il soit.
    const eps = parseEndpoints(audioExec(tool, ['list']));
    const nameOf = (id) => { const e = eps.find((x) => x.id === id); return e ? e.name : ''; };
    const nonVirtual = (id) => !!id && !!nameOf(id) && !VIRTUAL_RE_MAIN.test(nameOf(id));
    const fb = eps.find((e) => e.flow === 'capture' && !VIRTUAL_RE_MAIN.test(e.name));
    const fallbackId = fb ? fb.id : '';
    // Priorite : peripherique par defaut Windows (role multimedia), puis les ids d'origine
    // par role (console ET comm preserves separement), puis le 1er non virtuel.
    let defId = '';
    try {
      const g = parseGet(audioExec(tool, ['get', 'capture']));
      if (nonVirtual(g.multi)) defId = g.multi;
    } catch {}
    const cId = defId || (nonVirtual(prev.console) ? prev.console : '') || fallbackId;
    const mId = defId || (nonVirtual(prev.comm) ? prev.comm : '') || fallbackId;
    if (!cId && !mId) return false; // garde restoreFile pour reessayer plus tard
    audioExec(tool, ['set', 'capture', cId || mId, mId || cId, defId || cId || mId]);
    try { fs.unlinkSync(restoreFile()); } catch {}
    return true;
  } catch { return false; }
}

// ---------- sons par defaut (base de bibliotheque, bundled dans l'exe) ----------
const DEFAULT_SOUND_NAMES = {
  'dry-fart.mp3': 'Pet Sec',
  'Discord Notification.mp3': 'Discord Notification',
  'Ultra Kill.mp3': 'Ultra Kill',
  'ta-gueule_6iavH8Q.mp3': 'Homer Ta gueule',
  'sarkozy-_-quelle-indignite.mp3': 'Quelle Indignité',
};

ipcMain.handle('sounds:seed', () => {
  try {
    const src = path.join(__dirname, 'assets', 'sounds');
    const dst = path.join(app.getPath('userData'), 'default-sounds');
    fs.mkdirSync(dst, { recursive: true });
    return fs.readdirSync(src).filter((f) => DEFAULT_SOUND_NAMES[f]).map((f) => {
      const out = path.join(dst, f);
      if (!fs.existsSync(out)) fs.copyFileSync(path.join(src, f), out);
      return { name: DEFAULT_SOUND_NAMES[f], path: out };
    });
  } catch { return []; }
});

ipcMain.handle('audio:autoSetup', async (_e, { enabled, cableLabel }) => {
  try {
    const tool = await ensureAudioTool();
    if (!tool) return { ok: false, err: 'outil audio introuvable (csc.exe absent ?)' };
    if (!enabled) { restoreMicNow(tool); return { ok: true, changed: false }; }
    let eps = parseEndpoints(audioExec(tool, ['list']));
    let target = findCableCapture(eps, cableLabel);
    if (!target && await ensureCableDriver()) {
      eps = parseEndpoints(audioExec(tool, ['list']));
      target = findCableCapture(eps, cableLabel);
    }
    if (!target) { restoreMicNow(tool); return { ok: false, err: 'peripherique « CABLE Output » introuvable (VB-CABLE non installe)' }; }
    let cur = parseGet(audioExec(tool, ['get', 'capture']));
    if (cur.console === target.id && cur.comm === target.id) {
      // Deja bascule : on ne touche a rien (restoreFile reste = marqueur de bascule active)
      return { ok: true, changed: false, device: target.name };
    }
    // Pas encore sur le cable : recuperer un eventuel etat incoherent puis memoriser le vrai peripherique
    if (fs.existsSync(restoreFile())) {
      restoreMicNow(tool);
      cur = parseGet(audioExec(tool, ['get', 'capture']));
    }
    if (!fs.existsSync(restoreFile())) {
      fs.writeFileSync(restoreFile(), JSON.stringify({ console: cur.console, comm: cur.comm }));
    }
    audioExec(tool, ['set', 'capture', target.id, target.id, target.id]);
    return { ok: true, changed: true, device: target.name };
  } catch (e) {
    return { ok: false, err: e.message };
  }
});

ipcMain.on('audio:restore', () => {
  try {
    const tool = audioToolPath();
    if (fs.existsSync(tool) && fs.existsSync(restoreFile())) restoreMicNow(tool);
  } catch {}
});

// ---------- AudioTap : loopback systeme -> CABLE Input (enregistreur « audio du PC ») ----------
// Contourne l'impossibilite de capturer la sortie systeme via Chromium (getDisplayMedia/loopback
// renvoient « Could not start audio source » ou du silence sur certaines configs).
let audioTapProc = null;
let audioTapKilling = false; // vrai entre kill() et l'evenement 'exit' (anti double spawn)

let audioTapPromise = null; // evite deux csc.exe simultanes sur le meme exe

async function ensureAudioTap() {
  if (fs.existsSync(audioTapPath())) return audioTapPath();
  if (audioTapPromise) return audioTapPromise;
  audioTapPromise = (async () => {
    try {
      const csInAsar = path.join(__dirname, 'AudioTap.cs');
      const csc = CSC_CANDIDATES.find((p) => fs.existsSync(p));
      if (!csc || !fs.existsSync(csInAsar)) return null;
      fs.mkdirSync(toolsDir(), { recursive: true });
      const cs = path.join(toolsDir(), 'AudioTap.cs');
      fs.writeFileSync(cs, fs.readFileSync(csInAsar));
      await execFileP(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/out:' + audioTapPath(), cs], { timeout: 60000 });
      return fs.existsSync(audioTapPath()) ? audioTapPath() : null;
    } finally {
      audioTapPromise = null;
    }
  })();
  return audioTapPromise;
}

ipcMain.handle('audio:tapStart', async () => {
  try {
    const tool = await ensureAudioTap();
    if (!tool) return { ok: false, err: 'outil audio introuvable (csc.exe absent ?)' };
    if (audioTapProc && audioTapProc.exitCode === null) return { ok: true };
    // Un tapStop vient peut-etre de tuer l'ancien processus sans que 'exit' soit encore arrive :
    // on attend sa sortie avant d'en respawn un (sinon deux AudioTap ecriraient dans le cable).
    if (audioTapKilling) {
      const t0 = Date.now();
      while (audioTapKilling && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 200));
      if (audioTapKilling) return { ok: false, err: 'arrêt de l\'ancien AudioTap en cours' };
    }
    // args[1] = pid du parent : AudioTap s'auto-termine si ce process meurt (anti-orphelin)
    audioTapProc = spawn(tool, ['CABLE Input', String(process.pid)], { stdio: ['ignore', 'ignore', 'pipe'] });
    audioTapProc.stderr.on('data', (d) => {
      const line = String(d).trim();
      if (/ERREUR|echoue|introuvable/i.test(line)) log('[audiotap] ' + line.slice(0, 300));
    });
    audioTapProc.on('exit', () => {
      const wasKilled = audioTapKilling;
      audioTapProc = null;
      audioTapKilling = false;
      // Mort non volontaire (crash AudioTap / peripherique disparu) : on previent le renderer
      if (!wasKilled && win && !win.isDestroyed()) win.webContents.send('sf:tapDead', true);
    });
    audioTapProc.on('error', () => { audioTapProc = null; audioTapKilling = false; });
    await new Promise((r) => setTimeout(r, 700));
    if (!audioTapProc || audioTapProc.exitCode !== null)
      return { ok: false, err: 'AudioTap s\'est arrêté au démarrage' };
    return { ok: true };
  } catch (e) { return { ok: false, err: e.message }; }
});

ipcMain.handle('audio:tapStop', () => {
  if (audioTapProc) {
    audioTapKilling = true;
    try { audioTapProc.kill(); } catch { audioTapKilling = false; }
  }
  audioTapProc = null;
  return { ok: true };
});

// ---------- installation silencieuse de VB-CABLE (bundled, driver noyau obligatoire) ----------
// Un peripherique audio virtuel ne peut exister sans driver noyau : on embarque l'installateur
// officiel VB-Audio et on le lance en /S (elevation UAC automatique, aucune fenetre d'install).
const cableSetupSrc = () => path.join(__dirname, 'vendor', 'vbcable');
const cableSetupDir = () => path.join(toolsDir(), 'vbcable');
const cableSetupExe = () => path.join(cableSetupDir(), 'VBCABLE_Setup_x64.exe');
const cableSnoozeFile = () => path.join(app.getPath('userData'), 'cable-install-snooze.json');
const CABLE_SNOOZE_MS = 7 * 24 * 3600 * 1000; // ne re-demande pas l'UAC avant 7 jours si refuse
let cableInstallPromise = null;

function hasVirtualCable(endpoints) {
  // Specifiquement VB-CABLE (« CABLE » dans le nom) — pas n'importe quel device virtuel
  // (Voicemeeter, Sonic Studio…) sinon l'installateur ne serait jamais lance.
  return endpoints.some((e) => e.flow === 'render' && /cable/i.test(e.name) && VIRTUAL_RE_MAIN.test(e.name));
}

async function ensureCableDriver() {
  if (cableInstallPromise) return cableInstallPromise;
  cableInstallPromise = (async () => {
    try {
      const tool = await ensureAudioTool();
      if (!tool) { log('[cable] outil audio introuvable'); return false; }
      let eps = parseEndpoints(audioExec(tool, ['list']));
      if (hasVirtualCable(eps)) { try { fs.unlinkSync(cableSnoozeFile()); } catch {} return true; }
      // Si l'utilisateur a refuse l'UAC recemment, ne pas re-demander tout de suite.
      try {
        const sn = JSON.parse(fs.readFileSync(cableSnoozeFile(), 'utf-8'));
        if (sn && Date.now() - sn.at < CABLE_SNOOZE_MS) return false;
      } catch {}
      if (!fs.existsSync(cableSetupSrc())) { log('[cable] pack VB-CABLE absent du bundle'); return false; }
      // L'installateur a besoin de tout le pack (.inf/.sys/.cat) a cote de lui, pas juste l'exe.
      fs.mkdirSync(cableSetupDir(), { recursive: true });
      for (const f of fs.readdirSync(cableSetupSrc())) {
        const dst = path.join(cableSetupDir(), f);
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(cableSetupSrc(), f), dst);
      }
      if (!fs.existsSync(cableSetupExe())) { log('[cable] VBCABLE_Setup_x64.exe introuvable'); return false; }
      log('[cable] aucun peripherique virtuel detecte -> installation silencieuse VB-CABLE');
      // Start-Process -Verb RunAs declenche l'UAC ; /S = install silencieuse. Si l'user refuse l'UAC, ca leve une erreur.
      await execFileP('powershell.exe', ['-NoProfile', '-Command',
        `Start-Process -FilePath '${cableSetupExe().replace(/'/g, "''")}' -ArgumentList '/S' -Verb RunAs -Wait`],
        { timeout: 300000 });
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try { eps = parseEndpoints(audioExec(tool, ['list'])); } catch { continue; }
        if (hasVirtualCable(eps)) {
          log('[cable] VB-CABLE installe');
          offerCableReboot();
          return true;
        }
      }
      log('[cable] VB-CABLE toujours absent apres installation');
      try { fs.writeFileSync(cableSnoozeFile(), JSON.stringify({ at: Date.now() })); } catch {}
      return false;
    } catch (e) {
      log('[cable] installation VB-CABLE echouee/annulee: ' + e.message);
      // UAC refuse ou erreur : on retentera dans 7 jours (ou au prochain lancement si le fichier est absent)
      try { fs.writeFileSync(cableSnoozeFile(), JSON.stringify({ at: Date.now() })); } catch {}
      return false;
    } finally {
      cableInstallPromise = null;
    }
  })();
  return cableInstallPromise;
}

// Arme une relance unique de l'app au prochain demarrage (RunOnce, supprime par Windows
// apres execution) : le reboot d'activation VB-CABLE ramene l'utilisateur sur SoundFart.
function armPostRebootRelaunch() {
  try {
    execFileSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      '/v', 'SoundFart', '/t', 'REG_SZ', '/d', `"${process.execPath}"`, '/f'], { timeout: 5000 });
    log('[cable] relance post-reboot enregistree');
  } catch (e) { log('[cable] armPostRebootRelaunch: ' + e.message); }
}

// VB-CABLE n'est pleinement actif qu'apres un reboot : on propose le redemarrage a l'utilisateur.
function offerCableReboot() {
  try {
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'SoundFart — VB-CABLE installé',
      message: 'Le composant audio virtuel a été installé.',
      detail: 'VB-CABLE nécessite un redémarrage de Windows pour fonctionner correctement.\n\nRedémarrer maintenant ? (délai de 60 s, annulable avec « shutdown /a »)',
      buttons: ['Redémarrer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    }).then((r) => {
      if (r.response !== 0) return;
      armPostRebootRelaunch();
      try {
        execFileSync('shutdown', ['/r', '/t', '60', '/c', 'SoundFart : redemarrage pour activer VB-CABLE'], { timeout: 10000 });
        log('[cable] redemarrage programme dans 60 s');
      } catch (e) { log('[cable] shutdown echoue: ' + e.message); }
    });
  } catch (e) { log('[cable] offerCableReboot: ' + e.message); }
}

// Watchdog : re-verifie periodiquement que l'entree par defaut est toujours sur le cable.
// Couvre le cas ou Discord (ou un peripherique) demarre/change le defaut pendant que
// SoundFart tourne — la bascule est re-appliquee automatiquement.
function watchdogMic() {
  try {
    const tool = audioToolPath();
    if (!tool || !fs.existsSync(tool) || !fs.existsSync(restoreFile()) || !fs.existsSync(configFile())) return;
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf-8'));
    const st = cfg && cfg.settings;
    if (!st || !st.autoSwitchMic) return;
    const eps = parseEndpoints(audioExec(tool, ['list']));
    const target = findCableCapture(eps, st.cableLabel);
    if (!target) return;
    const cur = parseGet(audioExec(tool, ['get', 'capture']));
    if (cur.console !== target.id || cur.comm !== target.id) {
      audioExec(tool, ['set', 'capture', target.id, target.id, target.id]);
      log('[mic-watchdog] entree re-basculee sur ' + target.name);
    }
  } catch (e) { log('[mic-watchdog] ' + e.message); }
}

ipcMain.handle('cable:ensure', () => ensureCableDriver());

// ---------- fenetre ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0d18',
    title: 'SoundFart',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Diagnostic : F12 ou Ctrl+Maj+I ouvre les outils de developpement
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setMenuBarVisibility(!win.isMenuBarVisible());
      e.preventDefault();
      return;
    }
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const d = (event && typeof event === 'object' && 'message' in event)
      ? { level: event.level, message: event.message, line: event.lineNumber, sourceId: event.sourceId }
      : { level, message, line, sourceId };
    if (d.level === 3 || d.level === 'error') log(`[page] ${d.message} (${d.sourceId}:${d.line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => log('[crash] ' + JSON.stringify(details)));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`[load] ${code} ${desc} ${url}`);
    dialog.showErrorBox('SoundFart', `Impossible de charger l'interface (${desc}).\n\nVerifie que le dossier « src » (index.html, style.css, app.js) est bien a cote de main.js.`);
  });

  // index.html est normalement dans « src » ; on accepte aussi le meme dossier que main.js
  const indexPath = [path.join(__dirname, 'src', 'index.html'), path.join(__dirname, 'index.html')].find((p) => fs.existsSync(p));
  if (!indexPath) {
    log('[load] index.html introuvable dans ' + __dirname);
    dialog.showErrorBox('SoundFart', "Fichiers de l'interface introuvables.\n\nLe dossier « src » (contenant index.html, style.css et app.js) doit se trouver a cote de main.js.\n\nDossier actuel : " + __dirname);
    app.quit();
    return;
  }
  win.loadFile(indexPath);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  // Seul l'acces audio (micro) est autorise
  const allowed = (p) => p === 'media' || p === 'display-capture';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
  // Enregistreur : autorise getDisplayMedia pour capturer l'audio systeme (boucle locale Windows)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    log(`[displaymedia] requete audio=${request.audioRequested} video=${request.videoRequested}`);
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      log(`[displaymedia] ${sources.length} source(s) ecran`);
      if (sources.length) {
        const opts = {};
        if (request.videoRequested) opts.video = sources[0];
        if (request.audioRequested) opts.audio = 'loopback';
        callback(Object.keys(opts).length ? opts : {});
      } else callback({});
    }).catch((e) => { log('[displaymedia] getSources: ' + e.message); callback({}); });
  });
  createWindow();
  // Si aucun cable virtuel n'est present, installer VB-CABLE silencieusement en arriere-plan.
  ensureCableDriver().then((ok) => {
    if (ok && win && !win.isDestroyed()) win.webContents.send('sf:cableReady');
  });
  setInterval(watchdogMic, 10000);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { if (audioTapProc) audioTapProc.kill(); } catch {}
  audioTapProc = null;
  try {
    const tool = audioToolPath();
    if (fs.existsSync(tool) && fs.existsSync(restoreFile())) restoreMicNow(tool);
  } catch {}
});
