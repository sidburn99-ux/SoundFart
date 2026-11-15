const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const execFileP = promisify(execFile);
// Processus enfants long-terme (yt-dlp, ffmpeg) : Windows ne tue PAS les
// enfants a la sortie du parent — on les suit pour les tuer au will-quit,
// sinon un telechargement continue sans UI ni possibilite d'arret.
const childProcs = new Set();
const trackChild = (p) => { childProcs.add(p); p.on('close', () => childProcs.delete(p)); return p; };
const killTree = (pid) => { try { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch {} };
// execFile avec handle suivi (execFileP/promisify ne donne pas le ChildProcess).
function execFileTracked(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = trackChild(spawn(file, args, { ...opts, windowsHide: true }));
    let out = '', err = '', done = false;
    const timer = opts.timeout ? setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} reject(new Error('délai dépassé')); } }, opts.timeout) : null;
    if (p.stdout) p.stdout.on('data', (d) => { if (out.length < 4 * 1024 * 1024) out += d; });
    if (p.stderr) p.stderr.on('data', (d) => { if (err.length < 65536) err += d; });
    p.on('error', (e) => { if (!done) { done = true; if (timer) clearTimeout(timer); reject(e); } });
    p.on('close', (code) => {
      if (done) return;
      done = true; if (timer) clearTimeout(timer);
      code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error('exit ' + code + ' : ' + err.slice(-400).trim()));
    });
  });
}
const { AUDIO_EXT, VIRTUAL_RE: VIRTUAL_RE_MAIN, parseEndpoints, parseGet, findCableCapture, chooseRestoreIds, safeName, expandPaths, expandPathsAsync } = require('./lib/audio-utils');
let win = null;

// ---------- journal d'erreurs : SoundFart-data\soundfart.log ----------
// Niveaux : info (defaut) / warn / error. Identifiant de session unique par
// lancement pour correller les evenements. Borne de taille conservee (2 Mo).
const SESSION_ID = crypto.randomBytes(3).toString('hex');
const LOG_LEVELS = { info: 0, warn: 1, error: 2 };
let logLevel = LOG_LEVELS.info;
function log(msg, lvl = 'info') {
  try {
    if ((LOG_LEVELS[lvl] || 0) < logLevel) return;
    if (typeof msg !== 'string') msg = String(msg);
    if (msg.length > 4000) msg = msg.slice(0, 4000) + '…';
    const f = path.join(app.getPath('userData'), 'soundfart.log');
    // Borne la taille : au-dela de 2 Mo on ne garde que les 500 derniers Ko
    try {
      if (fs.statSync(f).size > 2 * 1024 * 1024) {
        fs.writeFileSync(f, fs.readFileSync(f).slice(-500 * 1024));
      }
    } catch {}
    fs.appendFileSync(f, new Date().toISOString() + ' [' + lvl + '] [s' + SESSION_ID + '] ' + msg + '\n');
  } catch {}
}

// Instance unique : la 2e instance sort immediatement via app.exit(0) — PAS app.quit(),
// qui declencherait will-quit et restaurerait le micro pendant que l'instance 1 tourne
// (couperait l'audio vers Discord). app.exit() n'emet ni before-quit ni will-quit.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Mode portable complet : dans l'exe portable, config/outils/logs vivent dans
// « SoundFart-data » a cote de l'exe (PORTABLE_EXECUTABLE_DIR est pose par
// electron-builder). Repli silencieux sur %APPDATA% si non accessible.
if (process.env.PORTABLE_EXECUTABLE_DIR && !process.argv.includes('--test-profile')) {
  const dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'SoundFart-data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    app.setPath('userData', dataDir);
  } catch {}
}

// Mode test : --test-profile isole config/outils/logs dans %TEMP%\SoundFart-test (config reelle intacte)
if (process.argv.includes('--test-profile')) {
  app.setPath('userData', path.join(os.tmpdir(), 'SoundFart-test'));
}

const configFile = () => path.join(app.getPath('userData'), 'config.json');

// Garde IPC : seuls les evenements venant de la page de l'app (index.html,
// dans src/ ou a la racine — le fallback racine existe, voir loadFile) sont acceptes.
const fromApp = (e) => {
  try {
    const u = new URL(e.senderFrame.url);
    return u.protocol === 'file:' && /[\\/]index\.html$/.test(u.pathname);
  } catch { return false; }
};
const H = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
  if (!fromApp(e)) throw new Error('accès IPC refusé (sender non autorisé)');
  return fn(e, ...args);
});

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
      { label: 'Stopper tous les sons', click: sendMenu('stop') }, // pas d'accelerator : le globalShortcut gere le global, le menu doublait le declenchement
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

ipcMain.on('menu:state', (e, s) => {
  if (!fromApp(e)) return;
  // Validation bornee : un payload aberrant ne doit ni crasher buildMenu ni
  // construire un menu geant (categories/sons viennent du renderer).
  const clean = (s && typeof s === 'object') ? s : {};
  menuState = {
    cat: typeof clean.cat === 'string' ? clean.cat.slice(0, 80) : 'all',
    groupByCat: !!clean.groupByCat,
    stopShortcut: typeof clean.stopShortcut === 'string' ? clean.stopShortcut.slice(0, 64) : '',
    categories: Array.isArray(clean.categories) ? clean.categories.slice(0, 500)
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map((c) => ({ id: c.id.slice(0, 80), name: c.name.slice(0, 80) })) : [],
  };
  try { Menu.setApplicationMenu(buildMenu()); } catch {}
});

ipcMain.on('ui:log', (e, m) => {
  if (fromApp(e)) log('[ui] ' + String(m).slice(0, 800));
});

H('desktop:source', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  } catch { return null; }
});

H('app:version', () => app.getVersion());
H('app:dataDir', () => app.getPath('userData'));

H('config:load', () => {
  const f = configFile();
  try {
    // Borne de taille : un config.json remplace par un fichier enorme gele le
    // demarrage (readFileSync + JSON.parse sur le thread main).
    const st = fs.statSync(f);
    if (st.size > 16 * 1024 * 1024) throw new Error('config.json trop volumineux');
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return migrateOldConfig();
    // Ne renommer en .broken-* que si le fichier est vraiment illisible comme
    // JSON : une erreur transitoire (EACCES, verrou AV/OneDrive) ne doit pas
    // deplacer une config validee ni la faire ecraser par le prochain save.
    const parseFail = e instanceof SyntaxError || /trop volumineux/.test(e.message);
    if (parseFail) {
      // horodate : plusieurs configs cassees successives ne s'ecrasent pas
      try { fs.renameSync(f, `${f}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`); } catch {}
    }
    // Dernier recours : la sauvegarde .bak (ecrite a chaque config:save) contient
    // la derniere config validee — mieux que de demarrer sur une bibliotheque vide.
    try { return JSON.parse(fs.readFileSync(f + '.bak', 'utf-8')); } catch {}
    return null;
  }
});

H('config:save', (_e, cfg) => {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('configuration invalide');
  const f = configFile();
  const tmp = f + '.tmp';
  const body = JSON.stringify(cfg, null, 2);
  if (body.length > 5 * 1024 * 1024) throw new Error('configuration trop volumineuse');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // sauvegarde .bak avant ecrasement : une ecriture cassee reste recuperable
  try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch {}
  fs.writeFileSync(tmp, body, 'utf-8');
  fs.renameSync(tmp, f);
  return true;
});

// ---------- fichiers ----------
// expandPaths/expandPathsAsync viennent de lib/audio-utils.js — testables via node:test.

H('files:expand', async (_e, paths) => {
  if (!Array.isArray(paths) || paths.length > 2000 || paths.some((p) => typeof p !== 'string')) throw new Error('chemins invalides');
  // Async : un dossier reseau injoignable ne doit pas geler le process main.
  return expandPathsAsync(paths);
});

H('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Ajouter des sons',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT.map((e) => e.slice(1)) }],
  });
  return r.canceled ? [] : r.filePaths;
});

H('files:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir le dossier de stockage',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

H('file:read', async (_e, p) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('chemin invalide');
  if (!AUDIO_EXT.includes(path.extname(p).toLowerCase())) throw new Error('Format non autorise');
  const st = await fs.promises.stat(p);
  if (!st.isFile() || st.size > 512 * 1024 * 1024) throw new Error('fichier audio trop volumineux (> 512 Mo)');
  return fs.promises.readFile(p);
});

H('file:check', async (_e, paths) => {
  if (!Array.isArray(paths) || paths.length > 5000) throw new Error('chemins invalides');
  // Async + par lots : jusqu'a 5000 existsSync synchrones sur le thread main
  // pouvaient geler l'app plusieurs secondes sur un volume reseau.
  const missing = [];
  const BATCH = 200;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const ok = await Promise.all(chunk.map(async (p) => {
      if (typeof p !== 'string') return false;
      try { await fs.promises.access(p); return true; } catch { return false; }
    }));
    chunk.forEach((p, j) => { if (typeof p !== 'string' || !ok[j]) missing.push(p); });
  }
  return missing;
});
H('file:reveal', async (_e, p) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('chemin invalide');
  try { await fs.promises.stat(p); } catch { throw new Error('fichier introuvable'); }
  shell.showItemInFolder(p);
});

// ---------- raccourcis clavier globaux ----------
H('shortcuts:apply', (_e, entries) => {
  // Valider TOUT avant unregisterAll : une entree malformee ne doit pas
  // effacer les raccourcis existants.
  const list = Array.isArray(entries) ? entries.slice(0, 5000) : [];
  const valid = [], failed = [];
  const seen = new Set();
  for (const { key, accel } of list) {
    if (typeof key !== 'string' || typeof accel !== 'string' || accel.length > 64 || !key) continue;
    if (seen.has(accel)) { failed.push(accel); continue; } // doublon : un seul peut etre enregistre
    seen.add(accel);
    valid.push({ key, accel });
  }
  if (list.length > 200) failed.push('>200 entrees ignorees');
  globalShortcut.unregisterAll();
  for (const { key, accel } of valid.slice(0, 200)) {
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

H('rec:save', async (_e, opts) => {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new Error('options invalides');
  const { data, name, ext, dir } = opts;
  if (data == null) throw new Error('données audio manquantes');
  const rdir = path.join(storageRoot(dir), 'recordings');
  fs.mkdirSync(rdir, { recursive: true });
  const base = safeName(name);
  const extOk = ['.webm', '.m4a', '.mp4', '.ogg', '.wav', '.opus'].includes(ext) ? ext : '.webm';
  let p = path.join(rdir, base + extOk);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(rdir, `${base}-${i}${extOk}`);
  const len = data instanceof ArrayBuffer ? data.byteLength : (data.byteLength != null ? data.byteLength : (data.length || 0));
  if (len > 512 * 1024 * 1024) throw new Error('enregistrement trop volumineux (> 512 Mo)');
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
let ffmpegPromise = null; // single-flight : un seul telechargement/extraction a la fois

async function ensureFfmpeg() {
  if (fs.existsSync(ffmpegPath())) return ffmpegDir();
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    try {
      // ffmpeg.exe deja extrait quelque part dans ffmpegDir() : on l'utilise tel quel
      if (fs.existsSync(ffmpegDir())) {
        const existing = findFile(ffmpegDir(), 'ffmpeg.exe');
        if (existing) return path.dirname(existing);
      }
      fs.mkdirSync(toolsDir(), { recursive: true });
      const zip = path.join(toolsDir(), 'ffmpeg.zip');
      try {
        await downloadVerified({
          url: FFMPEG_URL, dest: zip, sumsUrl: FFMPEG_SUMS_URL, match: 'ffmpeg-' + FFMPEG_VERSION + '-essentials_build.zip',
          onProgress: (f) => { if (win && !win.isDestroyed()) win.webContents.send('sf:ytprogress', Math.round(f * 100)); },
        });
        const dest = ffmpegDir();
        fs.mkdirSync(dest, { recursive: true });
        try {
          await execFileP('tar', ['-xf', zip, '-C', dest, '*ffmpeg.exe'], { timeout: 180000, windowsHide: true });
        } catch {
          await execFileP('tar', ['-xf', zip, '-C', dest], { timeout: 300000, windowsHide: true });
        }
        const found = findFile(dest, 'ffmpeg.exe');
        if (found && found !== ffmpegPath()) {
          try { fs.renameSync(found, ffmpegPath()); } catch { fs.copyFileSync(found, ffmpegPath()); }
        }
      } finally {
        try { fs.unlinkSync(zip); } catch {}
      }
      if (!fs.existsSync(ffmpegPath())) throw new Error('ffmpeg.exe introuvable dans l\'archive téléchargée.');
      return ffmpegDir();
    } finally {
      ffmpegPromise = null;
    }
  })();
  return ffmpegPromise;
}

H('media:cut', async (_e, { input, start, end, dir }) => {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('chemin source invalide');
  if (!AUDIO_EXT.includes(path.extname(String(input)).toLowerCase())) throw new Error('format audio non supporté');
  if (!Number.isFinite(+start) || +start < 0 || !Number.isFinite(+end) || +end <= +start) throw new Error('bornes de coupe invalides');
  const dur = +end - +start;
  if (dur > 30 * 60) throw new Error('extrait trop long (> 30 min)');
  try { const st = await fs.promises.stat(input); if (!st.isFile()) throw new Error('pas un fichier'); } catch (e) { throw new Error('fichier source introuvable'); }
  const fdir = await ensureFfmpeg();
  const outDir = path.join(storageRoot(dir), 'cuts');
  fs.mkdirSync(outDir, { recursive: true });
  const base = safeName(path.basename(String(input), path.extname(String(input)))) + '_extrait';
  let out = path.join(outDir, base + '.mp3');
  for (let i = 1; fs.existsSync(out); i++) out = path.join(outDir, `${base}-${i}.mp3`);
  // protocol_whitelist file : ffmpeg ne doit pas suivre de playlist/URL externe
  await execFileTracked(path.join(fdir, 'ffmpeg.exe'),
    ['-y', '-protocol_whitelist', 'file', '-ss', String(Math.max(0, +start || 0)), '-i', String(input), '-t', String(Math.max(0.1, dur)), '-vn', '-c:a', 'libmp3lame', '-q:a', '4', out],
    { timeout: 600000 });
  return out;
});

// ---------- import YouTube (yt-dlp, telecharge au premier usage) ----------
const toolsDir = () => path.join(app.getPath('userData'), 'tools');
const ytdlpPath = () => path.join(toolsDir(), 'yt-dlp.exe');
const ffmpegDir = () => path.join(toolsDir(), 'ffmpeg');
const ffmpegPath = () => path.join(ffmpegDir(), 'ffmpeg.exe');
// Versions epinglees + sommes publiees par les editeurs : un binaire telecharge n'est
// jamais execute sans verification SHA-256 (fichier de sommes de la release).
const YTDLP_VERSION = '2026.10.26';
const YTDLP_URL = (v) => `https://github.com/yt-dlp/yt-dlp/releases/download/${v}/yt-dlp.exe`;
const YTDLP_SUMS_URL = (v) => `https://github.com/yt-dlp/yt-dlp/releases/download/${v}/SHA2-256SUMS`;
const FFMPEG_VERSION = '9.0.2';
const FFMPEG_URL = `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const FFMPEG_SUMS_URL = FFMPEG_URL + '.sha256';

// Dossier de stockage choisi par l'utilisateur (imports/, recordings/, cuts/) ; defaut = userData.
// Un dir relatif ou non-chainable est ignore (protection contre une config importee malveillante).
function storageRoot(dir) {
  const d = dir && String(dir).trim();
  return d && path.isAbsolute(d) ? d : app.getPath('userData');
}

const validHttpUrl = (u) => {
  try { const x = new URL(String(u)); return x.protocol === 'https:'; } catch { return false; }
};

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, n) => {
      // Les redirections ne doivent jamais sortir du HTTPS (anti-downgrade MITM).
      if (!/^https:\/\//i.test(u)) return reject(new Error('redirection non-HTTPS refusée : ' + u.slice(0, 120)));
      const req = https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (n > 5) return reject(new Error('trop de redirections'));
          try {
            const loc = new URL(res.headers.location, u).href;
            return get(loc, n + 1);
          } catch { return reject(new Error('redirection invalide')); }
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        // Borne dure : yt-dlp ~100 Mo, ffmpeg.zip ~80 Mo — au-dela c'est anormal.
        if (total > 300 * 1024 * 1024) { res.resume(); return reject(new Error('fichier trop volumineux (' + total + ' octets)')); }
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (got > 300 * 1024 * 1024) { req.destroy(new Error('téléchargement trop volumineux')); return; }
          if (total) onProgress(got / total);
        });
        res.on('error', (e) => { out.destroy(); reject(e); });
        res.pipe(out);
        out.on('finish', () => {
          // Content-Length incoherent ou reponse tronquee : ne jamais valider
          // un fichier partiel (le SHA-256 ne protege que les binaires, pas .sums).
          if (total && got !== total) { out.destroy(); return reject(new Error('téléchargement tronqué (' + got + '/' + total + ' octets)')); }
          out.close(resolve);
        });
        out.on('error', reject);
      });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    };
    get(url, 0);
  });
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Telecharge un fichier puis verifie son SHA-256 contre le fichier de sommes publie
// avec la release (SHA2-256SUMS cote yt-dlp, .sha256 cote gyan.dev). En cas de
// mismatch ou d'indisponibilite des sommes : le fichier est supprime et on refuse
// de l'utiliser — jamais d'execution d'un binaire non verifie.
async function downloadVerified({ url, dest, sumsUrl, match, onProgress }) {
  await downloadFile(url, dest, onProgress || (() => {}));
  try {
    const sumsTmp = dest + '.sums';
    let sums;
    try {
      await downloadFile(sumsUrl, sumsTmp);
      sums = fs.readFileSync(sumsTmp, 'utf-8');
    } finally {
      try { fs.unlinkSync(sumsTmp); } catch {} // .sums partiel : jamais de residu
    }
    const lines = sums.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const pair = lines.map((l) => l.split(/\s+/)).find((p) => p.length === 2 && p[1] === match);
    // gyan.dev publie un hash nu sans nom de fichier (une seule ligne).
    const bare = lines.length === 1 && /^[0-9a-f]{64}$/i.test(lines[0]) ? lines[0] : null;
    const expected = pair ? pair[0] : bare;
    if (!expected) throw new Error('somme introuvable pour ' + match);
    const actual = await sha256File(dest);
    if (actual !== expected.toLowerCase()) throw new Error('SHA-256 mismatch pour ' + match);
    log('[dl] SHA-256 verifie: ' + match);
  } catch (e) {
    try { fs.unlinkSync(dest); } catch {}
    throw new Error('verification du téléchargement impossible : ' + e.message);
  }
}

const ytdlpMetaFile = () => path.join(toolsDir(), 'yt-dlp.json');
const YTDLP_UPDATE_MS = 7 * 24 * 3600 * 1000; // verification de mise a jour hebdomadaire
let ytdlpPromise = null;
let lastToolErr = ''; // dernier echec de compilation d'outil natif (remonte a l'UI)

async function ytdlpInstalledVersion() {
  try {
    const meta = JSON.parse(fs.readFileSync(ytdlpMetaFile(), 'utf-8'));
    if (meta && meta.version) return meta.version;
  } catch {}
  try {
    const { stdout } = await execFileP(ytdlpPath(), ['--version'], { timeout: 15000, windowsHide: true });
    const v = String(stdout).trim().split(/\s+/)[0];
    return /^\d{4}\.\d{2}\.\d{2}$/.test(v) ? v : null;
  } catch { return null; }
}

// Single-flight : maybeUpdateYtDlp(true) est appele hors de ensureYtDlp —
// deux telechargements concurrents partageaient le meme yt-dlp.exe.part.
let installYtDlpPromise = null;
function installYtDlp(version) {
  if (!installYtDlpPromise) {
    installYtDlpPromise = doInstallYtDlp(version).finally(() => { installYtDlpPromise = null; });
  }
  return installYtDlpPromise;
}

async function doInstallYtDlp(version) {
  fs.mkdirSync(toolsDir(), { recursive: true });
  const tmp = ytdlpPath() + '.part';
  try {
    await downloadVerified({
      url: YTDLP_URL(version), dest: tmp, sumsUrl: YTDLP_SUMS_URL(version), match: 'yt-dlp.exe',
      onProgress: (f) => { if (win && !win.isDestroyed()) win.webContents.send('sf:ytprogress', Math.round(f * 100)); },
    });
    fs.renameSync(tmp, ytdlpPath());
    fs.writeFileSync(ytdlpMetaFile(), JSON.stringify({ version, at: Date.now() }));
    log('[yt] yt-dlp ' + version + ' installe (SHA-256 verifie)');
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// Mise a jour periodeque : si la derniere verification a plus de 7 jours, on compare
// au dernier tag GitHub et on remplace yt-dlp (telechargement verifie SHA-256).
// Un echec de mise a jour ne casse jamais l'existant.
async function maybeUpdateYtDlp(force = false) {
  try {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(ytdlpMetaFile(), 'utf-8')) || {}; } catch {}
    if (!force && meta.at && Date.now() - meta.at < YTDLP_UPDATE_MS) return false;
    const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command',
      `(Invoke-RestMethod -Uri 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers @{'User-Agent'='SoundFart'}).tag_name`],
      { timeout: 20000, windowsHide: true });
    const latest = String(stdout).trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(latest)) return false;
    const current = (await ytdlpInstalledVersion()) || YTDLP_VERSION;
    fs.writeFileSync(ytdlpMetaFile(), JSON.stringify({ version: current, at: Date.now() })); // horodate la verification
    // Format AAAA.MM.JJ : comparaison lexicale = chronologique. Ne jamais
    // "mettre a jour" vers une version plus ancienne que celle installee.
    if (latest <= current) return false;
    log('[yt] mise a jour yt-dlp ' + current + ' -> ' + latest);
    try {
      await installYtDlp(latest);
      return true;
    } catch (e) {
      log('[yt] mise a jour echouee (version precedente conservee): ' + e.message, 'warn');
      return false;
    }
  } catch (e) { log('[yt] check mise a jour: ' + e.message, 'warn'); return false; }
}

async function ensureYtDlp() {
  if (ytdlpPromise) return ytdlpPromise;
  ytdlpPromise = (async () => {
    try {
      if (!fs.existsSync(ytdlpPath())) {
        await installYtDlp(YTDLP_VERSION);
      } else {
        await maybeUpdateYtDlp();
      }
    } finally {
      ytdlpPromise = null;
    }
  })();
  return ytdlpPromise;
}

function runYt(args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = trackChild(spawn(ytdlpPath(), args, { windowsHide: true }));
    let err = '', done = false;
    // Timeout global : un yt-dlp fige ne doit pas pendre le telechargement
    // indefiniment (le timeout inactivite de downloadVerified ne s'applique pas ici).
    const timer = setTimeout(() => { done = true; try { p.kill(); } catch {} reject(new Error('yt-dlp : délai dépassé (2 min)')); }, 120000);
    // yt-dlp ecrit la progression sur stderr (pas stdout).
    p.stderr.on('data', (d) => {
      const s = String(d);
      const m = /\[download\]\s+([\d.]+)%/.exec(s);
      if (m) onProgress(parseFloat(m[1]));
      if (err.length < 65536) err += d;
    });
    p.stdout.on('data', (d) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(String(d));
      if (m) onProgress(parseFloat(m[1]));
    });
    p.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    p.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error('yt-dlp a échoué : ' + err.slice(-500).trim()));
    });
  });
}

// f vaut -1 (reset) ou un pourcentage 0-100 deja pret (yt-dlp, downloadVerified).
// L'ancienne heuristique « f <= 1 -> fraction » affichait -100 % au reset et
// transformait 1 % en 100 %.
const ytProgress = (f) => {
  if (!win || win.isDestroyed()) return;
  const p = (typeof f === 'number' && f === -1) ? -1 : Math.round(+f || 0);
  win.webContents.send('sf:ytprogress', p);
};

H('yt:ensure', async () => { await ensureYtDlp(); ytProgress(-1); return true; });

// yt-dlp ne doit traiter que des URLs YouTube — sinon n'importe quel hote
// https:// serait accepte et telecharge via yt-dlp generique.
const YT_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const isYoutubeUrl = (url) => {
  try { return YT_HOST_RE.test(new URL(url).hostname); } catch { return false; }
};

H('yt:info', async (_e, url) => {
  if (!validHttpUrl(url) || !isYoutubeUrl(url)) throw new Error('URL YouTube invalide');
  await ensureYtDlp();
  ytProgress(-1);
  const { stdout } = await execFileP(ytdlpPath(), ['--dump-single-json', '--no-playlist', '--no-warnings', url], { maxBuffer: 64 * 1024 * 1024, timeout: 120000, windowsHide: true });
  const j = JSON.parse(stdout);
  return { title: j.title || '', duration: j.duration || 0, url: j.webpage_url || url };
});

H('yt:download', async (_e, { url, start, end, dir, full }) => {
  if (!validHttpUrl(url) || !isYoutubeUrl(url)) throw new Error('URL YouTube invalide');
  if (!full && (!Number.isFinite(+start) || +start < 0 || !Number.isFinite(+end) || +end <= +start)) throw new Error('bornes invalides');
  await ensureYtDlp();
  const tryDownload = async () => {
    const impDir = path.join(storageRoot(dir), 'imports');
    fs.mkdirSync(impDir, { recursive: true });
    // Template unique par requete : le « plus recent » ne peut pas etre un
    // fichier etranger cree pendant le telechargement (ni un autre import).
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const outTpl = path.join(impDir, 'sf-' + tag + '-%(id)s.%(ext)s');
    const baseArgs = ['--no-playlist', '--no-warnings', '-o', outTpl];
    let sectioned = false;
    // ffmpeg permet de ne telecharger + convertir que l'extrait (MP3 leger) ; sinon repli sur l'audio complet + trim
    let ffDir = null;
    try { ffDir = await ensureFfmpeg(); } catch {}
    // Sans timeline : on prend l'audio complet (trim dans l'editeur ensuite), pas d'extraction.
    if (!full && ffDir && end > start) {
      try {
        await runYt([...baseArgs, '--ffmpeg-location', ffDir, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--download-sections', `*${start}-${end}`, url], ytProgress);
        sectioned = true;
      } catch (e) { log('[yt] extrait sectionne impossible, repli sur l\'audio complet : ' + (e && e.message), 'warn'); }
    }
    if (!sectioned) {
      ytProgress(-1);
      await runYt([...baseArgs, '-f', 'bestaudio/best', url], ytProgress);
    }
    const created = fs.readdirSync(impDir).filter((f) => f.startsWith('sf-' + tag + '-'));
    if (!created.length) throw new Error('Aucun fichier audio produit.');
    const newest = created.map((f) => path.join(impDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    ytProgress(-1);
    return { path: newest, sectioned };
  };
  try {
    return await tryDownload();
  } catch (e) {
    // YouTube casse souvent les vieilles versions : une mise a jour forcee puis un seul retry.
    if (await maybeUpdateYtDlp(true)) return await tryDownload();
    throw e;
  }
});

// ---------- bascule automatique de l'entree micro (CABLE Output) ----------
// Au lancement : si active, le peripherique d'enregistrement par defaut passe sur le cable virtuel.
// A la fermeture (ou au prochain lancement si crash) : le peripherique d'origine est restaure.
// Discord doit utiliser « Defaut / OS default » comme peripherique d'entree pour suivre ce changement.
const restoreFile = () => path.join(app.getPath('userData'), 'audio-restore.json');
const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

const audioToolPath = () => path.join(toolsDir(), 'AudioEndpoint-' + toolHash(path.join(__dirname, 'AudioEndpoint.cs')) + '.exe');
const audioTapPath = () => path.join(toolsDir(), 'AudioTap-' + toolHash(path.join(__dirname, 'AudioTap.cs')) + '.exe');
const toolHash = (csPath) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(csPath)).digest('hex').slice(0, 8); } catch { return 'src'; }
};

let csQueue = Promise.resolve(); // une seule compilation C# a la fois, toutes sources confondues

function compileCs(csName, exeBase) {
  const run = csQueue.then(() => doCompileCs(csName, exeBase));
  csQueue = run.catch(() => {});
  return run;
}

async function doCompileCs(csName, exeBase) {
  const csInAsar = path.join(__dirname, csName + '.cs');
  const csc = CSC_CANDIDATES.find((p) => fs.existsSync(p));
  if (!csc) throw new Error('compilateur C# introuvable (csc.exe absent — installe .NET Framework 4.x)');
  if (!fs.existsSync(csInAsar)) throw new Error(csName + '.cs absent du bundle');
  const h = toolHash(csInAsar);
  fs.mkdirSync(toolsDir(), { recursive: true });
  const cs = path.join(toolsDir(), csName + '.cs');
  fs.writeFileSync(cs, fs.readFileSync(csInAsar));
  const target = path.join(toolsDir(), exeBase + '-' + h + '.exe');
  const tmpOut = target + '.tmp';
  try { fs.unlinkSync(tmpOut); } catch {}
  // compilation vers un nom temporaire puis renommage : un echec ne laisse jamais
  // un exe partiel qui aurait l'air valide
  await execFileP(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/out:' + tmpOut, cs], { timeout: 60000, windowsHide: true });
  if (!fs.existsSync(tmpOut)) throw new Error('compilation ' + csName + ' sans exe produit');
  try { fs.renameSync(tmpOut, target); } catch { fs.copyFileSync(tmpOut, target); }
  try { fs.unlinkSync(tmpOut); } catch {}
  // purge des anciennes versions hachees et de l'exe historique sans hash
  for (const f of fs.readdirSync(toolsDir())) {
    if ((f === exeBase + '.exe' || (f.startsWith(exeBase + '-') && f.endsWith('.exe'))) && f !== path.basename(target)) {
      try { fs.unlinkSync(path.join(toolsDir(), f)); } catch {}
    }
  }
  return target;
}

async function ensureAudioTool() {
  const p = audioToolPath();
  if (fs.existsSync(p)) return p;
  try { return await compileCs('AudioEndpoint', 'AudioEndpoint'); }
  catch (e) { lastToolErr = e.message; log('[audio] compilation AudioEndpoint: ' + e.message, 'error'); return null; }
}

// execFileSync : reserve aux chemins de sortie (will-quit/uncaughtException) ou
// le process va mourir de toute facon. Tout chemin IPC utilise audioExecP.
function audioExecSync(tool, args) {
  return execFileSync(tool, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
}

// parseEndpoints/parseGet/findCableCapture viennent de lib/audio-utils.js.

async function restoreMicNowP(tool) {
  try {
    if (!tool || !fs.existsSync(restoreFile())) return false;
    const prev = JSON.parse(fs.readFileSync(restoreFile(), 'utf-8'));
    const eps = parseEndpoints(await audioExecP(tool, ['list']));
    // Priorite : peripherique par defaut Windows non virtuel (role multi), puis
    // les ids d'origine par role, puis le 1er peripherique non virtuel.
    // Comme ca la restauration suit le micro par defaut de l'utilisateur.
    let cur = { console: '', comm: '', multi: '' };
    try { cur = parseGet(await audioExecP(tool, ['get', 'capture'])); } catch {}
    const r = chooseRestoreIds(eps, prev, cur);
    const cId = r.consoleId, mId = r.commId;
    if (!cId && !mId) return false; // garde restoreFile pour reessayer plus tard
    await audioExecP(tool, ['set', 'capture', cId || mId, mId || cId, r.multiId || cId || mId]);
    try { fs.unlinkSync(restoreFile()); } catch {}
    return true;
  } catch { return false; }
}

// Variante synchrone : uniquement pour will-quit / uncaughtException ou le
// process se termine — un execFile async ne pourrait pas finir a temps.
function restoreMicNow(tool) {
  try {
    if (!tool || !fs.existsSync(restoreFile())) return false;
    const prev = JSON.parse(fs.readFileSync(restoreFile(), 'utf-8'));
    const eps = parseEndpoints(audioExecSync(tool, ['list']));
    let cur = { console: '', comm: '', multi: '' };
    try { cur = parseGet(audioExecSync(tool, ['get', 'capture'])); } catch {}
    const r = chooseRestoreIds(eps, prev, cur);
    const cId = r.consoleId, mId = r.commId;
    if (!cId && !mId) return false;
    audioExecSync(tool, ['set', 'capture', cId || mId, mId || cId, r.multiId || cId || mId]);
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

H('sounds:seed', () => {
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

H('audio:autoSetup', async (_e, { enabled, cableLabel }) => {
  try {
    const tool = await ensureAudioTool();
    if (!tool) return { ok: false, err: 'composant audio natif indisponible : ' + (lastToolErr || 'compilation impossible') };
    if (!enabled) { await restoreMicNowP(tool); return { ok: true, changed: false }; }
    let eps = parseEndpoints(await audioExecP(tool, ['list']));
    let target = findCableCapture(eps, cableLabel);
    if (!target) {
      // Sans endpoint cable (VB-CABLE absent) : pas de bascule, on restaure
      // un eventuel etat precedent et on explique.
      await restoreMicNowP(tool);
      return { ok: false, err: 'périphérique « CABLE Output » introuvable — installe VB-CABLE (vb-audio.com/Cable)' };
    }
    let cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    if (cur.console === target.id && cur.comm === target.id && cur.multi === target.id) {
      // Deja bascule : on ne touche a rien (restoreFile reste = marqueur de bascule active)
      return { ok: true, changed: false, device: target.name };
    }
    // Pas encore sur le cable : recuperer un eventuel etat incoherent puis memoriser le vrai peripherique
    if (fs.existsSync(restoreFile())) {
      await restoreMicNowP(tool);
      cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    }
    if (!fs.existsSync(restoreFile())) {
      fs.writeFileSync(restoreFile(), JSON.stringify({ console: cur.console, comm: cur.comm, owner: process.pid }));
    }
    await audioExecP(tool, ['set', 'capture', target.id, target.id, target.id]);
    // Garde externe : si ce process meurt sans will-quit (kill, crash, BSOD), le guard
    // detache restaure le micro a la mort du parent. Sans effet si fermeture propre
    // (restoreFile deja supprime) ou si un autre SoundFart a repris la bascule (owner).
    try {
      const g = spawn(tool, ['guard', String(process.pid), restoreFile()], { detached: true, stdio: 'ignore', windowsHide: true });
      g.unref();
    } catch (e) { log('[mic-guard] spawn: ' + e.message, 'warn'); }
    return { ok: true, changed: true, device: target.name };
  } catch (e) {
    return { ok: false, err: e.message };
  }
});

// Restauration manuelle du micro (bouton reglages + beforeunload). Si
// audio-restore.json existe -> restoreMicNow (meme priorite qu'a la fermeture).
// Sinon, si une entree est coincee sur un peripherique virtuel (cable perdu,
// guard mort), on la rebascule sur le defaut Windows non virtuel ou le 1er
// peripherique non virtuel — filet de secours pour l'utilisateur.
ipcMain.on('audio:restore', async (e) => {
  if (!fromApp(e)) return;
  try {
    const tool = audioToolPath();
    if (!tool || !fs.existsSync(tool)) return;
    // Securite : sans audio-restore.json, SoundFart n'a jamais bascule le micro
    // (ou l'a deja restaure) -> on ne touche a RIEN, meme si une entree pointe
    // sur un peripherique virtuel (choix volontaire possible : Voicemeeter,
    // CABLE Output utilise par une autre app, etc.).
    if (!fs.existsSync(restoreFile())) return;
    if (await restoreMicNowP(tool)) return;
    // restoreFile present = bascule faite par SoundFart mais restauration
    // incomplete (cible introuvable, JSON corrompu...) : dernier recours borne,
    // on sort les roles coinces sur un virtuel vers le premier non virtuel.
    const eps = parseEndpoints(await audioExecP(tool, ['list']));
    const nameOf = (id) => { const e = eps.find((x) => x.id === id); return e ? e.name : ''; };
    const cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    const stuck = [cur.console, cur.comm, cur.multi].some((id) => id && VIRTUAL_RE_MAIN.test(nameOf(id)));
    if (!stuck) return;
    const fb = eps.find((e) => e.flow === 'capture' && !VIRTUAL_RE_MAIN.test(e.name));
    if (fb) {
      await audioExecP(tool, ['set', 'capture', fb.id, fb.id, fb.id]);
      // Etat force = nouvelle base : on consomme le marqueur pour ne pas
      // re-deranger l'utilisateur a la prochaine restauration.
      try { fs.unlinkSync(restoreFile()); } catch {}
      log('[mic-restore] micro force hors peripherique virtuel -> ' + fb.name);
    }
  } catch (err) { log('[mic-restore] ' + (err && err.message), 'warn'); }
});

H('shell:openDir', (_e, d) => {
  const p = d && path.isAbsolute(String(d)) ? String(d) : app.getPath('userData');
  try { if (!fs.statSync(p).isDirectory()) return 'not a directory'; } catch { return 'not found'; }
  return shell.openPath(p);
});

// VB-CABLE : ouvre la page officielle de telechargement. L'URL est FIXE ici,
// jamais fournie par le renderer — pas d'openExternal generique.
H('cable:openPage', () => {
  // URL fixe officielle ; promesse catchée pour ne pas remonter en unhandledRejection.
  Promise.resolve(shell.openExternal('https://vb-audio.com/Cable/')).catch((e) => log('[cable] openExternal: ' + e.message, 'warn'));
});

// ---------- AudioTap : loopback systeme -> CABLE Input (enregistreur « audio du PC ») ----------
// Contourne l'impossibilite de capturer la sortie systeme via Chromium (getDisplayMedia/loopback
// renvoient « Could not start audio source » ou du silence sur certaines configs).
let audioTapProc = null;
let audioTapKilling = false; // vrai entre kill() et l'evenement 'exit' (anti double spawn)
let audioTapFailed = false;  // spawn en echec (evenement 'error') sur le processus courant
let tapPcmRem = Buffer.alloc(0); // reste PCM non aligne (stdout livre des chunks arbitraires)

async function ensureAudioTap() {
  const p = audioTapPath();
  if (fs.existsSync(p)) return p;
  try { return await compileCs('AudioTap', 'AudioTap'); }
  catch (e) { lastToolErr = e.message; log('[audiotap] compilation: ' + e.message, 'error'); return null; }
}

H('audio:tapStart', async () => {
  try {
    const tool = await ensureAudioTap();
    if (!tool) return { ok: false, err: 'composant audio natif indisponible : ' + (lastToolErr || 'compilation impossible') };
    if (audioTapProc && audioTapProc.exitCode === null && !audioTapFailed) return { ok: true };
    // Un tapStop vient peut-etre de tuer l'ancien processus sans que 'exit' soit encore arrive :
    // on attend sa sortie avant d'en respawn un (sinon deux AudioTap ecriraient dans le cable).
    if (audioTapKilling) {
      const t0 = Date.now();
      while (audioTapKilling && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 200));
      if (audioTapKilling) return { ok: false, err: 'arrêt de l\'ancien AudioTap en cours' };
    }
    // args[1] = pid du parent : AudioTap s'auto-termine si ce process meurt (anti-orphelin).
    // Mode « pcm » : PCM float32 stereo 48 kHz sur stdout -> relaie au renderer pour
    // l'enregistreur, SANS passer par le cable (evite l'echo Discord dans le micro).
    const proc = spawn(tool, ['CABLE Input', String(process.pid), '0', '', 'pcm'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    audioTapProc = proc;
    audioTapFailed = false;
    proc.stdout.on('data', (chunk) => {
      // Un ancien processus encore en train de mourir ne doit pas injecter
      // son PCM dans le flux du nouveau (mixage/echo).
      if (audioTapProc !== proc || !win || win.isDestroyed()) return;
      // N'envoyer au renderer que des frames completes : float32 stereo = 8 octets/frame.
      tapPcmRem = Buffer.concat([tapPcmRem, chunk]);
      const aligned = tapPcmRem.length - (tapPcmRem.length % 8);
      if (aligned <= 0) return;
      try { win.webContents.send('sf:tapPcm', tapPcmRem.buffer.slice(tapPcmRem.byteOffset, tapPcmRem.byteOffset + aligned)); } catch {}
      tapPcmRem = tapPcmRem.slice(aligned);
    });
    audioTapProc.stderr.on('data', (d) => {
      // Tout le stderr est journalise : les lignes d'init revelent ou le tap
      // en est (init loopback, hr, srcBuf) — indispensable pour diagnostiquer
      // un enregistrement « audio du PC » silencieux.
      for (const line of String(d).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        log('[audiotap] ' + t.slice(0, 300), /ERREUR|echoue|introuvable/i.test(t) ? 'error' : 'info');
      }
    });
    proc.on('exit', () => {
      const wasKilled = audioTapKilling;
      audioTapKilling = false;
      // Sortie d'un processus obsolete (remplace entre-temps) : ne pas toucher
      // a la reference ni envoyer tapDead pour le NOUVEAU processus.
      if (audioTapProc !== proc) return;
      audioTapProc = null;
      tapPcmRem = Buffer.alloc(0);
      // Mort non volontaire (crash AudioTap / peripherique disparu) : on previent le renderer
      if (!wasKilled && win && !win.isDestroyed()) win.webContents.send('sf:tapDead', true);
    });
    proc.on('error', () => {
      if (audioTapProc !== proc) return;
      audioTapFailed = true; audioTapKilling = false; tapPcmRem = Buffer.alloc(0);
      // 'exit' n'est pas garanti apres 'error' : sans ca audioTapProc resterait
      // non-null et les tapStart suivants mentiraient ok:true a jamais.
      audioTapProc = null;
    });
    await new Promise((r) => setTimeout(r, 700));
    if (!audioTapProc || audioTapProc.exitCode !== null || audioTapFailed)
      return { ok: false, err: 'AudioTap s\'est arrêté au démarrage' };
    return { ok: true };
  } catch (e) { return { ok: false, err: e.message }; }
});

H('audio:tapStop', () => {
  if (audioTapProc) {
    audioTapKilling = true;
    try { audioTapProc.kill(); } catch { audioTapKilling = false; }
  }
  audioTapProc = null;
  tapPcmRem = Buffer.alloc(0);
  return { ok: true };
});

// ---------- VB-CABLE : detection des endpoints uniquement ----------
// VB-CABLE n'est NI embarque NI installe par SoundFart (licence VB-Audio).
// L'utilisateur l'installe depuis https://vb-audio.com/Cable/ ; le renderer
// detecte les peripheriques « CABLE Input/Output » via enumerateDevices et
// devicechange. Ici on ne garde que la bascule micro (cableLabel -> endpoint).

// Watchdog : re-verifie periodiquement que l'entree par defaut est toujours sur le cable.
// Si l'entree a ete modifiee hors SoundFart (utilisateur ou app tierce), la
// surveillance est suspendue pour la session — jamais de re-bascule forcee.
// Executions serialisees (watchdogBusy), jamais de execFileSync (ne bloque pas les
// raccourcis globaux). Si l'entree est modifiee hors SoundFart, on considere que
// c'est un choix de l'utilisateur : la surveillance est suspendue pour la session
// (reglage « surveillance micro » pour la reactiver au prochain lancement).
const audioExecP = (tool, args) => execFileP(tool, args, { encoding: 'utf8', timeout: 15000, windowsHide: true }).then((r) => r.stdout);
let watchdogBusy = false;
let micWatchSuspended = false;

async function watchdogMic() {
  if (watchdogBusy || micWatchSuspended) return;
  watchdogBusy = true;
  try {
    const tool = audioToolPath();
    if (!tool || !fs.existsSync(tool) || !fs.existsSync(restoreFile()) || !fs.existsSync(configFile())) return;
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf-8'));
    const st = cfg && cfg.settings;
    if (!st || st.autoSwitchMic === false || st.watchdogMic === false) return;
    const eps = parseEndpoints(await audioExecP(tool, ['list']));
    const target = findCableCapture(eps, st.cableLabel);
    if (!target) return;
    const cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    if (cur.console !== target.id || cur.comm !== target.id || cur.multi !== target.id) {
      micWatchSuspended = true;
      log('[mic-watchdog] entree modifiee hors SoundFart -> surveillance suspendue pour la session', 'warn');
      if (win && !win.isDestroyed()) win.webContents.send('sf:micWatchOff', target.name);
    }
  } catch (e) { log('[mic-watchdog] ' + e.message, 'warn'); }
  finally { watchdogBusy = false; }
}

// ---------- fenetre ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0d18',
    title: 'SoundFart',
    icon: path.join(__dirname, 'assets', 'icon.png'),
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
    if (d.level === 3 || d.level === 'error') log(`[page] ${d.message} (${d.sourceId}:${d.line})`, 'error');
  });
  let rendererReloads = 0; // anti-boucle : 1 reload max par session apres crash renderer
  win.webContents.on('render-process-gone', (_e, details) => {
    log('[crash] ' + JSON.stringify(details), 'error');
    // Un renderer mort = fenetre morte : on tente UNE recharge (config/audio
    // repartent proprement) plutot que de laisser une app inutilisable.
    if (rendererReloads === 0 && win && !win.isDestroyed()) {
      rendererReloads++;
      setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 500);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`[load] ${code} ${desc} ${url}`, 'error');
    dialog.showErrorBox('SoundFart', `Impossible de charger l'interface (${desc}).\n\nVerifie que le dossier « src » (index.html, style.css, app.js) est bien a cote de main.js.`);
  });

  // index.html est normalement dans « src » ; on accepte aussi le meme dossier que main.js
  const indexPath = [path.join(__dirname, 'src', 'index.html'), path.join(__dirname, 'index.html')].find((p) => fs.existsSync(p));
  if (!indexPath) {
    log('[load] index.html introuvable dans ' + __dirname, 'error');
    dialog.showErrorBox('SoundFart', "Fichiers de l'interface introuvables.\n\nLe dossier « src » (contenant index.html, style.css et app.js) doit se trouver a cote de main.js.\n\nDossier actuel : " + __dirname);
    app.quit();
    return;
  }
  win.loadFile(indexPath);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  // Seul l'acces audio est autorise : 'media' n'est accorde que si la requete
  // ne demande que de l'audio (jamais la camera) ; 'display-capture' pour le
  // repli loopback de l'enregistreur.
  const allowed = (p) => p === 'media' || p === 'display-capture';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || [];
      return cb(types.length > 0 && types.every((t) => t === 'audio'));
    }
    cb(allowed(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (permission === 'media') {
      const types = (details && details.mediaTypes) || [];
      return types.length > 0 && types.every((t) => t === 'audio');
    }
    return allowed(permission);
  });
  // Enregistreur : autorise getDisplayMedia pour capturer l'audio systeme (boucle locale Windows)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    log(`[displaymedia] requete audio=${request.audioRequested} video=${request.videoRequested}`);
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      log(`[displaymedia] ${sources.length} source(s) ecran`);
      if (sources.length) {
        // L'app n'utilise que l'audio loopback : jamais de capture video
        // d'ecran, meme si le renderer la demande (videoRequested).
        const opts = {};
        if (request.audioRequested) opts.audio = 'loopback';
        callback(Object.keys(opts).length ? opts : {});
      } else callback({});
    }).catch((e) => { log('[displaymedia] getSources: ' + e.message, 'warn'); callback({}); });
  });
  createWindow();
  setInterval(watchdogMic, 30000); // 30 s suffisent : 2 spawn AudioEndpoint toutes les 10 s coutaient ~2 % CPU en continu
});

app.on('window-all-closed', () => app.quit());
// Filet de securite : une exception fatale ne doit pas laisser le micro coince sur le cable.
process.on('uncaughtException', (e) => {
  log('[fatal] uncaughtException: ' + (e && e.stack || e), 'error');
  try {
    const t = audioToolPath();
    if (fs.existsSync(t) && fs.existsSync(restoreFile())) restoreMicNow(t);
  } catch {}
});
process.on('unhandledRejection', (e) => log('[fatal] unhandledRejection: ' + (e && e.stack || e), 'error'));
app.on('will-quit', () => {
  if (!isPrimary) return; // ne jamais restaurer le micro depuis une 2e instance
  globalShortcut.unregisterAll();
  // Tue les enfants encore vivants (yt-dlp/ffmpeg) : taskkill /T emporte
  // l'arbre entier — p.kill() seul laisserait le ffmpeg petit-enfant tourner.
  for (const p of [...childProcs]) { try { killTree(p.pid); } catch { try { p.kill(); } catch {} } }
  childProcs.clear();
  try { if (audioTapProc) audioTapProc.kill(); } catch {}
  audioTapProc = null;
  try {
    const tool = audioToolPath();
    if (fs.existsSync(tool) && fs.existsSync(restoreFile())) restoreMicNow(tool);
  } catch {}
});
