const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, globalShortcut, desktopCapturer, crashReporter, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const { createMediaTools } = require('./main/media-tools');
// Processus enfants long-terme (yt-dlp, ffmpeg) : Windows ne tue PAS les
// enfants a la sortie du parent — on les suit pour les tuer au will-quit,
// sinon un telechargement continue sans UI ni possibilite d'arret.
const childProcs = new Set();
const trackChild = (p) => {
  childProcs.add(p);
  p.on('close', () => childProcs.delete(p));
  // 'error' (spawn impossible) peut ne pas etre suivi de 'close' : sans ce
  // retrait, un PID mort resterait dans childProcs et taskkill pourrait
  // frapper un PID reutilise par un processus innocent au will-quit.
  p.on('error', () => childProcs.delete(p));
  // 'exit' precede 'close' : retirer des que le process est mort reduit la
  // fenetre ou killTree pourrait frapper un PID reutilise par un innocent.
  p.on('exit', () => childProcs.delete(p));
  return p;
};
const killTree = (pid) => { try { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (e) { try { log('[killTree] ' + e.message, 'warn'); } catch {} } };
// execFile avec handle suivi (promisify ne donne pas le ChildProcess).
function execFileTracked(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = trackChild(spawn(file, args, { ...opts, windowsHide: true }));
    let out = '', err = '', done = false;
    const timer = opts.timeout ? setTimeout(() => { if (!done) { done = true; try { killTree(p.pid); } catch {} try { p.kill(); } catch {} reject(new Error('délai dépassé')); } }, opts.timeout) : null;
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
const { AUDIO_EXT, VIRTUAL_RE: VIRTUAL_RE_MAIN, parseEndpoints, parseGet, findCableCapture, chooseRestoreIds, expandPathsAsync, writeRecording } = require('./lib/audio-utils');
let win = null;

// ---------- journal d'erreurs : SoundFart-data\soundfart.log ----------
// Niveaux : info (defaut) / warn / error. Identifiant de session unique par
// lancement pour correller les evenements. Borne de taille conservee (2 Mo).
const SESSION_ID = crypto.randomBytes(3).toString('hex');
const LOG_LEVELS = { info: 0, warn: 1, error: 2 };
let logLevel = LOG_LEVELS.info;
let lastSizeCheck = 0;
// Debit max pour les messages ISSUS du renderer (ui:log, console-message) :
// un renderer buggé spamant console.error ecrivait des Go/min sur disque et
// bloquait le main via appendFileSync synchrone (SF-REL-0651).
const UI_LOG_MAX_PER_SEC = 30;
const uiLogState = { ui: { start: 0, count: 0 }, page: { start: 0, count: 0 } };
let uiLogDropped = 0, uiLogDropLogAt = 0;
function uiLogAllowed(ch) {
  const now = Date.now();
  const st = uiLogState[ch] || (uiLogState[ch] = { start: 0, count: 0 });
  if (now - st.start >= 1000) { st.start = now; st.count = 0; }
  if (++st.count <= UI_LOG_MAX_PER_SEC) return true;
  uiLogDropped++;
  // Resume cadence : au plus 1 warn/seconde meme sous spam massif — sinon
  // le warn de resume lui-meme ecrivait ~50 lignes/s (taux proportionnel).
  if (uiLogDropped % 100 === 0 && now - uiLogDropLogAt > 1000) {
    uiLogDropLogAt = now;
    log('[log] ' + uiLogDropped + ' messages renderer ignores (spam)', 'warn');
  }
  return false;
}
function log(msg, lvl = 'info') {
  try {
    if ((LOG_LEVELS[lvl] || 0) < logLevel) return;
    if (typeof msg !== 'string') msg = String(msg);
    if (msg.length > 4000) msg = msg.slice(0, 4000) + '…';
    const f = path.join(app.getPath('userData'), 'soundfart.log');
    // Borne la taille : au-dela de 2 Mo on ne garde que les 500 derniers Ko.
    // Le stat n'est refait qu'une fois par minute : log() est synchrone et
    // ui:log peut etre spamme par le renderer (SF-REL-0607).
    const now = Date.now();
    if (now - lastSizeCheck > 60000) {
      lastSizeCheck = now;
      try {
        const size = fs.statSync(f).size;
        if (size > 2 * 1024 * 1024) {
          // Lire le fichier ENTIER (readFileSync) pouvait jeter (fichier
          // geant / RAM) -> trim en echec a chaque passage, log sans borne.
          // On ne lit que les 500 derniers Ko via un descripteur positionne.
          const keep = Math.min(500 * 1024, size);
          const fd = fs.openSync(f, 'r');
          try {
            const tail = Buffer.alloc(keep);
            // bytesRead : si le fichier a retreci entre statSync et readSync,
            // on ne reecrit PAS (sinon des zeros tronqueraient le log).
            const n = fs.readSync(fd, tail, 0, keep, size - keep);
            if (n === keep) fs.writeFileSync(f, tail);
          } finally { fs.closeSync(fd); }
        }
      } catch (e) {
        // ENOENT = log pas encore cree : rien a rogner, pas un warn.
        if (e && e.code !== 'ENOENT') log('[log] trim echoue: ' + (e && e.message), 'warn');
      }
    }
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

// Forensique crash renderer (-1/143, bug connu non resolu) : les minidumps
// Crashpad dans userData/Crashpad permettent une analyse post-mortem.
// DOIT etre apres les setPath('userData') : Crashpad fige le dossier de
// destination au start() — sinon les dumps partent dans %APPDATA% par defaut
// au lieu du profil test/portable.
try {
  if (isPrimary) crashReporter.start({
    productName: 'SoundFart',
    submitURL: '', // pas de telemetrie : collecte locale uniquement
    uploadToServer: false,
    compress: true,
  });
} catch (e) { log('[crash] crashReporter: ' + e.message, 'warn'); }

// Les minidumps Crashpad n'etaient jamais purges : croissance non bornee
// sur profil portable/USB (notamment le bug renderer -1/143 recurrent).
// On supprime les .dmp de plus de 30 jours au demarrage — les dumps recents
// (preuves SF-REL-0611) sont preserves.
try {
  const crashDir = path.join(app.getPath('userData'), 'Crashpad');
  for (const sub of ['reports', 'reversed']) {
    const d = path.join(crashDir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.dmp')) continue;
      try {
        const fp = path.join(d, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 30 * 86400000) fs.unlinkSync(fp);
      } catch {}
    }
  }
} catch (e) { log('[crash] purge dumps: ' + (e && e.message), 'warn'); }

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
    // Borne comme config.json/.bak (16 Mo) : un fichier legacy geant ou
    // bloque gelait le demarrage du main.
    if (fs.statSync(old).size > 16 * 1024 * 1024) return null;
    const j = JSON.parse(fs.readFileSync(old, 'utf-8'));
    if (!Array.isArray(j.sounds) || !j.sounds.length) return null;
    // Un element sans path string ferait planter basename() -> toute la
    // migration perdue ; on filtre avant le map.
    j.sounds = j.sounds.filter((x) => x && typeof x.path === 'string' && x.path).slice(0, 5000);
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
const sendMenu = (action) => () => { if (win && !win.isDestroyed()) { try { win.webContents.send('sf:menu', action); } catch {} } };

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
  // Strip les caracteres de controle : un message avec \r\n pourrait forger
  // des entrees de log au format timestamp/niveau.
  if (fromApp(e) && uiLogAllowed('ui')) log('[ui] ' + String(m).slice(0, 4000).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 800));
});

H('desktop:source', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  } catch { return null; }
});

H('app:version', () => app.getVersion());
H('app:dataDir', () => app.getPath('userData'));

// Lit config.json.bak avec la meme borne que config.json — utilise aux
// deux endroits de repli (config absente et config corrompue).
function readBakConfig(f) {
  try {
    if (fs.statSync(f + '.bak').size > 16 * 1024 * 1024) return null;
    const b = JSON.parse(fs.readFileSync(f + '.bak', 'utf-8'));
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

H('config:load', () => {
  const f = configFile();
  try {
    // Borne de taille : un config.json remplace par un fichier enorme gele le
    // demarrage (readFileSync + JSON.parse sur le thread main).
    const st = fs.statSync(f);
    if (st.size > 16 * 1024 * 1024) throw new Error('config.json trop volumineux');
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      // config.json absente (supprimee ou deja renommee .broken-* apres un
      // crash) : tenter le .bak AVANT migrateOldConfig — il contient la
      // derniere config validee, sinon la bibliotheque repart vide.
      return readBakConfig(f) || migrateOldConfig();
    }
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
    return readBakConfig(f);
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
const toolsDir = () => path.join(app.getPath('userData'), 'tools');
// Dossier de stockage choisi par l'utilisateur (imports/, recordings/, cuts/) ; defaut = userData.
// Un dir relatif ou non-chainable est ignore (protection contre une config importee malveillante).
function storageRoot(dir) {
  const d = dir && String(dir).trim();
  return d && path.isAbsolute(d) ? d : app.getPath('userData');
}
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
  for (const it of list) {
    if (!it || typeof it !== 'object') continue; // entree null/primitive : ne doit pas jeter avant unregisterAll
    const { key, accel } = it;
    if (typeof key !== 'string' || key.length > 128 || typeof accel !== 'string' || accel.length > 64 || !key) continue;
    if (seen.has(accel)) { failed.push(accel); continue; } // doublon : un seul peut etre enregistre
    seen.add(accel);
    valid.push({ key, accel });
  }
  if (list.length > 200 || valid.length > 200) failed.push('…'); // troncature : seules les 200 premieres sont enregistrees
  globalShortcut.unregisterAll();
  for (const { key, accel } of valid.slice(0, 200)) {
    try {
      const ok = globalShortcut.register(accel, () => {
        if (win && !win.isDestroyed()) { try { win.webContents.send('sf:shortcut', key); } catch {} }
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
  await fs.promises.mkdir(rdir, { recursive: true }); // async : UNC ne gele pas le main (SF-REL-0602)
  const len = data instanceof ArrayBuffer ? data.byteLength : (data.byteLength != null ? data.byteLength : (data.length || 0));
  if (len > 512 * 1024 * 1024) throw new Error('enregistrement trop volumineux (> 512 Mo)');
  const buf = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data);
  // Nom+ecriture atomique delegues a lib/audio-utils.writeRecording —
  // testable via node:test (SF-REL-0058 : la boucle etait dans le handler,
  // invisible aux tests, et referencait une variable inexistante).
  return writeRecording(rdir, name, ext, buf);
});

// ---------- media : ffmpeg + yt-dlp (main/media-tools.js) ----------
// Enregistre les handlers IPC media:cut / yt:* (ffmpeg + yt-dlp).
createMediaTools({
  log, execFileTracked, trackChild, H, toolSane, discardCorruptTool,
  toolsDir, storageRoot, getWin: () => win,
});

// ---------- bascule automatique de l'entree micro (CABLE Output) ----------
// Au lancement : si active, le peripherique d'enregistrement par defaut passe sur le cable virtuel.
// A la fermeture (ou au prochain lancement si crash) : le peripherique d'origine est restaure.
// Discord doit utiliser « Defaut / OS default » comme peripherique d'entree pour suivre ce changement.
const restoreFile = () => path.join(app.getPath('userData'), 'audio-restore.json');
// Marqueur de bascule micro : ecriture atomique (.tmp + rename) — un crash
// pendant writeFileSync laissait un JSON tronque que restoreMicNow ne
// pouvait plus parser (et qui bloquait la recreation du marqueur).
function readRestoreMarker() {
  try { return JSON.parse(fs.readFileSync(restoreFile(), 'utf-8')); } catch { return null; }
}
function writeRestoreMarker(obj) {
  const f = restoreFile();
  const t = f + '.tmp';
  fs.writeFileSync(t, JSON.stringify(obj));
  fs.renameSync(t, f);
}
// Garde externe : si ce process meurt sans will-quit (kill, crash, BSOD),
// le guard detache restaure le micro a la mort du parent.
function spawnMicGuard(tool) {
  try {
    const g = spawn(tool, ['guard', String(process.pid), restoreFile()], { detached: true, stdio: 'ignore', windowsHide: true });
    // 'error' async (exe disparu entre ensureAudioTool et le spawn) sans
    // listener = uncaughtException -> crash de l'app.
    g.on('error', (e) => log('[mic-guard] ' + (e && e.message), 'warn'));
    g.unref();
  } catch (e) { log('[mic-guard] spawn: ' + e.message, 'warn'); }
}
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

// Sonde d'integrite minimale : un binaire tronque/corrompu (download
// interrompu, AV, disque plein) restait « present » via existsSync et
// faisait echouer tous les usages en chaine. Seuil bas : detecte les
// fichiers vides/tronques, jamais les binaires legitimes (le nom C#
// contient deja le hash source ; yt-dlp/ffmpeg sont verifies SHA-256).
function toolSane(p, minBytes) {
  try { return fs.statSync(p).size >= minBytes; } catch { return false; }
}
function discardCorruptTool(p, label) {
  try { fs.unlinkSync(p); } catch {}
  log('[tools] ' + label + ' absent ou tronque — reinstallation/compilation prevue', 'warn');
}

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
  await execFileTracked(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/out:' + tmpOut, cs], { timeout: 60000 });
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
  if (toolSane(p, 4096)) return p;
  if (fs.existsSync(p)) discardCorruptTool(p, 'AudioEndpoint');
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
      const srcF = path.join(src, f);
      // Un fichier pre-existant tronque (ancien bug, AV) passait
      // existsSync : on compare la taille a la source et on recopie si
      // differente — un .part interrompu n'est plus protege pour toujours.
      let needCopy = true;
      if (fs.existsSync(out)) {
        try { needCopy = fs.statSync(out).size !== fs.statSync(srcF).size; } catch { needCopy = true; }
      }
      if (needCopy) {
        // Copie verbifiee : un copyFileSync interrompu (crash, AV) laissait un
        // fichier partiel que existsSync protegeait ensuite pour toujours.
        const tmp = out + '.part';
        try {
          fs.copyFileSync(srcF, tmp);
          const a = fs.statSync(srcF).size, b = fs.statSync(tmp).size;
          if (!a || a !== b) throw new Error('copie incomplete');
          fs.renameSync(tmp, out);
        } catch (ce) {
          try { fs.unlinkSync(tmp); } catch {}
          try { fs.unlinkSync(out); } catch {}
          log('[seed] copie ' + f + ' : ' + ce.message, 'warn');
          return null;
        }
      }
      return { name: DEFAULT_SOUND_NAMES[f], path: out };
    }).filter(Boolean);
  } catch { return []; }
});

let quitting = false; // will-quit : interdit tout NOUVEAU set capture/guard apres le debut de la sortie
let tapEpoch = 0; // incremente par tapStop : un tapStart en vol ne doit pas spawner apres un stop
let autoSetupChain = Promise.resolve(); // serialise les bascules micro : 2 appels concurrents spawnaient des guards AudioEndpoint dupliques
H('audio:autoSetup', (e, opts) => {
  const run = autoSetupChain.then(() => autoSetupImpl({
    enabled: !!(opts && opts.enabled),
    cableLabel: opts && typeof opts.cableLabel === 'string' ? opts.cableLabel : '',
  }));
  autoSetupChain = run.catch(() => {});
  return run;
});
async function autoSetupImpl({ enabled, cableLabel }) {
  if (quitting) return { ok: false, err: 'quitte' }; // ne pas spawner AudioEndpoint pendant la sortie
  micSwitching = true;
  try {
    const tool = await ensureAudioTool();
    if (quitting) return { ok: false, err: 'quitte' };
    if (!tool) return { ok: false, err: 'composant audio natif indisponible : ' + (lastToolErr || 'compilation impossible') };
    if (!enabled) {
      // Rien a restaurer si aucun marqueur : ok. Marqueur present mais
      // restauration echouee -> on le dit au lieu de pretendre le succes.
      if (!fs.existsSync(restoreFile())) return { ok: true, changed: false };
      const restored = await restoreMicNowP(tool);
      return restored ? { ok: true, changed: true } : { ok: false, err: 'restauration du micro impossible (cible introuvable ou peripherique indisponible)' };
    }
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
      // Deja bascule : on ne touche a rien (restoreFile reste = marqueur de bascule active).
      // Sauf marqueur absent (suppression externe) -> etat incoherent, on signale
      // sans recreer de marqueur (un faux « precedent » restaurerait mal).
      const m = readRestoreMarker();
      if (!m) {
        log('[mic] entrees deja sur le cable mais audio-restore.json absent — restauration finale non garantie', 'warn');
      } else if (m.owner !== process.pid) {
        // Marqueur d'une session MORTE (crash precedent, guard perdu) : sans
        // adoption, will-quit restaurerait quand meme (restoreMicNow ignore
        // owner) mais un kill suivant laisserait le micro coince — le guard
        // ne surveillait que l'ancien pid. On adopte le marqueur (ids
        // d'origine preserves) et on respawn un guard pour ce pid.
        try {
          writeRestoreMarker({ ...m, owner: process.pid });
          spawnMicGuard(tool);
          log('[mic] marqueur audio-restore adopte (owner precedent mort)');
        } catch (e) { log('[mic] adoption marqueur: ' + e.message, 'warn'); }
      }
      return { ok: true, changed: false, device: target.name };
    }
    // Pas encore sur le cable : recuperer un eventuel etat incoherent puis memoriser le vrai peripherique
    {
      if (fs.existsSync(restoreFile())) {
        await restoreMicNowP(tool);
        cur = parseGet(await audioExecP(tool, ['get', 'capture']));
      }
      if (!fs.existsSync(restoreFile())) {
        writeRestoreMarker({ console: cur.console, comm: cur.comm, multi: cur.multi, owner: process.pid });
      }
      if (quitting) return { ok: false, err: 'quitte' };
      await audioExecP(tool, ['set', 'capture', target.id, target.id, target.id]);
      // Si will-quit est passe pendant l'exec, la restauration synchrone a
      // pu preceder ce set : on retente pour ne pas laisser le micro coince.
      if (quitting) { try { await restoreMicNowP(tool); } catch {} }
      if (!quitting) spawnMicGuard(tool);
      return { ok: true, changed: true, device: target.name };
    }
  } catch (e) {
    return { ok: false, err: e.message };
  } finally { micSwitching = false; }
}

// Restauration manuelle du micro (bouton reglages + beforeunload). Si
// audio-restore.json existe -> restoreMicNow (meme priorite qu'a la fermeture).
// Sinon, si une entree est coincee sur un peripherique virtuel (cable perdu,
// guard mort), on la rebascule sur le defaut Windows non virtuel ou le 1er
// peripherique non virtuel — filet de secours pour l'utilisateur.
ipcMain.on('audio:restore', (e) => {
  if (!fromApp(e)) return;
  // Serialise avec audio:autoSetup : deux 'set capture' AudioEndpoint ne
  // doivent jamais courir en parallele (watchdog/a4e403a pattern).
  const run = autoSetupChain.then(() => audioRestoreImpl());
  autoSetupChain = run.catch(() => {});
});
async function audioRestoreImpl() {
  if (quitting) return; // ne pas compiler/lancer AudioEndpoint pendant la sortie
  micSwitching = true;
  try {
    const tool = await ensureAudioTool();
    if (quitting) return;
    if (!tool) { log('[mic-restore] outil audio indisponible : ' + (lastToolErr || 'inconnu'), 'warn'); return; }
    // Securite : sans audio-restore.json, SoundFart n'a jamais bascule le micro
    // (ou l'a deja restaure) -> on ne touche a RIEN, meme si une entree pointe
    // sur un peripherique virtuel (choix volontaire possible : Voicemeeter,
    // CABLE Output utilise par une autre app, etc.).
    if (!fs.existsSync(restoreFile())) return;
    if (quitting) return; // will-quit gere deja la restauration synchrone
    if (await restoreMicNowP(tool)) return;
    if (quitting) return; // will-quit a deja restaure : ne pas re-spawner
    // restoreFile present = bascule faite par SoundFart mais restauration
    // incomplete (cible introuvable, JSON corrompu...) : dernier recours borne,
    // on sort les roles coinces sur un virtuel vers le premier non virtuel.
    if (quitting) return; // will-quit gere deja la restauration
    const eps = parseEndpoints(await audioExecP(tool, ['list']));
    // flow='capture' comme chooseRestoreIds : un id render/capture
    // homonyme ne doit pas faire passer un virtuel pour du concret.
    const nameOf = (id) => { const e = eps.find((x) => x.id === id && x.flow === 'capture'); return e ? e.name : ''; };
    const cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    const stuck = [cur.console, cur.comm, cur.multi].some((id) => id && VIRTUAL_RE_MAIN.test(nameOf(id)));
    if (!stuck || quitting) return;
    // Exiger un nom : un endpoint sans DeviceName passait VIRTUAL_RE.test('')
    // et etait traite comme « non virtuel » (memes regles que chooseRestoreIds).
    const fb = eps.find((e) => e.flow === 'capture' && e.name && !VIRTUAL_RE_MAIN.test(e.name));
    if (fb) {
      await audioExecP(tool, ['set', 'capture', fb.id, fb.id, fb.id]);
      // Etat force = nouvelle base : on consomme le marqueur pour ne pas
      // re-deranger l'utilisateur a la prochaine restauration.
      try { fs.unlinkSync(restoreFile()); } catch {}
      log('[mic-restore] micro force hors peripherique virtuel -> ' + fb.name);
    }
  } catch (err) { log('[mic-restore] ' + (err && err.message), 'warn'); }
  finally { micSwitching = false; }
}

H('shell:openDir', async (_e, d) => {
  const p = d && path.isAbsolute(String(d)) ? String(d) : app.getPath('userData');
  // stat async : un chemin UNC peut bloquer le thread principal (SF-REL-0604).
  const st = await fs.promises.stat(p).catch(() => null);
  if (!st || !st.isDirectory()) return 'not found';
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
  if (toolSane(p, 4096)) return p;
  if (fs.existsSync(p)) discardCorruptTool(p, 'AudioTap');
  try { return await compileCs('AudioTap', 'AudioTap'); }
  catch (e) { lastToolErr = e.message; log('[audiotap] compilation: ' + e.message, 'error'); return null; }
}

// Mutex : deux tapStart concurrents (double-clic, retry renderer) passaient
// tous deux la boucle d'attente audioTapKilling puis spawnaient chacun un
// AudioTap -> double injection dans le cable + processus orphelin.
let tapStartBusy = false;

H('audio:tapStart', async () => {
  if (tapStartBusy) return { ok: false, err: 'démarrage AudioTap déjà en cours' };
  const ep = tapEpoch; // un tapStop pendant la compilation ne doit pas etre ignore
  tapStartBusy = true;
  try {
    const tool = await ensureAudioTap();
    if (ep !== tapEpoch) return { ok: false, err: 'arrêt demandé pendant le démarrage' };
    if (!tool) return { ok: false, err: 'composant audio natif indisponible : ' + (lastToolErr || 'compilation impossible') };
    if (audioTapProc && audioTapProc.exitCode === null && !audioTapFailed) return { ok: true };
    // Un tapStop vient peut-etre de tuer l'ancien processus sans que 'exit' soit encore arrive :
    // on attend sa sortie avant d'en respawn un (sinon deux AudioTap ecriraient dans le cable).
    if (audioTapKilling) {
      const t0 = Date.now();
      while (audioTapKilling && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 200));
      if (audioTapKilling) return { ok: false, err: 'arrêt de l\'ancien AudioTap en cours' };
    }
    if (ep !== tapEpoch) return { ok: false, err: 'arrêt demandé pendant le démarrage' };
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
      // Marqueur PAR PROCESS : lire le global audioTapKilling ici cree une
      // course — un ancien tap qui meurt tardivement remet le flag a false
      // et le VRAI process tue verrait wasKilled=false -> faux tapDead.
      const wasKilled = proc._sfKilled === true || audioTapKilling;
      audioTapKilling = false;
      // Sortie d'un processus obsolete (remplace entre-temps) : ne pas toucher
      // a la reference ni envoyer tapDead pour le NOUVEAU processus.
      if (audioTapProc !== proc) return;
      audioTapProc = null;
      tapPcmRem = Buffer.alloc(0);
      // Mort non volontaire (crash AudioTap / peripherique disparu) : on previent le renderer
      if (!wasKilled && win && !win.isDestroyed()) { try { win.webContents.send('sf:tapDead', true); } catch (e) { log('[tap] send tapDead: ' + (e && e.message), 'warn'); } }
    });
    proc.on('error', () => {
      // Le proc tué peut emettre 'error' sans 'exit' : sans ce reset,
      // audioTapKilling restait vrai a jamais -> tapStart echouait
      // « arret en cours » jusqu'au restart.
      audioTapKilling = false;
      if (audioTapProc !== proc) return;
      audioTapFailed = true; tapPcmRem = Buffer.alloc(0);
      // 'exit' n'est pas garanti apres 'error' : sans ca audioTapProc resterait
      // non-null et les tapStart suivants mentiraient ok:true a jamais.
      audioTapProc = null;
    });
    await new Promise((r) => setTimeout(r, 700));
    if (!audioTapProc || audioTapProc.exitCode !== null || audioTapFailed)
      return { ok: false, err: 'AudioTap s\'est arrêté au démarrage' };
    return { ok: true };
  } catch (e) { return { ok: false, err: e.message }; }
  finally { tapStartBusy = false; }
});

H('audio:tapStop', () => {
  tapEpoch++; // invalide tout tapStart en vol (compile/spawn a venir)
  if (audioTapProc) {
    audioTapKilling = true;
    audioTapProc._sfKilled = true; // exit de CE process = arret volontaire
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
const audioExecP = (tool, args) => execFileTracked(tool, args, { encoding: 'utf8', timeout: 15000 }).then((r) => r.stdout);
let watchdogBusy = false;
let micWatchSuspended = false;
let micSwitching = false; // autoSetup/restore en cours : le watchdog ne doit pas voir la transition comme un choix externe

async function watchdogMic() {
  if (watchdogBusy || micWatchSuspended || micSwitching) return;
  watchdogBusy = true;
  try {
    if (!fs.existsSync(restoreFile()) || !fs.existsSync(configFile())) return;
    // Borne de lecture : config:load limite a 16 Mo, le watchdog doit
    // appliquer la meme regle (un fichier bloque/geant gele le main).
    try { if (fs.statSync(configFile()).size > 16 * 1024 * 1024) return; } catch { return; }
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf-8'));
    // settings absent = defauts du renderer (autoSwitchMic/watchdogMic
    // actifs) : les traiter comme {} pour ne pas desarmer le watchdog
    // alors que l'UI l'affiche arme (config editee main / ancienne).
    const rawSt = cfg && cfg.settings;
    const st = (rawSt && typeof rawSt === 'object' && !Array.isArray(rawSt)) ? rawSt : {};
    // Aligne sur normalizeCfg (app.js) : absent = defaut actif, present
    // doit etre strictement true — 'false' string ou autre desactive.
    if (st.autoSwitchMic !== undefined && st.autoSwitchMic !== true) return;
    if (st.watchdogMic !== undefined && st.watchdogMic !== true) return;
    // ensureAudioTool APRES les gardes config : sinon un watchdog/desarme
    // ou une config corrompue declenchait une compilation C# toutes les
    // 30 s pour rien (SF-REL-0653 revue).
    const tool = await ensureAudioTool();
    if (!tool) return;
    const eps = parseEndpoints(await audioExecP(tool, ['list']));
    const target = findCableCapture(eps, st.cableLabel);
    if (!target) return;
    const cur = parseGet(await audioExecP(tool, ['get', 'capture']));
    if ((cur.console !== target.id || cur.comm !== target.id || cur.multi !== target.id) && !micSwitching) {
      micWatchSuspended = true;
      log('[mic-watchdog] entree modifiee hors SoundFart -> surveillance suspendue pour la session', 'warn');
      if (win && !win.isDestroyed()) { try { win.webContents.send('sf:micWatchOff', target.name); } catch (e) { log('[mic-watchdog] send micWatchOff: ' + (e && e.message), 'warn'); } }
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
    // Meme sanitization que ui:log : un console.error avec \n pourrait
    // forger des lignes de log au format timestamp/niveau.
    if ((d.level === 3 || d.level === 'error') && uiLogAllowed('page')) log(`[page] ${String(d.message).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 800)} (${d.sourceId}:${d.line})`, 'error');
  });
  let rendererReloads = 0; // anti-boucle : 1 reload max par session apres crash renderer
  win.webContents.on('render-process-gone', (_e, details) => {
    log('[crash] ' + JSON.stringify(details), 'error');
    // Un renderer mort = fenetre morte : on tente UNE recharge (config/audio
    // repartent proprement) plutot que de laisser une app inutilisable.
    if (rendererReloads === 0 && win && !win.isDestroyed()) {
      rendererReloads++;
      setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 500);
    } else if (win && !win.isDestroyed()) {
      // Second crash : la fenetre est morte sans diagnostic — on le dit
      // puis on QUITTE : une app sans renderer est un zombie, et le
      // will-quit restaure le micro proprement (SF-REL-0054).
      dialog.showErrorBox('SoundFart', 'Le moteur audio a planté une seconde fois.\n\nRedémarre l\'application — si le problème revient, envoie soundfart.log au support.');
      app.quit();
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
  // Permissions audio : 'microphone' (Chromium recent separe micro de 'media'
  // — refuser 'microphone' vide enumerateDevices et refuse getUserMedia),
  // 'media' accorde seulement si audio seul, 'display-capture' pour le
  // repli loopback. Chaque decision est journalisee (permission, origine,
  // mediaTypes, raison) — un refus audio est toujours explicable.
  const { decideMediaPermission } = require('./lib/media-permission');
  const permOriginOk = (wc) => {
    try { return /[\\/]index\.html$/.test(new URL(wc.getURL()).pathname); } catch { return false; }
  };
  const logPerm = (permission, origin, mediaTypes, d) =>
    log('[perm] ' + permission + ' origin=' + String(origin).slice(0, 120)
      + ' mediaTypes=' + JSON.stringify(mediaTypes || null)
      + ' -> ' + (d.allow ? 'ALLOW' : 'DENY') + ' (' + d.reason + ')', d.allow ? 'info' : 'warn');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const origin = wc && wc.getURL ? wc.getURL() : '?';
    const mediaTypes = details && details.mediaTypes;
    if (!permOriginOk(wc)) {
      logPerm(permission, origin, mediaTypes, { allow: false, reason: 'origine non autorisee' });
      return cb(false);
    }
    const d = decideMediaPermission(permission, details);
    logPerm(permission, origin, mediaTypes, d);
    cb(d.allow);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (!permOriginOk(wc)) return false;
    return decideMediaPermission(permission, details).allow;
  });
  // Enregistreur : autorise getDisplayMedia pour capturer l'audio systeme (boucle locale Windows)
  // Origine : seule la page SoundFart peut demander une capture — comme
  // permOriginOk pour les permissions (un frame etranger ne passe pas).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Origine : seule la page SoundFart peut demander une capture — comme
    // permOriginOk pour les permissions (un frame etranger ne passe pas).
    let originOk = false;
    try {
      const u = request.securityOrigin || (request.frame && request.frame.url) || '';
      originOk = /[\\/]index\.html$/.test(new URL(u).pathname);
    } catch {}
    if (!originOk) {
      log('[displaymedia] refuse: origine ' + String((request && request.securityOrigin) || '?').slice(0, 120), 'warn');
      return callback({});
    }
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
  // Sleep/wake : les peripheriques audio peuvent etre re-enumeres
  // differemment au reveil sans devicechange fiable ; on journalise et on
  // demande au renderer de re-resoudre ses peripheriques. Limite connue :
  // un enregistrement MediaRecorder en cours peut contenir un trou
  // silencieux pendant la veille (non detectable sans horloge audio).
  powerMonitor.on('suspend', () => log('[power] veille systeme', 'warn'));
  powerMonitor.on('resume', () => {
    log('[power] reveil systeme');
    if (win && !win.isDestroyed()) { try { win.webContents.send('sf:powerResume'); } catch (e) { log('[power] send powerResume: ' + (e && e.message), 'warn'); } }
  });
  setInterval(watchdogMic, 30000); // 30 s suffisent : 2 spawn AudioEndpoint toutes les 10 s coutaient ~2 % CPU en continu
}).catch((e) => {
  // Sans catch : une exception synchrone dans l'init deviendrait un
  // unhandledRejection — processus zombie sans fenetre ni window-all-closed.
  log('[fatal] init whenReady: ' + (e && e.stack || e), 'error');
  try { dialog.showErrorBox('SoundFart', 'Erreur fatale au démarrage : ' + (e && e.message)); } catch {}
  app.quit();
});

app.on('window-all-closed', () => app.quit());
// Filet de securite : une exception fatale ne doit pas laisser le micro coince sur le cable.
process.on('uncaughtException', (e) => {
  log('[fatal] uncaughtException: ' + (e && e.stack || e), 'error');
  try {
    const t = audioToolPath();
    if (fs.existsSync(t) && fs.existsSync(restoreFile())) restoreMicNow(t);
  } catch {}
  // Continuer dans un etat potentiellement corrompu est plus risque que de
  // sortir : on restaure le micro (will-quit le refera, idempotent) puis on
  // quitte proprement au lieu de laisser tourner un main blesse.
  setTimeout(() => { try { app.quit(); } catch {} }, 500);
});
process.on('unhandledRejection', (e) => log('[fatal] unhandledRejection: ' + (e && e.stack || e), 'error'));
app.on('will-quit', () => {
  quitting = true; // barriere : ni autoSetup ni audio:restore ne doivent plus toucher aux peripheriques
  if (!isPrimary) return; // ne jamais restaurer le micro depuis une 2e instance
  globalShortcut.unregisterAll();
  // Tue les enfants encore vivants (yt-dlp/ffmpeg) : taskkill /T emporte
  // l'arbre entier — p.kill() seul laisserait le ffmpeg petit-enfant tourner.
  for (const p of [...childProcs]) { try { killTree(p.pid); } catch {} try { p.kill(); } catch {} }
  childProcs.clear();
  try { if (audioTapProc) audioTapProc.kill(); } catch {}
  audioTapProc = null;
  try {
    const tool = audioToolPath();
    if (fs.existsSync(restoreFile())) {
      if (!fs.existsSync(tool)) log('[mic] restauration impossible : AudioEndpoint.exe absent', 'warn');
      else if (!restoreMicNow(tool)) log('[mic] restauration a la fermeture echouee — micro peut rester sur le peripherique virtuel', 'warn');
    }
  } catch (e) { log('[mic] restauration will-quit: ' + (e && e.message), 'warn'); }
});
