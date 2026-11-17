// Migration unique SoundFart-data (portable, a cote de l'exe) -> userData
// (%APPDATA%\SoundFart). Extrait de main.js pour etre testable via node:test.
//
// Garanties :
// - Reprenable : le marqueur .migrated-from-portable n'est ecrit QUE si
//   toutes les copies et reecritures ont reussi. Un echec ou un crash
//   laisse la migration incomplete -> nouvelle tentative au prochain
//   lancement, qui reprend la ou elle s'etait arretee.
// - Jamais d'ecrasement : un fichier deja present a destination est
//   conserve (donnees utilisateur ou copie anterieure). La copie se fait
//   par fichier via .migtmp-<pid> + rename atomique : jamais de fichier
//   destination partiel, jamais de melange de contenu.
// - Sources jamais modifiees ni supprimees.
const fs = require('fs');
const path = require('path');

const MIGRATION_DIRS = ['tools', 'imports', 'recordings', 'cuts', 'default-sounds'];
const MIGRATION_FILES = ['config.json', 'config.json.bak', 'audio-restore.json'];
const MIGRATION_MARKER = '.migrated-from-portable';

// Copie recursive srcDir -> dstDir sans jamais ecraser l'existant.
// Retourne { copied, kept, errors[] } — les erreurs sont collectees, pas levees.
function copyDirSafe(srcDir, dstDir, tmpTag) {
  const stats = { copied: 0, kept: 0, errors: [] };
  const walk = (s, d) => {
    let entries;
    try { entries = fs.readdirSync(s, { withFileTypes: true }); }
    catch (e) { stats.errors.push(s + ' : ' + (e && e.message)); return; }
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { stats.errors.push(d + ' : ' + (e && e.message)); return; }
    for (const ent of entries) {
      const sp = path.join(s, ent.name), dp = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(sp, dp); continue; }
      if (!ent.isFile()) continue; // liens, sockets, etc. : ignores
      try {
        if (fs.existsSync(dp)) {
          // Collision fichier->dossier : la source ne peut pas prendre la
          // place d'un dossier existant. Le compter « kept » perdrait le
          // fichier en silence -> on le declare en erreur (pas de marqueur,
          // reprise au prochain lancement, warn visible dans les logs).
          const dstIsDir = fs.statSync(dp).isDirectory();
          if (dstIsDir) throw new Error('collision : un dossier occupe deja ce nom');
          stats.kept++; continue;
        }
        const tmp = dp + '.migtmp-' + tmpTag;
        try {
          fs.copyFileSync(sp, tmp);
          fs.renameSync(tmp, dp); // atomique : la destination n'existe qu'entier
          stats.copied++;
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch {}
          throw e;
        }
      } catch (e) { stats.errors.push(sp + ' : ' + (e && e.message)); }
    }
  };
  if (fs.existsSync(srcDir)) walk(srcDir, dstDir);
  return stats;
}

// Menage des .migtmp-* orphelins : un crash entre copyFileSync et rename
// laisse le temporaire a n'importe quel niveau de l'arborescence (le sweep
// plat de lib/import.js ne couvre que sons/). On ne supprime que les
// fichiers de plus de 1 h — une copie en vol n'est jamais aussi vieille —
// et on borne la profondeur (tools/ peut etre volumineux). Synchrone comme
// le reste de la migration ; appele avant les copies pour couvrir aussi les
// restes d'une tentative precedente.
function sweepMigtmp(dir, log, depth = 0) {
  const say = typeof log === 'function' ? log : () => {};
  let removed = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return 0; }
  const now = Date.now();
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth < 8) removed += sweepMigtmp(p, say, depth + 1);
      continue;
    }
    if (!ent.isFile() || !ent.name.includes('.migtmp-')) continue;
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs > 3600e3) { fs.unlinkSync(p); removed++; }
    } catch (e) { say('[migration] menage ' + p + ' : ' + (e && e.message), 'warn'); }
  }
  if (removed) say('[migration] ' + removed + ' temporaire(s) .migtmp orphelin(s) supprime(s)', 'info');
  return removed;
}

// Reecrit les chemins portableDataDir -> appData dans un fichier de config.
// Formes couvrees : backslashes echappes JSON (\\), backslashes bruts, slashes.
// La correspondance exige un separateur de chemin ou une fin de chaine apres
// le prefixe : sans ca, « E:\SoundFart-data-old\x » (dossier FRERE legitime,
// hors migration) serait reecrit en « <appData>-old\x » = chemin mort
// silencieux. Ecriture atomique (.tmp + rename).
function rewriteConfigFile(srcFile, dstFile, fromDir, toDir) {
  const t = fs.readFileSync(srcFile, 'utf-8');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (?=[\\/"']|$) : le chemin doit etre suivi de \, /, quote ou fin —
  // jamais d'un caractere de nom (evite la corruption des prefixes).
  const boundary = '(?=[\\\\/"\']|$)';
  let out = t.replace(new RegExp(esc(fromDir.replace(/\\/g, '\\\\')) + boundary, 'g'), () => toDir.replace(/\\/g, '\\\\'));
  out = out.replace(new RegExp(esc(fromDir) + boundary, 'g'), () => toDir);
  out = out.replace(new RegExp(esc(fromDir.replace(/\\/g, '/')) + boundary, 'g'), () => toDir.replace(/\\/g, '/'));
  const tmp = dstFile + '.migtmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, dstFile);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// Point d'entree. Retourne { ran, complete, details }.
// ran=false : rien a faire (pas de source, deja migre, meme dossier).
function runPortableMigration({ portableDataDir, appData, log }) {
  const say = typeof log === 'function' ? log : () => {};
  if (!portableDataDir || !appData || portableDataDir === appData) return { ran: false, complete: true, details: 'inactive' };
  const oldCfg = path.join(portableDataDir, 'config.json');
  if (!fs.existsSync(oldCfg)) return { ran: false, complete: true, details: 'pas de config source' };
  const marker = path.join(appData, MIGRATION_MARKER);
  if (fs.existsSync(marker)) return { ran: false, complete: true, details: 'deja migre' };

  fs.mkdirSync(appData, { recursive: true });
  // Restes d'une tentative precedente interrompue : .migtmp a tout niveau.
  try { sweepMigtmp(appData, say); } catch {}
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  // Backup des configs AppData pre-existantes (restes dev) : jamais
  // d'ecrasement silencieux de donnees utilisateur.
  for (const f of ['config.json', 'config.json.bak']) {
    try {
      const p = path.join(appData, f);
      if (fs.existsSync(p)) fs.renameSync(p, p + '.pre-migration-' + ts);
    } catch (e) { say('[migration] backup ' + f + ' : ' + (e && e.message), 'warn'); }
  }

  const details = { dirs: {}, files: [], errors: [] };
  // Dossiers a copier : la liste fixe + tout dossier de stockage configure
  // DANS SoundFart-data (ex. storageDir=...\SoundFart-data\sons) — sans ca,
  // la reecriture de chemin pointerait vers un dossier jamais copie.
  const dirsToCopy = new Set(MIGRATION_DIRS);
  try {
    const cfgSrc = JSON.parse(fs.readFileSync(oldCfg, 'utf-8'));
    const sd = cfgSrc && cfgSrc.settings && cfgSrc.settings.storageDir;
    if (typeof sd === 'string' && sd) {
      const rel = path.relative(portableDataDir, path.resolve(sd));
      if (rel === '') {
        // storageDir == SoundFart-data : tous les sous-dossiers racine sont
        // du stockage utilisateur (sons/, imports/, etc.) — on les ajoute
        // tous, sinon la reecriture de chemin pointerait vers du vide.
        try {
          for (const e of fs.readdirSync(portableDataDir, { withFileTypes: true })) {
            if (e.isDirectory() && !e.name.startsWith('.')) dirsToCopy.add(e.name);
          }
        } catch { /* readdir impossible : liste fixe seule */ }
      } else if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        dirsToCopy.add(rel.split(path.sep).join('/'));
      }
    }
  } catch { /* config illisible : les 5 dossiers fixes suffisent */ }
  // 1) Copies de repertoires — idempotentes, sans ecrasement.
  for (const d of dirsToCopy) {
    const src = path.join(portableDataDir, d);
    if (!fs.existsSync(src)) continue;
    const st = copyDirSafe(src, path.join(appData, d), process.pid);
    details.dirs[d] = st;
    for (const er of st.errors) details.errors.push(d + '/' + er);
    say('[migration] copie ' + d + ' : ' + st.copied + ' ajoutes, ' + st.kept + ' conserves' +
        (st.errors.length ? ', ' + st.errors.length + ' erreurs' : ''), st.errors.length ? 'warn' : 'info');
  }
  // 2) Reecriture des configs — seulement les fichiers presents a la source.
  for (const f of MIGRATION_FILES) {
    const src = path.join(portableDataDir, f);
    if (!fs.existsSync(src)) continue;
    try {
      rewriteConfigFile(src, path.join(appData, f), portableDataDir, appData);
      details.files.push(f);
    } catch (e) {
      details.errors.push(f + ' : ' + (e && e.message));
      say('[migration] reecriture ' + f + ' : ' + (e && e.message), 'warn');
    }
  }
  // 3) Marqueur = SEULE preuve de completion : ecrit uniquement si aucune
  // erreur de copie ni de reecriture. Sinon la migration reprend au
  // prochain lancement (les fichiers deja copies sont sautes).
  const complete = details.errors.length === 0;
  if (complete) {
    try {
      fs.writeFileSync(marker, new Date().toISOString());
      say('[migration] donnees reprises de SoundFart-data vers ' + appData, 'info');
    } catch (e) {
      // Marqueur non ecrit = migration PAS terminee : le retour doit le
      // refleter (sinon l'appelant pourrait se croire en succes alors que
      // la prochaine execution recommencera — ce qui est de toute facon
      // le comportement sur disque, mais restons honnetes dans le retour).
      details.errors.push('marqueur : ' + (e && e.message));
      say('[migration] marqueur non ecrit : ' + (e && e.message), 'warn');
      return { ran: true, complete: false, details };
    }
  } else {
    say('[migration] incomplete (' + details.errors.length + ' erreur(s)) — nouvelle tentative au prochain lancement', 'warn');
  }
  return { ran: true, complete, details };
}

module.exports = { runPortableMigration, copyDirSafe, rewriteConfigFile, sweepMigtmp, MIGRATION_DIRS, MIGRATION_FILES, MIGRATION_MARKER };
