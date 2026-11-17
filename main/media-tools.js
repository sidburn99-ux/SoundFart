// Media tools : ffmpeg (coupe MP3) + yt-dlp (import YouTube).
// Extrait de main.js — les dependances partagees sont injectees par
// createMediaTools() pour garder le module testable et sans cycle.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { AUDIO_EXT, safeName, cbOrNoop } = require('../lib/audio-utils');

function createMediaTools(deps) {
  const { log, execFileTracked, trackChild, killTree, H, toolSane, discardCorruptTool, toolsDir, storageRoot, getWin } = deps;
// ---------- ffmpeg : coupe physique des extraits (MP3) ----------
function findFile(dir, name, depth = 0) {
  if (depth > 4) return null;
  // Un sous-dossier disparu/verrouille (AV, OneDrive) ne doit pas faire
  // echouer tout le scan : on passe au suivant au lieu de propager.
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name, depth + 1); if (r) return r; }
    else if (e.name.toLowerCase() === name) return p;
  }
  return null;
}

// Telecharge et extrait ffmpeg.exe une seule fois (~80 Mo, build "essentials" de gyan.dev)
let ffmpegPromise = null; // single-flight : un seul telechargement/extraction a la fois

async function ensureFfmpeg() {
  // ffmpeg.exe ~80 Mo : en dessous de 10 Mo c'est un reste tronque/corrompu.
  if (toolSane(ffmpegPath(), 10 * 1024 * 1024)) return ffmpegDir();
  if (fs.existsSync(ffmpegPath())) discardCorruptTool(ffmpegPath(), 'ffmpeg');
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    try {
      // ffmpeg.exe deja extrait quelque part dans ffmpegDir() : on l'utilise tel quel
      // (ffmpegDir() peut etre un FICHIER : existsSync vrai mais readdirSync
      // dans findFile jetterait ENOTDIR a chaque appel).
      if (fs.existsSync(ffmpegDir()) && fs.statSync(ffmpegDir()).isDirectory()) {
        const existing = findFile(ffmpegDir(), 'ffmpeg.exe');
        // Un exe <10 Mo est un reste d'extraction tuee par timeout :
        // on purge le dossier et on retente un telechargement propre.
        if (existing) {
          try {
            if (fs.statSync(existing).size >= 10 * 1024 * 1024) return path.dirname(existing);
          } catch {}
          try { fs.rmSync(ffmpegDir(), { recursive: true, force: true }); } catch {}
        }
      }
      fs.mkdirSync(toolsDir(), { recursive: true });
      const zip = path.join(toolsDir(), 'ffmpeg.zip');
      try {
        await downloadVerified({
          url: FFMPEG_URL, dest: zip, sumsUrl: FFMPEG_SUMS_URL, match: 'ffmpeg-' + FFMPEG_VERSION + '-essentials_build.zip',
          onProgress: (f) => { if (getWin() && !getWin().isDestroyed()) { try { getWin().webContents.send('sf:ytprogress', Math.round(f * 100)); } catch {} } },
        });
        const dest = ffmpegDir();
        fs.mkdirSync(dest, { recursive: true });
        // bsdtar de System32 lit le zip nativement ; le tar GNU de Git
        // present dans le PATH ne lit PAS zip -> « not a tar archive »
        // (SF-REL-0613). On privilegie System32\\tar.exe, repli sur PATH.
        const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        const tarBin = fs.existsSync(sysTar) ? sysTar : 'tar';
        try {
          await execFileTracked(tarBin, ['-xf', zip, '-C', dest, '*ffmpeg.exe'], { timeout: 180000 });
        } catch {
          await execFileTracked(tarBin, ['-xf', zip, '-C', dest], { timeout: 300000 });
        }
        const found = findFile(dest, 'ffmpeg.exe');
        if (found && found !== ffmpegPath()) {
          // Repli inter-volume : copie via .part + rename — jamais d'exe
          // partiel detectable par existsSync apres un crash/AV.
          const dst = ffmpegPath();
          try { fs.renameSync(found, dst); }
          catch (re) {
            const tmp = dst + '.part';
            try { fs.copyFileSync(found, tmp); fs.renameSync(tmp, dst); }
            catch (ce) { try { fs.unlinkSync(tmp); } catch {} throw ce; }
          }
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

H('media:cut', async (_e, o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('options invalides');
  const { input, start, end, dir } = o;
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('chemin source invalide');
  if (!AUDIO_EXT.includes(path.extname(String(input)).toLowerCase())) throw new Error('format audio non supporté');
  if (!Number.isFinite(+start) || +start < 0 || !Number.isFinite(+end) || +end <= +start) throw new Error('bornes de coupe invalides');
  const dur = +end - +start;
  if (dur > 30 * 60) throw new Error('extrait trop long (> 30 min)');
  // Stat d'abord, isFile ensuite : un 'pas un fichier' (repertoire, device)
  // avale par le catch devenait un « introuvable » mensonger.
  const st = await fs.promises.stat(input).catch(() => null);
  if (!st) throw new Error('fichier source introuvable');
  if (!st.isFile()) throw new Error('pas un fichier');
  const fdir = await ensureFfmpeg();
  const outDir = path.join(storageRoot(dir), 'cuts');
  await fs.promises.mkdir(outDir, { recursive: true });
  const base = safeName(path.basename(String(input), path.extname(String(input)))) + '_extrait';
  // Reservation atomique du nom (placeholder 'wx') : deux media:cut
  // concurrents sur la meme source ne s'ecrasent plus mutuellement.
  let out = null;
  // Plafond : un dossier cuts/ avec des milliers de base-N.mp3 feraient
  // des centaines de openSync synchrones sur le thread main.
  for (let i = 0; i < 1000; i++) {
    const cand = path.join(outDir, i === 0 ? base + '.mp3' : `${base}-${i}.mp3`);
    try {
      const fd = fs.openSync(cand, 'wx');
      fs.closeSync(fd);
      out = cand;
      break;
    } catch (oe) {
      if (oe && oe.code === 'EEXIST') continue;
      throw oe;
    }
  }
  if (!out) throw new Error('trop d\'extraits existants dans cuts/ — nettoie le dossier');
  // protocol_whitelist file : ffmpeg ne doit pas suivre de playlist/URL externe
  try {
    await execFileTracked(path.join(fdir, 'ffmpeg.exe'),
      ['-y', '-protocol_whitelist', 'file', '-ss', String(Math.max(0, +start || 0)), '-i', String(input), '-t', String(Math.max(0.1, dur)), '-vn', '-c:a', 'libmp3lame', '-q:a', '4', out],
      { timeout: 600000 });
  } catch (fe) {
    // Echec ffmpeg (timeout, kill, crash) : le placeholder wx laisserait un
    // *_extrait.mp3 vide de 0 octet dans cuts/ — on le supprime.
    try { await fs.promises.unlink(out); } catch {}
    throw fe;
  }
  // ffmpeg -y a ecrase le placeholder : un extrait « reussi » mais vide
  // (start au-dela de la fin, flux muet) ne doit pas etre retourne comme valide.
  try {
    const ost = await fs.promises.stat(out);
    if (ost.size < 1024) { await fs.promises.unlink(out).catch(() => {}); throw new Error('extrait vide ou trop court'); }
  } catch (se) {
    if (/vide|trop court/.test(se.message)) throw se;
    throw new Error('extrait illisible : ' + se.message);
  }
  return out;
});

// ---------- import YouTube (yt-dlp, telecharge au premier usage) ----------
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

const validHttpUrl = (u) => {
  try { const x = new URL(String(u)); return x.protocol === 'https:'; } catch { return false; }
};

function downloadFile(url, dest, onProgress) {
  onProgress = cbOrNoop(onProgress);
  return new Promise((resolve, reject) => {
    // Deadline TOTALE : le setTimeout(30 s) par requete ne couvre que
    // l'inactivite — un serveur qui degoutte 1 octet/29 s pendait a
    // jamais et bloquait installYtDlpPromise/ffmpegPromise/
    // ytDownloadBusy jusqu'au restart (SF-REL-0625).
    let curReq = null;
    let outStream = null; // stream d'ecriture courant : le unlink d'erreur doit attendre sa fermeture (EBUSY/EPERM sinon -> .part residuel)
    const killer = setTimeout(() => { try { if (curReq) curReq.destroy(); } catch {} rej(new Error('téléchargement interrompu : délai total dépassé (15 min)')); }, 15 * 60 * 1000);
    const done = (fn, v) => { clearTimeout(killer); fn(v); };
    // Tout echec apres createWriteStream laisse un fichier PARTIEL sur
    // disque (ffmpeg.zip tronque, .part orphelin) : on le supprime avant
    // de rejeter — unlink sur un chemin pas encore cree est sans effet.
    let cleaned = false;
    const rej = (e) => {
      if (cleaned) return; cleaned = true;
      const fin = () => { try { fs.unlinkSync(dest); } catch {} done(reject, e); };
      if (outStream && !outStream.destroyed) {
        let fellBack = false;
        outStream.once('close', () => { if (!fellBack) fin(); });
        try { outStream.destroy(); } catch { fellBack = true; fin(); }
        // Garde-fou : si 'close' ne vient jamais, on nettoie quand meme.
        setTimeout(() => { if (!fellBack) { fellBack = true; fin(); } }, 3000).unref();
      } else fin();
    };
    const res = (v) => done(resolve, v);
    const get = (u, n) => {
      // Les redirections ne doivent jamais sortir du HTTPS (anti-downgrade MITM).
      if (!/^https:\/\//i.test(u)) return rej(new Error('redirection non-HTTPS refusée : ' + u.slice(0, 120)));
      const req = curReq = https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (n > 5) return rej(new Error('trop de redirections'));
          try {
            const loc = new URL(res.headers.location, u).href;
            return get(loc, n + 1);
          } catch { return rej(new Error('redirection invalide')); }
        }
        if (res.statusCode !== 200) { res.resume(); return rej(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        // Borne dure : yt-dlp ~100 Mo, ffmpeg.zip ~80 Mo — au-dela c'est anormal.
        if (total > 300 * 1024 * 1024) { res.resume(); return rej(new Error('fichier trop volumineux (' + total + ' octets)')); }
        let got = 0;
        const out = outStream = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (got > 300 * 1024 * 1024) { try { out.destroy(); } catch {} req.destroy(new Error('téléchargement trop volumineux')); return; }
          if (total) { try { onProgress(got / total); } catch {} }
        });
        res.on('error', (e) => { out.destroy(); rej(e); });
        res.pipe(out);
        out.on('finish', () => {
          // Content-Length incoherent ou reponse tronquee : ne jamais valider
          // un fichier partiel (le SHA-256 ne protege que les binaires, pas .sums).
          if (total && got !== total) { out.destroy(); return rej(new Error('téléchargement tronqué (' + got + '/' + total + ' octets)')); }
          // res() ici visait le wrapper resolve de la ligne ~642, mais le
          // parametre (res) du callback https le masque -> TypeError ->
          // crash fatal a la fin de CHAQUE telechargement.
          out.close(() => done(resolve));
        });
        out.on('error', rej);
      });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      req.on('error', rej);
    };
    get(url, 0);
  });
}

// GET HTTPS borne (1 Mo) pour les petites API JSON — pas de fichier.
function httpsGetText(url, depth = 0, deadline = 0) {
  return new Promise((resolve, reject) => {
    // Deadline TOTALE 60 s partagee entre redirections : sans propagation,
    // chaque saut recreait 60 s -> ~5 min au lieu de 1 et ytdlpPromise
    // (donc tous les yt:*) restait bloque pendant ce temps.
    if (!deadline) deadline = Date.now() + 60000;
    // req en let (pas const) : si https.get jette de facon synchrone, le
    // timer resterait arme et evaluerait req.destroy() en TDZ ->
    // ReferenceError dans un timer = uncaughtException -> app.quit().
    let req = null;
    const killer = setTimeout(() => { try { if (req) req.destroy(); } catch {} rej(new Error('délai total dépassé (60 s)')); }, Math.max(1, deadline - Date.now()));
    const done = (fn, v) => { clearTimeout(killer); fn(v); };
    const rej = (e) => done(reject, e), res = (v) => done(resolve, v);
    // Bornes : HTTPS only a chaque saut (anti-downgrade) et max 5
    // redirections — sinon une redirection circulaire bouclerait a vie.
    if (!/^https:\/\//i.test(url)) return rej(new Error('URL non-HTTPS refusée'));
    if (depth > 5) return rej(new Error('trop de redirections'));
    req = https.get(url, { headers: { 'User-Agent': 'SoundFart' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        let loc;
        try { loc = new URL(r.headers.location, url).href; } catch { return rej(new Error('redirection invalide')); }
        return res(httpsGetText(loc, depth + 1, deadline));
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      let got = 0; const chunks = [];
      r.on('data', (c) => { got += c.length; if (got > 1024 * 1024) { req.destroy(new Error('reponse trop volumineuse')); return; } chunks.push(c); });
      r.on('error', rej);
      r.on('end', () => res(Buffer.concat(chunks).toString('utf-8')));
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', rej);
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
  await downloadFile(url, dest, onProgress);
  try {
    const sumsTmp = dest + '.sums';
    let sums;
    try {
      await downloadFile(sumsUrl, sumsTmp);
      // Les sommes font quelques Ko : un endpoint compromis renvoyant un
      // gros fichier ne doit pas geler le main en readFileSync+split.
      if (fs.statSync(sumsTmp).size > 256 * 1024) throw new Error('fichier de sommes trop volumineux');
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
    const { stdout } = await execFileTracked(ytdlpPath(), ['--version', '--ignore-config'], { timeout: 15000 });
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
      onProgress: (f) => { if (getWin() && !getWin().isDestroyed()) { try { getWin().webContents.send('sf:ytprogress', Math.round(f * 100)); } catch {} } },
    });
    fs.renameSync(tmp, ytdlpPath());
    // Meta atomique (.tmp + rename) comme maybeUpdateYtDlp : un crash
    // pendant le write laisserait un JSON tronque.
    const metaTmp = ytdlpMetaFile() + '.tmp';
    fs.writeFileSync(metaTmp, JSON.stringify({ version, at: Date.now() }));
    fs.renameSync(metaTmp, ytdlpMetaFile());
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
    // GET JSON borne via https natif — plus de dependance a powershell.exe
    // (Invoke-RestMethod) pour un simple appel d'API.
    const body = await httpsGetText('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
    const latest = String(JSON.parse(body).tag_name || '').trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(latest)) return false;
    const current = (await ytdlpInstalledVersion()) || YTDLP_VERSION;
    // Ecriture atomique (.tmp + rename) : un crash pendant le write ne doit
    // pas laisser un JSON tronque lu comme « pas de meta » au prochain boot.
    const metaTmp = ytdlpMetaFile() + '.tmp';
    fs.writeFileSync(metaTmp, JSON.stringify({ version: current, at: Date.now() }));
    fs.renameSync(metaTmp, ytdlpMetaFile()); // horodate la verification
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
      // Sonde taille : un yt-dlp.exe tronque restait « present » et cassait
      // tous les imports sans jamais declencher de reinstallation.
      if (!toolSane(ytdlpPath(), 1024 * 1024)) {
        if (fs.existsSync(ytdlpPath())) discardCorruptTool(ytdlpPath(), 'yt-dlp');
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

// runYt expose son process courant pour yt:cancel : sans ca, un download
// engage repartait jusqu'au timeout 2 min ou la fin — aucun moyen
// d'interrompre un import lance par erreur.
let activeYt = null; // { p, cancelled }

function runYt(args, onProgress) {
  onProgress = cbOrNoop(onProgress);
  return new Promise((resolve, reject) => {
    // stdin ignore : un outil externe ne doit pas heriter d'un pipe ouvert
    // (yt-dlp/ffmpeg peuvent y attendre une saisie et pendre).
    const p = trackChild(spawn(ytdlpPath(), ['--ignore-config', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    const rec = { p, cancelled: false };
    activeYt = rec;
    const release = () => { if (activeYt === rec) activeYt = null; };
    let err = '', done = false;
    // Timeout global : un yt-dlp fige ne doit pas pendre le telechargement
    // indefiniment (le timeout inactivite de downloadVerified ne s'applique pas ici).
    // killTree et pas p.kill() : yt-dlp spawn ffmpeg.exe en petit-enfant pour
    // -x/--download-sections — un kill simple laissait ffmpeg orphelin, continuant
    // a ecrire un MP3 partiel hors de childProcs.
    const timer = setTimeout(() => {
      done = true; release(); try { killTree(p.pid); } catch {} try { p.kill(); } catch {}
      // timedOut : distingue un kill-programme d'une erreur yt-dlp — le
      // retry de yt:download ne doit pas forcer une maj ~100 Mo pour un
      // contenu simplement trop long pour la fenetre de 2 min.
      const e = new Error('yt-dlp : délai dépassé (2 min)'); e.timedOut = true;
      reject(e);
    }, 120000);
    // yt-dlp ecrit la progression sur stderr (pas stdout).
    p.stderr.on('data', (d) => {
      const s = String(d);
      const m = /\[download\]\s+([\d.]+)%/.exec(s);
      if (m) { try { onProgress(parseFloat(m[1])); } catch {} }
      if (err.length < 65536) err += d;
    });
    p.stdout.on('data', (d) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(String(d));
      if (m) { try { onProgress(parseFloat(m[1])); } catch {} }
    });
    p.on('error', (e) => { if (!done) { done = true; release(); clearTimeout(timer); reject(e); } });
    p.on('close', (code) => {
      if (done) return;
      done = true; release(); clearTimeout(timer);
      if (rec.cancelled) { const e = new Error('yt-dlp annulé par l\'utilisateur'); e.cancelled = true; reject(e); return; }
      code === 0 ? resolve() : reject(new Error('yt-dlp a échoué : ' + err.slice(-500).trim()));
    });
  });
}

// Jeton d'annulation par operation yt:download : activeYt ne couvre que
// runYt — les phases ensureYtDlp/ensureFfmpeg/maybeUpdateYtDlp (avant ou
// entre les runYt) ignoraient yt:cancel. Verifie avant chaque etape.
let ytCancelReq = false;
const ytCancelledErr = () => { const e = new Error('yt-dlp annulé par l\'utilisateur'); e.cancelled = true; return e; };
const ytThrowIfCancelled = () => { if (ytCancelReq) throw ytCancelledErr(); };

// Annulation utilisateur : tue l'arbre yt-dlp (+ ffmpeg petit-enfant)
// et arme le jeton pour les phases hors runYt.
// Le close handler rejette avec une erreur « annulé » distincte.
H('yt:cancel', () => {
  ytCancelReq = true;
  const rec = activeYt;
  if (!rec) return ytDownloadBusy; // annulation en phase ensure/update : le jeton suffit
  rec.cancelled = true;
  try { killTree(rec.p.pid); } catch {}
  try { rec.p.kill(); } catch {}
  return true;
});

// f vaut -1 (reset) ou un pourcentage 0-100 deja pret (yt-dlp, downloadVerified).
// L'ancienne heuristique « f <= 1 -> fraction » affichait -100 % au reset et
// transformait 1 % en 100 %.
const ytProgress = (f) => {
  if (!getWin() || getWin().isDestroyed()) return;
  const p = (typeof f === 'number' && f === -1) ? -1 : Math.round(+f || 0);
  try { getWin().webContents.send('sf:ytprogress', p); } catch {}
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
  // execFileTracked (et non execFileP) : le process est suivi dans
  // childProcs et tue au will-quit — un yt:info en vol ne survit pas.
  const { stdout } = await execFileTracked(ytdlpPath(), ['--ignore-config', '--dump-single-json', '--no-playlist', '--no-warnings', url], { timeout: 120000, windowsHide: true }); // stdout plafonne a 4 Mo par execFileTracked (maxBuffer n'existe pas sur spawn)
  let j;
  try { j = JSON.parse(stdout); }
  catch (e) { throw new Error('yt-dlp a renvoyé des métadonnées illisibles : ' + e.message); }
  return { title: j.title || '', duration: j.duration || 0, url: j.webpage_url || url };
});

let ytDownloadBusy = false; // single-flight : 2 imports concurrents = progression entrelacee + update yt-dlp possible pendant execution
H('yt:download', async (_e, o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('options invalides');
  const { url, start, end, dir, full } = o;
  if (ytDownloadBusy) throw new Error('Un import YouTube est déjà en cours — attends la fin.');
  ytDownloadBusy = true;
  ytCancelReq = false; // nouveau telechargement : le jeton d'annulation repart a zero
  try {
  if (!validHttpUrl(url) || !isYoutubeUrl(url)) throw new Error('URL YouTube invalide');
  if (!full && (!Number.isFinite(+start) || +start < 0 || !Number.isFinite(+end) || +end <= +start)) throw new Error('bornes invalides');
  await ensureYtDlp();
  ytThrowIfCancelled(); // annulation pendant l'installation/verif yt-dlp
  const tryDownload = async () => {
    ytThrowIfCancelled();
    const impDir = path.join(storageRoot(dir), 'imports');
    await fs.promises.mkdir(impDir, { recursive: true });
    // Template unique par requete : le « plus recent » ne peut pas etre un
    // fichier etranger cree pendant le telechargement (ni un autre import).
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tags = [tag];
    // yt-dlp interprete % dans TOUT le -o comme caractere de template
    // (%% = litteral) : un storageRoot contenant % (ex. D:\100%\..)
    // rendait le template invalide -> yt:download echouait toujours.
    const tplDir = impDir.replace(/%/g, '%%');
    const outTpl = path.join(tplDir, 'sf-' + tag + '-%(id)s.%(ext)s');
    const baseArgs = ['--no-playlist', '--no-warnings', '-o', outTpl];
    let sectioned = false;
    // ffmpeg n'est requis que pour l'extrait sectionne (-x + download-sections) ;
    // un import « audio complet » ne doit PAS declencher le telechargement
    // d'~80 Mo d'ffmpeg inutilement.
    // Coercition numerique comme media:cut : '0x10' passerait Number.isFinite
    // puis serait interpole brut dans --download-sections (section invalide
    // cote yt-dlp -> repli audio complet silencieux). Non fini -> repli
    // audio complet comme avant (pas de section 0-...).
    const wantSection = !full && Number.isFinite(+start) && Number.isFinite(+end) && +end > +start;
    const secStart = Math.max(0, +start || 0), secEnd = Math.max(0, +end || 0);
    let ffDir = null;
    if (wantSection) { try { ffDir = await ensureFfmpeg(); } catch (e) { log('[yt] ffmpeg indisponible pour la coupe, repli audio complet : ' + (e && e.message), 'warn'); } }
    ytThrowIfCancelled(); // annulation pendant le telechargement ffmpeg (~80 Mo)
    if (wantSection && ffDir) {
      try {
        await runYt([...baseArgs, '--ffmpeg-location', ffDir, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--download-sections', `*${secStart}-${secEnd}`, url], ytProgress);
        sectioned = true;
      } catch (e) {
        // Annulation = intention utilisateur : JAMAIS de repli sur
        // l'audio complet (sinon Annuler relancait un 2e yt-dlp).
        if (e && (e.cancelled || ytCancelReq)) throw e.cancelled ? e : ytCancelledErr();
        log('[yt] extrait sectionne impossible, repli sur l\'audio complet : ' + (e && e.message), 'warn');
      }
    }
    ytThrowIfCancelled();
    if (!sectioned) {
      ytProgress(-1);
      // Template DISTINCT pour le repli : un yt-dlp/ffmpeg tue par timeout
      // peut encore ecrire dans l'ancien template — le filtre 'created'
      // pourrait sinon retenir un MP3 partiel comme import valide.
      const tag2 = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const outTpl2 = path.join(tplDir, 'sf-' + tag2 + '-%(id)s.%(ext)s');
      tags.push(tag2);
      await runYt(['--no-playlist', '--no-warnings', '-o', outTpl2, '-f', 'bestaudio/best', url], ytProgress);
    }
    // Ne retenir qu'un fichier audio FINAL : yt-dlp peut laisser des
    // .part/.ytdl ou un artefact non audio avec le meme prefixe ; prendre
    // « le plus recent » sans filtre pouvait retourner un fichier inutilisable.
    const created = fs.readdirSync(impDir).filter((f) => {
      if (!tags.some((t) => f.startsWith('sf-' + t + '-'))) return false;
      if (/\.(part|ytdl|temp)$/i.test(f)) return false;
      return AUDIO_EXT.includes(path.extname(f).toLowerCase());
    }).map((f) => path.join(impDir, f))
      .filter((f) => { try { return fs.statSync(f).size > 0; } catch { return false; } });
    if (!created.length) throw new Error('Aucun fichier audio produit.');
    // Le repli full (dernier tag) prime sur l'extrait sectionne : un
    // ffmpeg orphelin du 1er essai peut continuer d'ecrire APRES le full
    // et volerait le tri par mtime.
    const lastTag = tags[tags.length - 1];
    const preferred = created.filter((f) => path.basename(f).startsWith('sf-' + lastTag + '-'));
    const pool = preferred.length ? preferred : created;
    // statSync peut jeter si le fichier disparaît entre readdir et le tri
    // (export/ suppression concurrente) : traiter comme mtime 0, pas crasher.
    const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
    const newest = pool.sort((a, b) => mtime(b) - mtime(a))[0];
    // Plafond coherent avec file:read (512 Mo) : un audio plus lourd serait
    // de toute facon illisible par l'app — autant echouer ici, proprement.
    // noRetry : une mise a jour yt-dlp ne changera pas la taille ; et on
    // supprime le fichier pour ne pas laisser un import mort sur le disque.
    let newestSize = 0, newestGone = false;
    try { newestSize = fs.statSync(newest).size; } catch { newestGone = true; }
    if (newestGone || !newestSize) throw new Error('Le fichier téléchargé a disparu avant la validation.');
    if (newestSize > 512 * 1024 * 1024) {
      try { fs.unlinkSync(newest); } catch {}
      const err = new Error('Le fichier téléchargé dépasse 512 Mo — trop lourd pour SoundFart.');
      err.noRetry = true;
      throw err;
    }
    // Ménage des artefacts de tentatives avortées : yt-dlp laisse des
    // .part/.ytdl/.temp prefixés sf-<tag>- dans imports/ qu'aucun code
    // ne relisait — ils s'accumulaient à chaque import raté. Idem pour un
    // audio COMPLET du tag avorte (extrait sectionne mort apres avoir
    // produit son MP3, puis repli full) : orphelin cumule sinon.
    // 'newest' n'est jamais touche, quel que soit son tag.
    try {
      for (const f of fs.readdirSync(impDir)) {
        const fp = path.join(impDir, f);
        if (fp === newest) continue;
        const tagged = tags.some((t) => f.startsWith('sf-' + t + '-'));
        const isArtifact = tagged && /\.(part|ytdl|temp)$/i.test(f);
        const isOrphanAudio = tagged && tags.some((t) => t !== lastTag && f.startsWith('sf-' + t + '-'))
          && AUDIO_EXT.includes(path.extname(f).toLowerCase());
        if (isArtifact || isOrphanAudio) { try { fs.unlinkSync(fp); } catch {} }
      }
    } catch {}
    ytProgress(-1);
    return { path: newest, sectioned };
  };
  try {
    return await tryDownload();
  } catch (e) {
    // Annulation = intention utilisateur : pas de maj, pas de retry.
    if (e && e.cancelled) throw e;
    if (ytCancelReq) throw ytCancelledErr();
    // YouTube casse souvent les vieilles versions : une mise a jour forcee puis un seul retry.
    // Exception timeout : un contenu trop long pour les 2 min de runYt
    // echouera pareil apres retry — on verifie la maj SANS la forcer
    // (un yt-dlp a jour = check rapide, pas de ~100 Mo gaspilles).
    if (!e || !e.noRetry) {
      const forceUpdate = !(e && e.timedOut);
      if (await maybeUpdateYtDlp(forceUpdate)) {
        ytThrowIfCancelled(); // annulation pendant la verification/mise a jour
        return await tryDownload();
      }
    }
    throw e;
  }
  } finally { ytDownloadBusy = false; ytCancelReq = false; }
});
  return { ensureFfmpeg, ensureYtDlp, runYt, maybeUpdateYtDlp, findFile, ytdlpPath, ffmpegDir, ffmpegPath };
}

module.exports = { createMediaTools };
