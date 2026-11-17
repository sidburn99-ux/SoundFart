// Import de fichiers audio vers <root>/sons avec copie atomique.
// Extrait de main.js pour etre testable via node:test.
//
// Garanties :
// - Dedoublonnage : un fichier deja present (taille + echantillons tete/queue
//   + confirmation SHA-256) est reutilise, jamais recopie ni substitue.
// - Nom final : les imports sont serialises par dossier (enqueueImport) —
//   deux imports concurrents ne peuvent plus s'ecraser au rename().
// - Copie .part a nom unique (pid + sequence) + rename atomique : jamais de
//   fichier final a moitie copie, jamais de .part melange entre sources.
const fs = require('fs');
const path = require('path');
const { AUDIO_EXT } = require('./audio-utils');
const { sameFileContent } = require('./file-sign');

let importPartSeq = 0;

// Filtre rapide : taille (verifiee par l'appelant) + 4 KiB en tete et queue.
// NE PROUVE PAS l'identite — sameFileContent confirme par SHA-256 avant
// toute reutilisation, pour qu'un faux positif n'écrase jamais un fichier.
async function sameFileQuick(a, b) {
  const rd = async (p, off, len) => {
    const fd = await fs.promises.open(p, 'r');
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fd.read(buf, 0, len, off);
      return buf.subarray(0, bytesRead);
    } finally { await fd.close(); }
  };
  const sa = await fs.promises.stat(a), sb = await fs.promises.stat(b);
  if (sa.size !== sb.size) return false;
  const n = Math.min(4096, sa.size);
  const [ha, hb, ta, tb] = await Promise.all([rd(a, 0, n), rd(b, 0, n), rd(a, Math.max(0, sa.size - n), n), rd(b, Math.max(0, sb.size - n), n)]);
  return ha.equals(hb) && ta.equals(tb);
}

// Serialisation des imports par dossier de stockage : deux appels
// concurrents (meme nom de fichier, contenus differents) passaient tous
// deux le test « cible libre » puis leurs rename() s'ecrasaient — perte
// silencieuse d'un import. La file par root rend verification+copie
// atomique ; le doublon reel est rattrape par la dedoublonnage.
const importChains = new Map(); // cle normalisee -> Promise
// Cle = chemin resolu+minuscule : 'E:\\A' et 'e:\\a\\' designent le meme
// dossier sous Windows — sans normalisation, deux cles distinctes
// contourneraient la serialisation et rouvriraient la course au rename.
const queueKey = (root) => path.resolve(root).toLowerCase();
function enqueueImport(root, fn) {
  const k = queueKey(root);
  const prev = importChains.get(k) || Promise.resolve();
  const next = prev.then(fn, fn); // fn doit tourner meme si prev a rejete
  importChains.set(k, next.catch(() => {}));
  return next;
}

// Menage des temporaires orphelins : un kill entre copyFile et rename
// laisse « x.part » / « x.migtmp-pid » sur disque — invisibles pour l'app
// (extension inconnue) et cumulés a chaque import/interruption. On ne
// supprime que les fichiers de plus de 1 h : une copie en vol n'est
// jamais aussi vieille (borne 512 Mo), une instance concurrente est
// protegee. Meilleur-effort : un echec de menage ne bloque pas l'import.
async function sweepStaleTemps(dir, log) {
  let removed = 0;
  try {
    const now = Date.now();
    for (const f of await fs.promises.readdir(dir)) {
      if (!f.endsWith('.part') && !f.includes('.migtmp-')) continue;
      const p = path.join(dir, f);
      try {
        const st = await fs.promises.stat(p);
        if (st.isFile() && now - st.mtimeMs > 3600e3) { await fs.promises.unlink(p); removed++; }
      } catch (e) { if (log) log('[import] menage ' + f + ' : ' + (e && e.message), 'warn'); }
    }
    if (removed && log) log('[import] ' + removed + ' temporaire(s) orphelin(s) supprime(s) dans ' + dir);
  } catch (e) { if (log) log('[import] menage ' + dir + ' : ' + (e && e.message), 'warn'); }
  return removed;
}

// Copie paths[] vers <root>/sons. Retourne [{path,label,error}] par source
// exploitable ; les erreurs sont par fichier, jamais bloquantes pour le lot.
async function importAudioFiles(paths, root, log) {
  const dest = path.join(root, 'sons');
  await fs.promises.mkdir(dest, { recursive: true });
  await sweepStaleTemps(dest, log);
  const out = [];
  for (const src of paths) {
    const ext = path.extname(src).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) continue;
    const st = await fs.promises.stat(src).catch(() => null);
    if (!st || !st.isFile()) { out.push({ path: src, label: '', error: 'illisible' }); continue; }
    // Un fichier vide s'importerait puis echouerait au decode — on le
    // refuse tot (meme regle que file:read qui ne verifie pas non plus,
    // mais ici le cout d'une entree bibliotheque morte est certain).
    if (st.size === 0) { out.push({ path: src, label: '', error: 'fichier vide' }); continue; }
    // file:read refuse >512 Mo : importer un fichier plus gros le copierait
    // pour un usage garanti impossible — on refuse tot avec la meme borne.
    if (st.size > 512 * 1024 * 1024) { out.push({ path: src, label: '', error: 'trop volumineux (> 512 Mo)' }); continue; }
    const base = path.basename(src);
    const stem = base.slice(0, base.length - ext.length) || base;
    let reused = null, target = null;
    for (let i = 0; i < 1000 && !target && !reused; i++) {
      const cand = path.join(dest, i === 0 ? base : `${stem} (${i})${ext}`);
      const cst = await fs.promises.stat(cand).catch(() => null);
      if (!cst) target = cand;
      else if (cst.size === st.size && await sameFileQuick(src, cand).catch(() => false)
               && await sameFileContent(src, cand).catch(() => false)) reused = cand;
    }
    if (reused) { out.push({ path: reused, label: stem }); continue; }
    if (!target) { out.push({ path: src, label: '', error: 'nom introuvable' }); continue; }
    const tmp = `${target}.${process.pid}.${importPartSeq++}.part`;
    try {
      await fs.promises.copyFile(src, tmp);
      const cst = await fs.promises.stat(tmp);
      if (cst.size !== st.size) throw new Error('copie incomplète');
      await fs.promises.rename(tmp, target);
    } catch (e2) {
      try { await fs.promises.unlink(tmp); } catch {}
      out.push({ path: src, label: '', error: e2.message });
      continue;
    }
    out.push({ path: target, label: stem });
  }
  return out;
}

module.exports = { importAudioFiles, enqueueImport, sameFileQuick, sweepStaleTemps, AUDIO_EXT };
