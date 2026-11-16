'use strict';

const SR = 48000;
// Source unique : lib/audio-utils.js (SFUtils) — la copie locale avait
// diverge possible entre main et renderer.
const VIRTUAL_RE = window.SFUtils.VIRTUAL_RE;
const PALETTE = ['#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4', '#eab308', '#ef4444', '#3b82f6'];
const THUMB_EMOJIS = ['💨', '🔊', '📢', '🎺', '🦖', '🤖', '👽', '🔥', '⚡', '🍕', '🎮', '🏆', '💣', '🧨', '🎉', '😱', '🤣', '🤡', '👻', '🐔', '🐸', '🐵', '🦁', '🐯', '🐙', '🚀', '🌈', '🍔', '🍿', '🎯', '🎲', '🃏', '🎰', '📯', '🎷', '🎸', '🥁', '🎻', '🎤', '📻', '🔔', '⏰', '💎', '🪙', '🎁', '🍩', '🧃', '🥤', '👑', '🃏'];

// Vignette deterministe par son : emoji + teinte derives du nom et de la categorie
function thumbFor(s) {
  const str = (s.categoryId || '') + '|' + s.name;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return { hue: h % 360, emoji: THUMB_EMOJIS[h % THUMB_EMOJIS.length] };
}
const SORTS = [
  ['added-desc', 'Ajout : plus récents'],
  ['added-asc', 'Ajout : plus anciens'],
  ['name-asc', 'Nom : A → Z'],
  ['name-desc', 'Nom : Z → A'],
  ['plays-desc', 'Les plus utilisés'],
  ['volume-desc', 'Volume : plus fort'],
];

const CAT_SORTS = [
  ['manual', 'Catégories : ordre perso (▲▼)'],
  ['name-asc', 'Catégories : A → Z'],
  ['name-desc', 'Catégories : Z → A'],
  ['count-desc', 'Catégories : plus de sons'],
];

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) e.style.setProperty(sk, sv); }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null) e.append(c);
  return e;
}

// ================================================================ etat
let cfg;
let missing = new Set();
const cardEls = new Map();
const playingCount = new Map();
const playingNames = new Map(); // id -> nom : couvre les aperçus (sons éphémères absents de cfg.sounds)
let saveTimer;

const defaults = () => ({
  version: 2,
  sounds: [],
  categories: [],
  settings: { cableId: '', cableLabel: '', monId: 'default', monLabel: '', micId: '', micLabel: '', micMix: false, master: 80, sort: 'added-desc', catSort: 'manual', stopShortcut: 'CommandOrControl+Alt+S', storageDir: '', autoSwitchMic: true, watchdogMic: true, groupByCat: true, normLufs: -18 },
  ui: { cat: 'all' },
});

let saveErrNotified = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.sf.saveConfig(cfg).catch((e) => {
    logErr('saveConfig', e);
    // Config jamais persistee en silence (ex. >5 Mo) : un toast une fois
    // suffit — l'utilisateur doit savoir que ses reglages sont perdus.
    if (!saveErrNotified) { saveErrNotified = true; toast('Sauvegarde impossible : ' + (e && e.message || e), 'warn'); }
  }), 250);
}
window.addEventListener('beforeunload', () => {
  if (cfg) { try { const p = window.sf.saveConfig(cfg); if (p && p.catch) p.catch((e) => logErr('saveConfig', e)); } catch (e) { logErr('saveConfig', e); } }
  window.sf.restoreMic();
});

function normalizeCfg(saved) {
  // JSON.parse cree une propriete '__proto__' propre : Object.assign la
  // copierait via le setter et remplacerait le prototype de c.
  const clean = saved && typeof saved === 'object' ? { ...saved } : {};
  delete clean.__proto__;
  const c = Object.assign(defaults(), clean);
  const mergeSub = (base, sub) => {
    if (!sub || typeof sub !== 'object') return base;
    const s = { ...sub }; delete s.__proto__;
    return Object.assign(base, s);
  };
  c.settings = mergeSub(defaults().settings, c.settings);
  // Types stricts sur les reglages : une config importee peut contenir
  // 'false' (string truthy) ou des nombres invalides -> comportement
  // incoherent (micMix active, volumes aberrants).
  for (const k of ['micMix', 'autoSwitchMic', 'watchdogMic', 'groupByCat']) c.settings[k] = c.settings[k] === true;
  if (!Number.isFinite(+c.settings.master)) c.settings.master = 80; else c.settings.master = Math.min(100, Math.max(0, +c.settings.master));
  if (typeof c.settings.stopShortcut !== 'string' || c.settings.stopShortcut.length > 64) c.settings.stopShortcut = defaults().settings.stopShortcut;
  if (typeof c.settings.sort !== 'string' || !SORTS.some(([v]) => v === c.settings.sort)) c.settings.sort = 'added-desc';
  if (typeof c.settings.catSort !== 'string' || !CAT_SORTS.some(([v]) => v === c.settings.catSort)) c.settings.catSort = 'manual';
  // Cible de loudness en LUFS (approx BS.1770) : -40 a 0, defaut -18.
  // L'ancienne cle normTarget (fraction de pic) est abandonnee.
  delete c.settings.normTarget;
  const nl = +c.settings.normLufs;
  c.settings.normLufs = (Number.isFinite(nl) && nl <= 0 && nl >= -40) ? nl : defaults().settings.normLufs;
  c.ui = mergeSub(defaults().ui, c.ui);
  if (!Array.isArray(c.sounds)) c.sounds = [];
  if (!Array.isArray(c.categories)) c.categories = [];
  // purge les entrees invalides et deduplique par id puis par chemin (garde le premier)
  const seenId = new Set(), seenPath = new Set();
  c.sounds = c.sounds.filter((s) => {
    // '__stop__' est la cle reservee des raccourcis globaux (main.js) :
    // un son avec cet id aurait un raccourci qui agit comme STOP.
    if (!s || typeof s.id !== 'string' || s.id === '__stop__' || typeof s.path !== 'string' || typeof s.name !== 'string') return false;
    // Bornes : shortcuts:apply ignore silencieusement les id >128 car. et
    // des noms geants x5000 sons font echouer config:save (>5 Mo) en silence.
    s.id = s.id.slice(0, 128); s.name = s.name.slice(0, 200);
    const p = s.path.toLowerCase();
    if (seenId.has(s.id) || seenPath.has(p)) return false;
    seenId.add(s.id); seenPath.add(p);
    return true;
  });
  // Plafonds : file:check refuse >5000 chemins (checkMissing mourrait en
  // silence) et une config geante gelerait le rendu (carte par son).
  if (c.sounds.length > 5000) c.sounds = c.sounds.slice(0, 5000);
  if (c.categories.length > 500) c.categories = c.categories.slice(0, 500);
  c.sounds.forEach((s) => {
    s.volume ??= 100; s.plays ??= 0; s.addedAt ??= 0;
    // Types stricts : 'false' (string truthy) ou categoryId non-string
    // dans un import rendaient les filtres incoherents.
    s.favorite = s.favorite === true;
    s.categoryId = typeof s.categoryId === 'string' ? s.categoryId : null;
    s.norm ??= 1; s.shortcut ??= null;
    s.trimStart ??= 0; s.trimEnd ??= null; s.fadeIn ??= 0; s.fadeOut ??= 0;
    // Coercions : une config importée avec des types invalides ne doit pas
    // crasher le rendu (shortcut non-string -> fmtAccel) ni casser l'audio.
    if (typeof s.shortcut !== 'string' || s.shortcut.length > 64) s.shortcut = null;
    if (!Number.isFinite(+s.volume)) s.volume = 100; else s.volume = Math.min(300, Math.max(0, +s.volume));
    if (!Number.isFinite(+s.norm) || +s.norm <= 0) s.norm = 1; else s.norm = Math.min(4, +s.norm);
    // Compteurs/tri : NaN casse les tris added-desc/plays-desc ; fades/trims
    // negatifs produisent des ramps dans le passe.
    if (!Number.isFinite(+s.addedAt)) s.addedAt = 0; else s.addedAt = +s.addedAt;
    if (!Number.isFinite(+s.plays)) s.plays = 0; else s.plays = Math.max(0, +s.plays);
    for (const k of ['trimStart', 'trimEnd', 'fadeIn', 'fadeOut']) {
      if (s[k] == null) continue;
      const n = +s[k];
      // coercition : une string "1.5" importee doit devenir nombre — editSound
      // appelle toFixed dessus et plantait sur les configs tapees a la main.
      s[k] = (Number.isFinite(n) && n >= 0) ? n : (k === 'trimEnd' ? null : 0);
    }
    if (s.trimEnd != null && Number.isFinite(+s.trimStart) && +s.trimEnd <= +s.trimStart) s.trimEnd = null;
  });
  // Migration v1 -> v2 : les s.norm heritees de la normalisation par PIC
  // ne sont pas des gains LUFS — on les invalide (x1) pour forcer un
  // recalcul. Volumes manuels, decoupes, fondus, favoris, categories et
  // raccourcis sont preserves ; les fichiers audio ne sont jamais
  // modifies. Testee sur la version DE L'IMPORT (clean), pas sur la
  // fusionnee : une config sans version est traitee comme legacy.
  if (window.SFUtils.isPreLufsConfig(clean.version)) c.sounds.forEach((s) => { s.norm = 1; });
  c.version = 2;
  // Raccourcis : dedupe insensible a la casse — un import peut creer des
  // doublons que l'UI bloque mais qui sinon faisaient echouer register().
  {
    const seenSc = new Set();
    // normAccel : 'CommandOrControl+X' et 'Ctrl+X' sont le meme raccourci
    // Windows — la dedupe brute les laissait passer toutes les deux.
    const stopSc = normAccel(c.settings.stopShortcut);
    for (const s of c.sounds) {
      if (!s.shortcut) continue;
      const a = normAccel(s.shortcut);
      if (seenSc.has(a) || a === stopSc || RESERVED_SC.has(a)) s.shortcut = null; else seenSc.add(a);
    }
    if (RESERVED_SC.has(normAccel(c.settings.stopShortcut))) c.settings.stopShortcut = defaults().settings.stopShortcut;
  }
  // ids de categories dupliques : garde le premier (catById serait ambigu)
  {
    const seenCat = new Set();
    c.categories = c.categories.filter((cat) => {
      if (!cat || typeof cat.id !== 'string' || typeof cat.name !== 'string') return false;
      if (seenCat.has(cat.id)) return false;
      seenCat.add(cat.id); return true;
    });
  }
  c.categories.forEach((cat, i) => {
    // CSS hex valide : 3/4/6/8 chiffres seulement (5 et 7 sont invalides) ;
    // une couleur cassee/importee null retombe sur la palette, jamais sur
    // un --c invalide pour color-mix.
    if (cat && (typeof cat.color !== 'string' || !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(cat.color)))
      cat.color = PALETTE[i % PALETTE.length];
  });
  // settings : types invalides -> valeurs par defaut (master NaN cassait les deux sorties)
  const st = c.settings;
  if (!Number.isFinite(+st.master)) st.master = 80; else st.master = Math.min(100, Math.max(0, +st.master));
  if (typeof st.stopShortcut !== 'string' || st.stopShortcut.length > 64) st.stopShortcut = defaults().settings.stopShortcut;
  // Chemins relatifs : storageRoot() retomberait silencieusement sur
  // userData alors que l'UI affiche le dossier choisi — on exige un
  // chemin absolu (lettre:\\, UNC \\\\, ou /) pour les deux champs.
  const absPath = (p) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
  if (st.storageDir != null && (typeof st.storageDir !== 'string' || (st.storageDir !== '' && !absPath(st.storageDir)))) st.storageDir = '';
  if (st.lastDestDir != null && (typeof st.lastDestDir !== 'string' || (st.lastDestDir !== '' && !absPath(st.lastDestDir)))) delete st.lastDestDir;
  const hasCat = (id) => c.categories.some((x) => x.id === id);
  if (!['all', 'none', 'fav'].includes(c.ui.cat) && !hasCat(c.ui.cat)) c.ui.cat = 'all';
  return c;
}

const catById = (id) => cfg.categories.find((c) => c.id === id);
// soundHasCat est appele par son a chaque render (des milliers d'appels) :
// un find() lineaire par son = O(sons x categories). Set d'ids mis en cache,
// invalide des que le tableau change de reference ou de taille (rename/
// reorder gardent les memes ids -> cache reste valide a juste titre).
let catIdCache = { ref: null, size: -1, set: null };
const catIdSet = () => {
  if (!catIdCache.set || catIdCache.ref !== cfg.categories || catIdCache.size !== cfg.categories.length) {
    catIdCache = { ref: cfg.categories, size: cfg.categories.length, set: new Set(cfg.categories.map((c) => c.id)) };
  }
  return catIdCache.set;
};
const soundHasCat = (s) => !!(s.categoryId && catIdSet().has(s.categoryId));

// ================================================================ interface generique
function toast(msg, kind = '') {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  $('#toast').append(t);
  setTimeout(() => t.remove(), 4200);
}

let modalClose = null;
function modal(title, body, buttons, opts = {}) {
  const root = $('#modal-root');
  const appEl = document.getElementById('app');
  // Une nouvelle modale remplace l'ancienne : fermer proprement la precedente
  // pour declencher son onClose (ex. cleanup de l'enregistreur). Son close()
  // remet appEl.inert=false — l'inert de la NOUVELLE modale doit etre pose
  // APRES cet appel, sinon le fond redevient interactif (SF-REL-0636).
  if (modalClose) { try { modalClose(); } catch {} }
  if (appEl) appEl.inert = true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.replaceChildren();
    document.removeEventListener('keydown', onKey);
    const appEl = document.getElementById('app');
    if (appEl) appEl.inert = false;
    if (modalClose === close) modalClose = null;
    // onClose avant resolve : un onClose qui jette ne doit PAS empecher
    // la resolution — sinon la promesse du dialogue reste pendue a jamais.
    try { if (opts.onClose) opts.onClose(); } catch (e) { logErr('modal onClose', e); }
    // FERMETURE PAR ECHAP/ BACKDROP : les promesses des dialogues
    // (askText/confirmBox/askDestDir) doivent etre resolues — sinon un
    // await reste pendu a jamais (ex. enregistrement perdu en silence
    // si l'utilisateur annule le choix de dossier avec Echap).
    if (opts.resolve) opts.resolve(opts.resolveValue);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    el('h2', { text: title }),
    el('div', { class: 'modal-body' }, body),
    el('div', { class: 'modal-actions' },
      buttons.map((b) => el('button', { class: b.kind || '', text: b.label, onclick: () => b.onclick(close) }))));
  root.replaceChildren(el('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === e.currentTarget) close(); } }, box));
  modalClose = close;
  return close;
}

const field = (label, node, hint) =>
  el('div', { class: 'field' }, el('label', { text: label }), node, hint ? el('div', { class: 'hint', text: hint }) : null);

function askText(title, label, initial, okLabel) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value: initial || '', maxlength: 80 });
    // resolve AVANT close : la valeur explicite prime sur resolveValue (null).
    const done = (close, v) => { resolve(v); close(); };
    const close = modal(title, [field(label, input)], [
      { label: 'Annuler', onclick: (c) => done(c, null) },
      { label: okLabel || 'OK', kind: 'primary', onclick: (c) => done(c, input.value.trim() || null) },
    ], { resolve, resolveValue: null });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(close, input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

function confirmBox(title, msg, okLabel) {
  return new Promise((resolve) => {
    modal(title, [el('div', { text: msg })], [
      { label: 'Annuler', onclick: (c) => { resolve(false); c(); } },
      { label: okLabel || 'Confirmer', kind: 'primary', onclick: (c) => { resolve(true); c(); } },
    ], { resolve, resolveValue: false });
  });
}

// ================================================================ moteur audio
const decoder = new OfflineAudioContext(2, 1, SR);
const audio = { cable: null, mon: null, micStream: null, devices: { out: [], inp: [] } };
const bufCache = new Map(); // path -> { buf, bytes } — LRU borne en OCTETS (256 Mo)
const BUF_CACHE_MAX = 256 * 1024 * 1024;
const bufBytes = (b) => b.length * b.numberOfChannels * 4; // float32
const longWarned = new Set();
const voices = new Set();
let playGen = 0; // generation audio : stopAll/teardownAudio l'incrementent pour avorter les play() en vol
let interruptedRetries = 0; // retry borne sur etat 'interrupted' (reset sur 'running')
let bufCacheBytes = 0;

const bufInflight = new Map(); // path -> Promise<buf> : evite le double decodage concurrent
let decodeActive = 0; // semaphore : 2 decodeAudioData simultanes max
const decodeQueue = []; // {res, bytes} en attente de slot decode
let decodeQueuedBytes = 0; // chaque waiter retient son ArrayBuffer brut
const DECODE_QUEUE_MAX = 64;
const DECODE_QUEUE_MAX_BYTES = 512 * 1024 * 1024;
function acquireDecode(bytes) {
  if (decodeActive < 2) { decodeActive++; return Promise.resolve(); }
  // File bornee : sans ca, des centaines de clics sur sons lourds
  // retenaient chacun leur ArrayBuffer brut (jusqu'a 150 Mo) en attente.
  if (decodeQueue.length >= DECODE_QUEUE_MAX || decodeQueuedBytes + bytes > DECODE_QUEUE_MAX_BYTES) {
    // noFileErr : erreur transitoire de ressource, pas un fichier absent —
    // sinon play() badge « introuvable » et le vrai message est masque.
    const e = new Error('Trop de lectures simultanées — réessayez dans un instant.');
    e.noFileErr = true;
    return Promise.reject(e);
  }
  decodeQueuedBytes += bytes;
  return new Promise((res) => decodeQueue.push({ res, bytes }));
}
function releaseDecode() {
  const next = decodeQueue.shift();
  if (next) { decodeQueuedBytes -= next.bytes; next.res(); } // slot transfere au waiter
  else decodeActive--;
}
async function getBuffer(path) {
  if (bufCache.has(path)) {
    const e = bufCache.get(path);
    bufCache.delete(path);
    bufCache.set(path, e);
    return e.buf;
  }
  if (bufInflight.has(path)) return bufInflight.get(path);
  const p = (async () => {
    const data = await window.sf.readFile(path).catch((e) => {
      // Seul un vrai manquant (ENOENT) doit badge « introuvable » : un
      // fichier present mais trop gros / non lisible / extension refusee
      // est une erreur de lecture, pas un manquant (file:check fait foi).
      const m = String(e && e.message || e);
      if (/ENOENT|no such file|introuvable/i.test(m)) throw e;
      const ne = new Error(m.replace(/^.*?:\s*/, ''));
      ne.noFileErr = true;
      throw ne;
    });
    // Garde anti-OOM : le PCM decode tient ~22 Mo/min ; au-dela d'un fichier
    // tres lourd on refuse AVANT decodeAudioData (crash renderer connu).
    // noFileErr : le fichier EXISTE mais ne peut pas etre joue — ne doit pas
    // etre badge « introuvable » (fileErr = vrai manquant seulement).
    if (data.byteLength > 150 * 1024 * 1024) { const e = new Error('Fichier trop volumineux pour être joué (' + Math.round(data.byteLength / 1048576) + ' Mo).'); e.noFileErr = true; throw e; }
    const ab = data instanceof ArrayBuffer ? data
      : data && data.buffer ? data.buffer.slice(data.byteOffset || 0, (data.byteOffset || 0) + data.byteLength)
      : new Uint8Array(data).buffer; // robustness : ArrayBuffer pur ou Uint8Array
  await acquireDecode(data.byteLength);
  let buf;
  try { buf = await decoder.decodeAudioData(ab); }
  catch (de) { de.noFileErr = true; throw de; } // codec/format : fichier present mais indecodable
  finally { releaseDecode(); }
  const bytes = bufBytes(buf);
  // Forensique crash renderer (-1/143) : la taille PCM decodee est la donnee
  // qui manque pour distinguer OOM decode vs crash driver — on la journalise.
  if (bytes > 64 * 1024 * 1024) uiLog('decode lourd : ' + Math.round(bytes / 1048576) + ' Mo PCM (' + path + ')');
  // Buffer decode plus gros que tout le cache : ne pas le retenir (il
  // evincerait tout pour rien et pourrait lui-meme saturer le renderer).
  // Plafond dur : au-dela de 512 Mo de PCM (≈23 min stereo), le renderer
  // etait expose au crash OOM documente (-1/143) — on refuse la lecture.
  if (bytes > 512 * 1024 * 1024) {
    const e = new Error('Fichier trop long pour être joué (' + Math.round(buf.duration / 60) + ' min).');
    e.noFileErr = true; throw e;
  }
  if (bytes > BUF_CACHE_MAX) {
    toast('Fichier très lourd : joué sans cache pour économiser la mémoire.', 'warn');
    return buf;
  }
  // Fichier tres long : un buffer decode tient ~22 Mo/min stereo — on previent une fois.
  if (buf.duration > 600 && !longWarned.has(path)) {
    longWarned.add(path);
    toast('Fichier long (> 10 min) : il occupera beaucoup de mémoire une fois joué.', 'warn');
  }
  // Orphelin de cache : si le son a ete retire/relocalise pendant le
  // decodeAudioData, ne pas mettre en cache un buffer pour un path qui
  // n'est plus reference (jusqu'a 256 Mo de residue).
  if (cfg.sounds.some((x) => x.path === path)) {
    bufCache.set(path, { buf, bytes });
    bufCacheBytes += bytes;
    while (bufCacheBytes > BUF_CACHE_MAX && bufCache.size > 1) {
      const k = bufCache.keys().next().value;
      bufCacheBytes -= bufCache.get(k).bytes;
      bufCache.delete(k);
    }
  }
    return buf;
  })();
  bufInflight.set(path, p);
  try { return await p; } finally { bufInflight.delete(path); }
}

// Supprime une entree du cache EN coherance avec le compteur d'octets :
// sans ca bufCacheBytes derivait a la hausse a chaque suppression et le
// cache 256 Mo s'auto-videait progressivement (eviction prematuree).
function cacheDelete(path) {
  const e = bufCache.get(path);
  if (!e) return;
  bufCache.delete(path);
  bufCacheBytes = Math.max(0, bufCacheBytes - e.bytes);
}

async function makeOutput(deviceId) {
  // Forensique crash -1/143 : journaliser le peripherique exact — le crash
  // AudioContext precedent ne disait pas sur QUEL device il est survenu.
  uiLog('makeOutput: creation AudioContext device=' + (deviceId || 'defaut'));
  const ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
  try {
    await ctx.setSinkId(deviceId);
  } catch (e) {
    ctx.close().catch(() => {});
    throw e;
  }
  // Etat 'interrupted' (session Windows coupee sans devicechange) : sans
  // ecoute, les voix restent zombies et le silence est indetectable.
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') interruptedRetries = 0;
    if (ctx.state === 'suspended') { uiLog('sortie audio suspendue (device=' + (deviceId || 'defaut') + ')'); return; }
    if (ctx.state === 'interrupted' || ctx.state === 'closed') {
      uiLog('sortie audio ' + ctx.state + ' (device=' + (deviceId || 'defaut') + ')');
      if (ctx.state === 'interrupted') {
        toast('Sortie audio interrompue — réessaie de jouer un son.', 'warn');
        // Session Windows coupee sans devicechange : on retente UNE
        // reconstruction bornee (applyAudio recree les sorties) au lieu de
        // laisser une sortie morte jusqu'au prochain changement de peripherique.
        if (interruptedRetries < 3) {
          interruptedRetries++;
          setTimeout(() => { applyAudio().catch((e) => logErr('applyAudio retry', e)); }, 1500);
        }
      }
    }
  });
  const bus = ctx.createGain();
  bus.gain.value = cfg.settings.master / 100;
  const lim = ctx.createDynamicsCompressor(); // limiteur : evite la saturation quand on monte le volume d'un son
  lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
  bus.connect(lim);
  lim.connect(ctx.destination);
  return { ctx, bus, lim, deviceId };
}

async function teardownAudio() {
  stopAll(true);
  playGen++;
  for (const v of [...voices]) endVoice(v); // purge les voix zombies restees bloquees
  const closedCtx = new Set(); // cable et mon peuvent partager le meme ctx
  for (const k of ['cable', 'mon']) {
    // Null AVANT close() : un play() dans la fenetre de fermeture ne doit
    // pas attraper un contexte mourant (InvalidStateError parasite).
    const a = audio[k]; audio[k] = null;
    if (a && !closedCtx.has(a.ctx)) { closedCtx.add(a.ctx); try { await a.ctx.close(); } catch {} }
  }
  if (audio.micStream) { audio.micStream.getTracks().forEach((t) => t.stop()); audio.micStream = null; }
}

// applyAudio est appele depuis 6 endroits (devicechange, reglages, import...) :
// sans serialisation, deux appels s'entrelacent et leakent AudioContext + stream micro.
let audioApplyChain = Promise.resolve();
function applyAudio() {
  const p = audioApplyChain.then(applyAudioInner);
  audioApplyChain = p.catch(() => {});
  return p;
}

async function applyAudioInner() {
  await teardownAudio();
  const s = cfg.settings;
  const warns = [];
  // une sortie en echec ne doit pas empecher l'autre de demarrer
  try {
    if (s.cableId) audio.cable = await makeOutput(s.cableId);
  } catch (e) {
    warns.push('Sortie Discord : ' + e.message);
  }
  // Meme peripherique pour cable et ecoute : PARTAGER le contexte au lieu
  // d'en creer un second — chaque AudioContext est une surface d'exposition
  // au crash audio -1/143 (SF-REL-0611), et le doublon ne change rien a
  // l'audio (meeme destination). Si cable a echoue, on tente quand meme
  // mon : l'erreur sera rapportee pour les deux sorties.
  const sameOut = s.cableId && s.monId && s.cableId === s.monId && audio.cable;
  try {
    if (s.monId) audio.mon = sameOut ? audio.cable : await makeOutput(s.monId);
  } catch (e) {
    warns.push('Écoute locale : ' + e.message);
  }
  // Mixage micro requis des que la bascule auto est active : sinon Discord n'entend que les
  // sons, jamais la voix. micMix reste un interrupteur manuel complementaire.
  const micMixOn = s.micMix || s.autoSwitchMic;
  if (micMixOn) {
    let micPendingStream = null; // getUserMedia reussi mais graphe en echec : a stopper
    try {
      if (!audio.cable) warns.push('Mixage micro : choisis d\'abord une sortie Discord.');
      else if (!VIRTUAL_RE.test(s.cableLabel)) warns.push('Mixage micro désactivé : la sortie Discord n\'est pas un câble virtuel (tu t\'entendrais dans ton casque).');
      else if (s.cableId === s.monId) warns.push('Mixage micro désactivé : sortie Discord et écoute locale identiques.');
      else {
        // « default » pointerait sur CABLE Output depuis la bascule micro auto : on prend un vrai peripherique non virtuel
        let micDev = s.micId && s.micId !== 'default' ? s.micId : null;
        // deviceId perime (peripherique retire alors que resolveDevices
        // n'a pas tourne) : getUserMedia({exact}) jetterait NotFoundError —
        // on retombe sur le premier vrai micro non virtuel.
        if (micDev && !(audio.devices.inp || []).some((d) => d.deviceId === micDev)) micDev = null;
        if (!micDev) {
          const real = (audio.devices.inp || []).find((d) => d.deviceId !== 'default' && !VIRTUAL_RE.test(d.label || ''));
          micDev = real ? real.deviceId : (s.micId === 'default' ? 'default' : undefined);
        }
        // Traitement vocal sur la voix uniquement (echo cancellation, bruit, gain) —
        // les sons joues via Web Audio ne sont pas concernes.
        micPendingStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: micDev ? { exact: micDev } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const stream = micPendingStream;
        // Micro perdu sans devicechange (debranchement, BT qui coupe) : le
        // track meurt -> Discord n'entend plus la voix, sans aucun signal.
        stream.getTracks().forEach((t) => {
          t.addEventListener('ended', () => { if (audio.micStream === stream) { toast('Micro perdu — voix coupée sur le câble.', 'warn'); audio.micStream = null; applyAudio().catch((e) => logErr('applyAudio', e)); } });
          t.addEventListener('mute', () => { if (audio.micStream === stream) toast('Micro muet par le système — voix coupée.', 'warn'); });
        });
        const src = audio.cable.ctx.createMediaStreamSource(stream);
        src.connect(audio.cable.lim);
        audio.micStream = stream; // apres connect : un echec ne laisse pas de piste orpheline
        micPendingStream = null;
      }
    } catch (e) {
        // Si le graphe a jete apres getUserMedia, stopper le stream tout de
        // suite : sinon le micro reste allume (LED) sans etre connecte.
        try { if (micPendingStream) micPendingStream.getTracks().forEach((t) => t.stop()); } catch {}
        warns.push('Micro inaccessible : ' + e.message);
      }
  }
  updateRoutes();
  if (warns.length) toast(warns.join('\n'), 'warn');
  return warns.length === 0;
}

let permWarnShown = false;
const warnPermOnce = (msg) => {
  logErr('refreshDevices', new Error(msg));
  if (!permWarnShown) { permWarnShown = true; toast('Accès audio refusé ou indisponible — la liste des périphériques peut être incomplète. Vérifie l\'autorisation micro.', 'warn'); }
};

async function refreshDevices(askPermission) {
  audio.devicesDegraded = false;
  if (askPermission) {
    // Ce getUserMedia est VOLONTAIRE : c'est lui qui fait passer la permission
    // 'microphone' — sans lui, enumerateDevices ne retourne que des
    // placeholders vides (deviceId=''). L'echec est journalise, jamais masque.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      audio.devicesDegraded = true;
      warnPermOnce('getUserMedia refuse: ' + (e && e.name ? e.name : e) + ' ' + (e && e.message ? e.message : ''));
      return false;
    }
  }
  let list;
  try {
    list = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    audio.devicesDegraded = true;
    warnPermOnce('enumerateDevices a echoue: ' + (e && e.name ? e.name : e));
    return false;
  }
  // Sans permission audio, Chromium retourne des entrees generiques avec
  // deviceId='' — ce n'est PAS une liste vide : c'est une detection degradee.
  const real = window.SFUtils.realDevices(list);
  if (!real.length) {
    audio.devicesDegraded = true;
    warnPermOnce('enumerateDevices sans deviceId (permission audio absente)');
    return false;
  }
  audio.devices.out = real.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
  audio.devices.inp = real.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  return true;
}

function resolveDevices() {
  // Enumeration degradee (permission refusee, transient) : ne PAS effacer les
  // ids/labels memorises — une detection incomplete ne doit jamais ecraser
  // une configuration audio valide.
  if (audio.devicesDegraded) return;
  const s = cfg.settings;
  const pick = (idKey, lblKey, list, regex, fallbackId) => {
    let d = s[idKey] && list.find((x) => x.deviceId === s[idKey]);
    if (!d && s[lblKey]) d = list.find((x) => x.label === s[lblKey]);
    if (!d && regex) d = list.find((x) => regex.test(x.label));
    if (!d && fallbackId) d = list.find((x) => x.deviceId === fallbackId);
    if (d) { s[idKey] = d.deviceId; s[lblKey] = d.label; } else { s[idKey] = ''; s[lblKey] = ''; }
  };
  pick('cableId', 'cableLabel', audio.devices.out, /CABLE Input/i, null);
  pick('monId', 'monLabel', audio.devices.out, null, 'default');
  pick('micId', 'micLabel', audio.devices.inp, null, 'default');
}

// ---------- VB-CABLE : ecran d'accueil + bandeau ----------
// VB-CABLE n'est ni embarque ni installe par SoundFart (licence VB-Audio) :
// l'utilisateur l'installe depuis vb-audio.com/Cable. On detecte les
// peripheriques « CABLE Input/Output » via enumerateDevices/devicechange.
// devicesDegraded : enumeration incomplete (permission refusee/transitoire)
// — on NE affiche PAS l'ecran d'install VB-CABLE a tort : on pretend present
// le temps que la prochaine enumeration reussie tranche.
const cablePresent = () => audio.devicesDegraded || audio.devices.out.some((d) => /cable/i.test(d.label));
let cableScreenEl = null;

function cableScreen() {
  if (cableScreenEl) return cableScreenEl;
  const verify = el('button', { class: 'ghost', text: 'J\'ai installé, vérifier', onclick: async (e) => {
    e.target.disabled = true;
    try {
      await refreshDevices(false); resolveDevices(); updateCableUi();
      await applyAudio().catch((e2) => logErr('applyAudio', e2));
    } finally {
      e.target.disabled = false;
    }
    if (cablePresent()) {
      window.sf.audioAutoSetup({ enabled: cfg.settings.autoSwitchMic, cableLabel: cfg.settings.cableLabel }).then((r) => {
        if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
        else if (r && !r.ok) toast('Bascule micro auto impossible : ' + r.err, 'warn');
      }).catch((e) => logErr('audioAutoSetup', e));
    } else {
      toast('Toujours absent — si tu viens d\'installer VB-CABLE, redémarre Windows : les périphériques n\'apparaissent qu\'après.', 'warn');
    }
  } });
  cableScreenEl = el('div', { class: 'cable-screen', id: 'cable-screen' },
    el('div', { class: 'cable-card' },
      el('h2', { text: 'VB-CABLE requis' }),
      el('p', { text: 'SoundFart envoie le son dans un câble audio virtuel : c\'est lui qui permet à Discord de recevoir tes sons comme s\'ils venaient de ton micro. Sans lui, la diffusion vers Discord est désactivée.' }),
      el('button', { class: 'primary big', text: 'Télécharger VB-CABLE (page officielle)', onclick: () => window.sf.cableDownload() }),
      el('div', { class: 'hint center', text: 'vb-audio.com/Cable' }),
      el('ol', { class: 'cable-steps' },
        el('li', { text: 'Dézippe l\'archive téléchargée.' }),
        el('li', { text: 'Clic droit sur VBCABLE_Setup_x64.exe → « Exécuter en tant qu\'administrateur ».' }),
        el('li', { text: 'Clique « Install », puis redémarre Windows.' })),
      el('div', { class: 'row center' }, verify,
        el('button', { class: 'ghost', text: 'Plus tard', onclick: () => { cableScreenEl.remove(); cableScreenEl = null; } })),
      el('p', { class: 'hint', text: 'VB-CABLE est gratuit — si tu l\'utilises, pense à soutenir VB-Audio sur sa page.' })));
  document.body.append(cableScreenEl);
  window.sf.uiLog && window.sf.uiLog('ecran VB-CABLE requis affiche');
  return cableScreenEl;
}

function updateCableUi() {
  const present = cablePresent();
  const banner = $('#cable-banner');
  if (banner) banner.hidden = present;
  if (present && cableScreenEl) { cableScreenEl.remove(); cableScreenEl = null; }
  return present;
}

function showCableScreen() {
  if (!cablePresent()) cableScreen();
  updateCableUi();
}

function setPlaying(id, delta) {
  const n = (playingCount.get(id) || 0) + delta;
  if (n <= 0) { playingCount.delete(id); playingNames.delete(id); } else playingCount.set(id, n);
  const c = cardEls.get(id);
  if (c) c.classList.toggle('playing', n > 0);
  const names = [...playingCount.keys()].map((i) => playingNames.get(i) || cfg.sounds.find((x) => x.id === i)?.name).filter(Boolean);
  $('#nowplaying').textContent = names.length ? '▶ ' + names.join(' + ') : 'Prêt';
}

function endVoice(v) {
  if (v.killTimer) { clearTimeout(v.killTimer); v.killTimer = null; }
  if (v.stopFallback) { clearTimeout(v.stopFallback); v.stopFallback = null; }
  if (voices.delete(v)) setPlaying(v.soundId, -1);
}

function play(sound, opts = {}) {
  // Plafond de voix simultanees : chaque voix = 2 sources + gains + timers
  // par sortie — des clics en rafale/allers-retours creeaient des centaines
  // de nodes audio sans limite.
  if (voices.size >= 32) { toast('Trop de lectures simultanées.', 'warn'); return Promise.resolve(null); }
  const gen = playGen; // si stopAll/teardownAudio passe pendant le await getBuffer, on abandonne
  const active = (opts.monitorOnly ? [audio.mon] : [audio.cable, audio.mon]).filter(Boolean);
  if (!active.length) {
    toast(opts.monitorOnly ? 'Choisis une « écoute locale » dans les réglages pour pré-écouter sans que tes potes entendent.'
      : 'Aucune sortie audio active : ouvre les réglages audio.', 'warn');
    return Promise.resolve(null);
  }
  let fileErr = false;
  // Dedup par deviceId : si cable et mon pointent sur le meme peripherique,
  // jouer deux fois sur le meme device = +6 dB et echos possibles.
  const seenDev = new Set();
  const uniq = active.filter((o) => !seenDev.has(o.deviceId || o.ctx.destination) && seenDev.add(o.deviceId || o.ctx.destination));
  return getBuffer(sound.path)
    .catch((e) => { fileErr = !(e && e.noFileErr); throw e; })
    .then((buf) => {
    if (gen !== playGen) return null; // lecture percutee par un stop : ne pas demarrer la voix
    // Supprime/relocalise pendant le decode async : ne pas jouer un fantome
    // (ancien fichier) ni un son qui n'existe plus.
    if (!opts.preview && !cfg.sounds.some((x) => x.id === sound.id && x.path === sound.path)) return null;
    const vol = ((opts.volume ?? sound.volume) / 100) * (sound.norm ?? 1);
    const offset = Math.min(Math.max(0, opts.trimStart ?? sound.trimStart ?? 0), Math.max(0, buf.duration - 0.05));
    const endRaw = opts.trimEnd !== undefined ? opts.trimEnd : sound.trimEnd;
    const endEff = endRaw ?? buf.duration;
    if (endEff <= offset + 0.01) return null; // trim vide/invalide : ne rien jouer
    const dur = Math.max(0.05, Math.min(endEff, buf.duration) - offset);
    let fi = (opts.fadeIn ?? sound.fadeIn ?? 0) / 1000;
    let fo = (opts.fadeOut ?? sound.fadeOut ?? 0) / 1000;
    if (fi + fo > dur) { const k = dur / (fi + fo); fi *= k; fo *= k; }
    const voice = { soundId: sound.id, nodes: [], preview: !!opts.preview };
    let remaining = uniq.length;
    voices.add(voice); // AVANT la boucle : une voix demarree partiellement reste stoppable
    try {
    for (const out of uniq) {
      if (out.ctx.state !== 'running') out.ctx.resume().catch(() => {});
      const src = out.ctx.createBufferSource();
      src.buffer = buf;
      const g = out.ctx.createGain();
      const t0 = out.ctx.currentTime;
      if (fi > 0) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + fi); } else g.gain.setValueAtTime(vol, t0);
      if (fo > 0) { g.gain.setValueAtTime(vol, t0 + dur - fo); g.gain.linearRampToValueAtTime(0, t0 + dur); }
      src.connect(g);
      g.connect(out.bus);
      src.onended = () => { try { g.disconnect(); } catch {} if (--remaining === 0) endVoice(voice); };
      voice.nodes.push({ src, g, out });
      if (!voice.out) { voice.out = out; voice.t0 = t0; }
      src.start(t0, offset, dur);
    }
    } catch (e) {
      // Demarrage partiel : on stoppe les sources deja lancees pour ne pas
      // laisser des voix non trackees jouer hors de voices/STOP.
      for (const n of voice.nodes) { try { n.src.stop(); } catch {} try { n.g.disconnect(); } catch {} }
      voices.delete(voice);
      throw e;
    }
    // Watchdog voix : si le AudioContext est suspendu (veille, session coupee)
    // sans evenement exploitable, currentTime ne avance plus et onended ne
    // tire jamais -> la voix resterait zombie (carte playing figee). On force
    // l'arret apres duree + marge.
    voice.killTimer = setTimeout(() => {
      if (!voices.has(voice)) return;
      for (const n of voice.nodes) { try { n.src.stop(); } catch {} try { n.g.disconnect(); } catch {} }
      endVoice(voice);
      toast('Lecture interrompue : la sortie audio était suspendue.', 'warn');
    }, (dur + 15) * 1000);
    playingNames.set(sound.id, sound.name || 'son');
    setPlaying(sound.id, +1);
    if (missing.delete(sound.id)) renderGrid();
    if (!opts.preview) { sound.plays = (sound.plays || 0) + 1; save(); }
    if (opts.onProgress) {
      const step = () => {
        if (!voices.has(voice)) { opts.onProgress(null); return; }
        const elapsed = voice.out.ctx.currentTime - voice.t0;
        opts.onProgress(Math.min(1, Math.max(0, elapsed / dur)), offset + elapsed, dur, offset);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    return voice;
  }).catch((e) => {
    // Seules les erreurs de lecture du FICHIER marquent le son « introuvable » ;
    // une erreur Web Audio transitoire ne doit pas afficher un faux badge missing.
    if (fileErr) {
      toast(`Impossible de lire « ${sound.name} » : fichier introuvable ou illisible.`, 'warn');
      missing.add(sound.id);
    } else {
      toast(`Erreur de lecture de « ${sound.name} » : ${e && e.message || 'audio indisponible'}`, 'warn');
    }
    renderGrid();
    return null;
  });
}

function stopVoice(v, instant) {
  for (const { src, g, out } of v.nodes) {
    try {
      const t = out.ctx.currentTime;
      if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(t); else g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.015);
      src.stop(t + (instant ? 0 : 0.08));
    } catch {}
  }
  if (instant) { endVoice(v); return; }
  // Repli : si onended ne se declenche jamais (contexte suspendu, noeud
  // fige), la voix resterait zombie jusqu'au killTimer (duree+15 s).
  if (v.stopFallback) clearTimeout(v.stopFallback);
  v.stopFallback = setTimeout(() => { v.stopFallback = null; if (voices.has(v)) endVoice(v); }, 1500);
}

function stopAll(instant) {
  playGen++; // invalide les play() dont getBuffer est encore en vol
  for (const v of [...voices]) stopVoice(v, instant);
}

function updateRoutes() {
  const s = cfg.settings;
  const parts = [];
  parts.push('Discord : ' + (audio.cable ? s.cableLabel : 'non configuré'));
  parts.push('Casque : ' + (audio.mon ? s.monLabel : 'aucun'));
  if (audio.micStream) parts.push('Micro mixé');
  $('#routes').textContent = parts.join('  ·  ');
  $('#routes').title = parts.join('\n');
}

// ================================================================ raccourcis clavier
const fmtAccel = (a) => (a || '').replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');

function buildAccel(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k === '+') k = 'Plus';
  else if (k === 'ArrowUp') k = 'Up';
  else if (k === 'ArrowDown') k = 'Down';
  else if (k === 'ArrowLeft') k = 'Left';
  else if (k === 'ArrowRight') k = 'Right';
  else if (k.length === 1) k = k.toUpperCase();
  else if (!/^(F\d{1,2}|Enter|Escape|Backspace|Delete|Tab|Space|Plus)$/.test(k)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  if (!parts.length && !/^F\d/.test(k)) return null; // exiger un modifieur ou une touche F
  parts.push(k);
  return parts.join('+');
}

// Normalise les alias d'accelerateurs : 'CommandOrControl+Alt+S' (defaut
// stopShortcut) et 'Ctrl+Alt+S' (buildAccel) designent le meme raccourci
// Windows — sans ca, findShortcutOwner ne detectait pas le conflit et le
// son s'enregistrait avant le STOP (ou l'inverse).
// Accesseurs reserves : menu applicatif (Ctrl+F/O, F11/F12, Ctrl+Shift+I)
// + Alt+F4 (fermeture Windows geree par l'OS — un globalShortcut dessus
// bloquerait la fermeture normale). Source unique pour normalizeCfg
// (import) et findShortcutOwner (capture a chaud) — les deux divergent
// sinon (revue 0682).
const RESERVED_SC = new Set(['ctrl+f', 'ctrl+o', 'f12', 'f11', 'ctrl+shift+i', 'alt+f4']);

// Canonicalise l'accelerateur : 'Alt+Ctrl+S' et 'Ctrl+Alt+S' designent le
// meme raccourci Windows — sans tri des modifieurs ils passaient la dedupe
// mais Electron n'en enregistrait qu'un (SF-RELAudit : doublon possible).
const ACC_MODS = ['ctrl', 'alt', 'shift', 'super', 'meta'];
function normAccel(a) {
  const parts = (a || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean)
    .map((p) => p.replace(/commandorcontrol|cmdorctrl|control/g, 'ctrl'));
  const mods = parts.filter((p) => ACC_MODS.includes(p)).sort((x, y) => ACC_MODS.indexOf(x) - ACC_MODS.indexOf(y));
  return [...mods, ...parts.filter((p) => !ACC_MODS.includes(p))].join('+');
}

function findShortcutOwner(acc, excludeSoundId) {
  const a = normAccel(acc);
  if (!a) return null;
  if (normAccel(cfg.settings.stopShortcut) === a) return 'le raccourci STOP';
  // Accelerateurs du menu applicatif (fenetre focus) : un raccourci de son
  // identique produirait une double action (jouer + ouvrir la dialog).
  if (RESERVED_SC.has(a)) return 'un raccourci réservé du système';
  const s = cfg.sounds.find((x) => x.id !== excludeSoundId && normAccel(x.shortcut) === a);
  return s ? '« ' + s.name + ' »' : null;
}

async function applyShortcuts() {
  const entries = [];
  // __stop__ EN PREMIER : shortcuts:apply ne retient que les 200 premiers
  // -- un STOP ajoute en dernier n'etait jamais enregistre au-dela de
  // 200 raccourcis de sons (et 'failed' affichait un '…' illisible).
  if (cfg.settings.stopShortcut) entries.push({ key: '__stop__', accel: cfg.settings.stopShortcut });
  for (const s of cfg.sounds) if (s.shortcut) entries.push({ key: s.id, accel: s.shortcut });
  try {
    const failed = await window.sf.applyShortcuts(entries);
    if (failed && failed.length) toast('Raccourcis refusés par Windows : ' + failed.map(fmtAccel).join(', '), 'warn');
  } catch (e) {
    logErr('shortcuts', e);
  }
}

function logErr(tag, e) { console.error(tag, e); }
// Helper uiLog : les appels nus `uiLog(...)` leveraient ReferenceError
// (seul window.sf.uiLog existe via preload) — fichiers >3 min etats
// 'interrupted'/'closed' etaient casses par ca.
const uiLog = (m) => { try { window.sf.uiLog(m); } catch {} };

// ================================================================ utilitaires
// fmtTime/parseTs : fonctions pures partagees, testees via node:test (lib/audio-utils.js)
const { fmtTime, parseTs } = window.SFUtils;

// ================================================================ donnees : sons & categories
// Plafond unique pour tous les ajouts runtime (enregistrement, YouTube,
// seed) : au-dela file:check refuse le batch et config:save depasse 5 Mo.
function pushSound(s) {
  if (cfg.sounds.length >= 5000) { toast('Limite de 5000 sons atteinte.', 'warn'); return false; }
  cfg.sounds.push(s); return true;
}

async function addPaths(rawPaths) {
  const paths = await window.sf.expandPaths(rawPaths);
  if (!paths.length) { toast('Aucun fichier audio reconnu (mp3, wav, ogg, flac, m4a, aac, opus).', 'warn'); return; }
  const known = new Set(cfg.sounds.map((s) => s.path.toLowerCase()));
  const catId = catById(cfg.ui.cat) ? cfg.ui.cat : null;
  const now = Date.now();
  let n = 0;
  // Plafond aligne sur normalizeCfg (5000) : au-dela file:check refuse le
  // batch et config:save depasse 5 Mo -> sauvegardes silencieusement KO.
  const room = Math.max(0, 5000 - cfg.sounds.length);
  let truncated = false;
  for (const p of paths) {
    if (n >= room) { truncated = true; break; }
    if (known.has(p.toLowerCase())) continue;
    known.add(p.toLowerCase());
    const base = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    cfg.sounds.push({
      id: uid(), name: base, path: p, categoryId: catId, volume: 100, addedAt: now + n, plays: 0,
      favorite: false, norm: 1, shortcut: null, trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
    });
    n++;
  }
  if (n) { save(); renderAll(); }
  toast(n ? `${n} son(s) ajouté(s).${truncated ? ' (limite de 5000 sons atteinte)' : ''}` : (truncated ? 'Limite de 5000 sons atteinte — retirez des sons pour en ajouter.' : 'Ces sons sont déjà dans la liste.'));
}

async function removeSound(s) {
  if (!(await confirmBox('Retirer ce son ?', `« ${s.name} » sera retiré de SoundFart. Le fichier audio d'origine n'est pas supprimé.`, 'Retirer'))) return;
  cfg.sounds = cfg.sounds.filter((x) => x.id !== s.id);
  // Arreter les voix du son retire : sinon il continuait de jouer apres la
  // suppression de sa carte (jusqu'a la fin du fichier).
  for (const v of [...voices]) if (v.soundId === s.id) stopVoice(v, true);
  // Libere le buffer decode du son supprime (sinon jusqu'a 256 Mo d'orphelins).
  cacheDelete(s.path); // libere le buffer decode du son supprime
  longWarned.delete(s.path);
  save(); renderAll();
  applyShortcuts(); // desenregistre le raccourci global du son supprime
}

function moveSoundTo(id, catId) {
  const s = cfg.sounds.find((x) => x.id === id);
  if (!s) return;
  s.categoryId = catId;
  save(); renderAll();
  toast(`« ${s.name} » déplacé.`);
}

async function newCategory() {
  const name = await askText('Nouvelle catégorie', 'Nom de la catégorie', '', 'Créer');
  if (!name) return;
  const c = { id: uid(), name, color: PALETTE[cfg.categories.length % PALETTE.length] };
  cfg.categories.push(c);
  cfg.ui.cat = c.id;
  save(); renderAll();
}

// Collator partage : le recreer a chaque tri/groupe coute inutilement
// (visibleSounds et sortedCategories sont appelees a chaque rendu).
const COL_LATIN = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function sortedCategories() {
  const col = COL_LATIN;
  const arr = [...cfg.categories];
  if (cfg.settings.catSort === 'count-desc') {
    // comptages precalcules : evite de refiltrer cfg.sounds a chaque comparaison (O(n log n) au lieu de O(n^2 log n))
    const counts = new Map();
    for (const s of cfg.sounds) if (s.categoryId) counts.set(s.categoryId, (counts.get(s.categoryId) || 0) + 1);
    return arr.sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || col.compare(a.name, b.name));
  }
  switch (cfg.settings.catSort) {
    case 'name-asc': return arr.sort((a, b) => col.compare(a.name, b.name));
    case 'name-desc': return arr.sort((a, b) => col.compare(b.name, a.name));
    default: return arr;
  }
}

function moveCategory(c, dir) {
  const i = cfg.categories.indexOf(c);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cfg.categories.length) return;
  [cfg.categories[i], cfg.categories[j]] = [cfg.categories[j], cfg.categories[i]];
  save(); renderAll(); // renderGrid ordonne les groupes via sortedCategories : renderSidebar seul laissait la grille perimee
}

async function renameCategory(c) {
  const name = await askText('Renommer la catégorie', 'Nouveau nom', c.name, 'Renommer');
  if (!name) return;
  c.name = name;
  save(); renderAll();
}

function colorCategory(c) {
  let closeFn = () => {};
  const holder = el('div', { class: 'row' }, PALETTE.map((col) => {
    const b = el('button', { class: 'icon', text: c.color === col ? '●' : '○', title: col });
    b.style.color = col;
    b.style.fontSize = '20px';
    b.addEventListener('click', () => { c.color = col; save(); renderAll(); closeFn(); });
    return b;
  }));
  closeFn = modal('Couleur de « ' + c.name + ' »', [holder], [{ label: 'Fermer', onclick: (cl) => cl() }]);
}

async function deleteCategory(c) {
  const n = cfg.sounds.filter((s) => s.categoryId === c.id).length;
  const msg = n ? `Les ${n} son(s) de « ${c.name} » ne seront pas supprimés : ils passeront dans « Sans catégorie ».` : `Supprimer la catégorie « ${c.name} » ?`;
  if (!(await confirmBox('Supprimer la catégorie ?', msg, 'Supprimer'))) return;
  cfg.sounds.forEach((s) => { if (s.categoryId === c.id) s.categoryId = null; });
  cfg.categories = cfg.categories.filter((x) => x.id !== c.id);
  if (cfg.ui.cat === c.id) cfg.ui.cat = 'all';
  save(); renderAll();
}

// ================================================================ rendu
function visibleSounds() {
  const q = $('#search').value.trim().toLowerCase();
  const view = cfg.ui.cat;
  const col = COL_LATIN;
  const sorts = {
    'name-asc': (a, b) => col.compare(a.name, b.name),
    'name-desc': (a, b) => col.compare(b.name, a.name),
    'added-desc': (a, b) => b.addedAt - a.addedAt,
    'added-asc': (a, b) => a.addedAt - b.addedAt,
    'plays-desc': (a, b) => (b.plays || 0) - (a.plays || 0) || col.compare(a.name, b.name),
    'volume-desc': (a, b) => b.volume - a.volume || col.compare(a.name, b.name),
  };
  return cfg.sounds
    .filter((s) => view === 'all' ? true : view === 'fav' ? !!s.favorite : view === 'none' ? !soundHasCat(s) : s.categoryId === view)
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort(sorts[cfg.settings.sort] || sorts['added-desc']);
}

function renderSidebar() {
  const nav = $('#cats');
  nav.replaceChildren();
  const item = (id, label, count, cat) => {
    const row = el('div', {
      class: 'cat' + (cfg.ui.cat === id ? ' active' : ''),
      onclick: () => { cfg.ui.cat = id; save(); renderAll(); },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('application/x-soundfart') && id !== 'all' && id !== 'fav') { e.preventDefault(); row.classList.add('dragover'); } },
      ondragleave: () => row.classList.remove('dragover'),
      ondrop: (e) => {
        row.classList.remove('dragover');
        const sid = e.dataTransfer.getData('application/x-soundfart');
        if (sid && id !== 'all' && id !== 'fav') { e.preventDefault(); moveSoundTo(sid, id === 'none' ? null : id); }
      },
    });
    const dot = el('span', { class: 'dot' });
    if (cat) dot.style.setProperty('--c', cat.color);
    row.append(dot, el('span', { class: 'lbl', text: label }), el('span', { class: 'cnt', text: String(count) }));
    if (cat) {
      const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
      const manual = cfg.settings.catSort === 'manual';
      row.append(el('span', { class: 'tools' },
        manual ? el('button', { class: 'icon', title: 'Monter', text: '▲', onclick: stop(() => moveCategory(cat, -1)) }) : null,
        manual ? el('button', { class: 'icon', title: 'Descendre', text: '▼', onclick: stop(() => moveCategory(cat, +1)) }) : null,
        el('button', { class: 'icon', title: 'Couleur', text: '🎨', onclick: stop(() => colorCategory(cat)) }),
        el('button', { class: 'icon', title: 'Renommer', text: '✎', onclick: stop(() => renameCategory(cat)) }),
        el('button', { class: 'icon', title: 'Supprimer', text: '🗑', onclick: stop(() => deleteCategory(cat)) })));
    }
    nav.append(row);
  };
  // Comptages en une seule passe : l'ancienne version refiltrait
  // cfg.sounds par categorie -> O(categories x sons) a chaque rendu.
  let favN = 0, noneN = 0;
  const catCounts = new Map();
  for (const s of cfg.sounds) {
    if (s.favorite) favN++;
    if (!soundHasCat(s)) noneN++;
    if (s.categoryId) catCounts.set(s.categoryId, (catCounts.get(s.categoryId) || 0) + 1);
  }
  item('all', 'Tous les sons', cfg.sounds.length, null);
  item('fav', '★ Favoris', favN, null);
  item('none', 'Sans catégorie', noneN, null);
  for (const c of sortedCategories()) item(c.id, c.name, catCounts.get(c.id) || 0, c);
}

function renderGrid() {
  $('#ctxmenu').classList.remove('on'); // le menu contextuel ne survit pas a un re-rendu
  const grid = $('#grid');
  grid.replaceChildren();
  cardEls.clear();
  const list = visibleSounds();
  $('#viewTitle').textContent = cfg.ui.cat === 'all' ? 'Tous les sons' : cfg.ui.cat === 'fav' ? '★ Favoris' : cfg.ui.cat === 'none' ? 'Sans catégorie' : (catById(cfg.ui.cat)?.name || 'Tous les sons');
  $('#viewCount').textContent = list.length + ' son' + (list.length > 1 ? 's' : '');
  if (!list.length) {
    grid.append(el('div', { class: 'empty' },
      cfg.sounds.length ? 'Aucun son à afficher ici.' : 'Glisse des fichiers audio (ou un dossier) dans la fenêtre,',
      el('br'),
      cfg.sounds.length ? '' : 'ou clique sur « Ajouter des sons ».'));
    return;
  }
  const appendCard = (s) => {
    const cat = soundHasCat(s) ? catById(s.categoryId) : null;
    const th = thumbFor(s);
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const card = el('div', {
      class: 'card' + (missing.has(s.id) ? ' missing' : '') + (playingCount.has(s.id) ? ' playing' : '') + (s.favorite ? ' fav' : ''),
      draggable: 'true',
      title: s.path,
      onclick: () => play(s),
      oncontextmenu: (e) => { e.preventDefault(); showCtx(e, s); },
      ondragstart: (e) => { e.dataTransfer.setData('application/x-soundfart', s.id); e.dataTransfer.effectAllowed = 'move'; },
    },
      el('div', { class: 'thumb', style: { '--h': th.hue }, title: s.name }, el('span', { text: th.emoji })),
      el('button', {
        class: 'favstar' + (s.favorite ? ' on' : ''),
        title: s.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
        text: s.favorite ? '★' : '☆',
        onclick: stop(() => { s.favorite = !s.favorite; save(); renderAll(); }),
      }),
      el('div', { class: 'card-actions' },
        el('button', { class: 'icon', title: 'Modifier', text: '✎', onclick: stop(() => editSound(s)) }),
        el('button', { class: 'icon', title: 'Retirer de la liste', text: '✕', onclick: stop(() => removeSound(s)) })),
      el('div', { class: 'name', text: s.name }),
      el('div', { class: 'meta' },
        missing.has(s.id) ? el('button', { class: 'badge warn link', title: 'Cliquer pour retrouver le fichier', text: 'Fichier introuvable — retrouver…', onclick: stop(() => relocateSound(s)) }) : null,
        cat ? el('span', { class: 'chip', text: cat.name }) : null,
        s.shortcut ? el('span', { class: 'sc', title: 'Raccourci : ' + fmtAccel(s.shortcut), text: '⌨ ' + fmtAccel(s.shortcut) }) : null,
        s.volume !== 100 ? el('span', { class: 'badge', text: '🔊 ' + s.volume + '%' }) : null,
        (s.norm ?? 1) !== 1 ? el('span', { class: 'badge', text: '⚖ ×' + s.norm }) : null,
        (s.trimStart > 0 || s.trimEnd != null) ? el('span', { class: 'badge', text: '✂ coupé' }) : null),
      el('div', { class: 'eq' }, el('i'), el('i'), el('i'), el('i')));
    card.style.setProperty('--c', cat ? cat.color : PALETTE[0]);
    cardEls.set(s.id, card);
    grid.append(card);
  };

  // regroupement par categorie (vues « Tous les sons » et « Favoris »)
  if (cfg.settings.groupByCat && (cfg.ui.cat === 'all' || cfg.ui.cat === 'fav')) {
    const groups = new Map();
    for (const s of list) {
      const k = soundHasCat(s) ? s.categoryId : '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const ordered = [];
    for (const c of sortedCategories()) if (groups.has(c.id)) ordered.push([c, groups.get(c.id)]);
    if (groups.has('')) ordered.push([null, groups.get('')]);
    for (const [cat, items] of ordered) {
      grid.append(el('div', { class: 'group-head' },
        cat ? el('span', { class: 'dot', style: { '--c': cat.color } }) : null,
        el('span', { class: 'gname', text: cat ? cat.name : 'Sans catégorie' }),
        el('span', { class: 'cnt', text: String(items.length) })));
      items.forEach(appendCard);
    }
  } else {
    list.forEach(appendCard);
  }
}

function pushMenuState() {
  try {
    window.sf.menuState({
      cat: cfg.ui.cat,
      groupByCat: !!cfg.settings.groupByCat,
      stopShortcut: cfg.settings.stopShortcut || '',
      categories: sortedCategories().map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (e) { logErr('menuState', e); }
}

function renderAll() { renderSidebar(); renderGrid(); pushMenuState(); }

// Resynchronise les controles du haut apres un import de config : leurs
// options sont creees une seule fois dans init() — sans ca, tri/groupe/
// volume master affichent l'ancienne config alors que cfg est deja remplace.
function syncTopbarControls() {
  const sortSel = $('#sort'); if (sortSel) sortSel.value = cfg.settings.sort;
  const catSortSel = $('#catSort'); if (catSortSel) catSortSel.value = cfg.settings.catSort;
  const groupCat = $('#groupCat'); if (groupCat) groupCat.checked = !!cfg.settings.groupByCat;
  const master = $('#master');
  if (master) { master.value = cfg.settings.master; const mv = $('#masterVal'); if (mv) mv.textContent = cfg.settings.master + '%'; }
}

function showCtx(e, s) {
  const item = (label, fn, cls) => el('button', { class: cls || '', text: label, onclick: fn });
  const m = $('#ctxmenu');
  m.replaceChildren(
    item('Modifier (nom, volume, catégorie, raccourci)…', () => editSound(s)),
    item(s.favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris', () => { s.favorite = !s.favorite; save(); renderAll(); }),
    item('Ouvrir l\'emplacement du fichier', () => window.sf.reveal(s.path).catch((e) => logErr('reveal', e))),
    item('Retrouver le fichier…', () => relocateSound(s)),
    item('Retirer de la liste', () => removeSound(s), 'danger'));
  m.style.left = Math.min(e.clientX, innerWidth - 240) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - 140) + 'px';
  m.classList.add('on');
}

async function relocateSound(s) {
  let paths;
  try { paths = await window.sf.pickFiles(); } catch (e) { logErr('pickFiles', e); return; }
  const p = Array.isArray(paths) ? paths[0] : null;
  if (!p) return;
  // Le filtre du dialogue est indicatif : valider l'extension ici sinon
  // file:check dirait « present » mais file:read refuserait au play.
  if (!window.SFUtils.AUDIO_EXT.includes(p.slice(p.lastIndexOf('.')).toLowerCase())) {
    toast("Ce fichier n'est pas un format audio supporté.", 'warn'); return;
  }
  // Un chemin deja pris par un autre son serait deduplique au prochain
  // chargement -> perte silencieuse d'un des deux sons.
  if (cfg.sounds.some((x) => x !== s && x.path.toLowerCase() === p.toLowerCase())) {
    toast('Ce chemin est déjà utilisé par un autre son.', 'warn'); return;
  }
  const oldPath = s.path;
  // Arreter les voix qui jouent l'ancien chemin : sinon le son continue
  // de jouer un fichier different de celui affiche (comme removeSound).
  for (const v of [...voices]) if (v.soundId === s.id) stopVoice(v, true);
  s.path = p;
  cacheDelete(oldPath); // l'ancien buffer devient orphelin sinon
  missing.delete(s.id);
  save(); renderAll();
  toast('Fichier retrouvé : ' + p);
}

let checkSeq = 0; // jeton de generation : des scans concurrents (focus,
// import, ajout) ne doivent pas ecrire un 'missing' perime dans le desordre.
async function checkMissing() {
  const seq = ++checkSeq;
  let miss;
  try { miss = new Set(await window.sf.checkFiles(cfg.sounds.map((s) => s.path))); }
  catch (e) { logErr('checkMissing', e); return; } // erreur remontee, badges inchanges
  if (seq !== checkSeq) return; // un scan plus recent a ete lance entre-temps
  const next = new Set(cfg.sounds.filter((s) => miss.has(s.path)).map((s) => s.id));
  const changed = next.size !== missing.size || [...next].some((i) => !missing.has(i));
  missing = next;
  if (changed) renderGrid();
}

// ================================================================ demarrage
async function init() {
  // Telemetrie memoire periodique : performance.memory (Chromium) permet de
  // correlER un crash renderer (-1/143) avec une saturation du heap —
  // indice cle pour trancher OOM vs crash de la couche audio Windows.
  setInterval(() => {
    try {
      const m = performance.memory;
      if (m) uiLog('heap=' + Math.round(m.usedJSHeapSize / 1048576) + '/' + Math.round(m.jsHeapSizeLimit / 1048576) + ' Mo');
    } catch {}
  }, 60000);
  window.sf.getVersion().then((v) => { const e = $('#appVersion'); if (e) e.textContent = 'v' + v; }).catch(() => {});
  const saved = await window.sf.loadConfig();
  cfg = normalizeCfg(saved);

  // barre du haut & bas
  const sortSel = $('#sort');
  SORTS.forEach(([v, l]) => sortSel.append(el('option', { value: v, text: l, selected: v === cfg.settings.sort })));
  const catSortSel = $('#catSort');
  CAT_SORTS.forEach(([v, l]) => catSortSel.append(el('option', { value: v, text: l, selected: v === cfg.settings.catSort })));
  catSortSel.addEventListener('change', () => { cfg.settings.catSort = catSortSel.value; save(); renderAll(); });
  sortSel.addEventListener('change', () => { cfg.settings.sort = sortSel.value; save(); renderGrid(); });
  const groupCat = $('#groupCat');
  groupCat.checked = !!cfg.settings.groupByCat;
  groupCat.addEventListener('change', () => { cfg.settings.groupByCat = groupCat.checked; save(); renderAll(); });
  // Debounce : chaque frappe reconstruisait tout le grid (filtre + tri +
  // DOM) -> jank clavier sur une grosse bibliotheque.
  let searchT = null;
  $('#search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderGrid, 120); });
  $('#addBtn').addEventListener('click', async () => { try { const p = await window.sf.pickFiles(); if (p.length) await addPaths(p); } catch (e) { logErr('pickFiles', e); } });
  $('#ytBtn').addEventListener('click', youtubeModal);
  $('#recBtn').addEventListener('click', () => recorderModal().catch((e) => toast('Enregistreur : ' + e.message, 'warn')));
  $('#addCat').addEventListener('click', newCategory);
  $('#openSettings').addEventListener('click', async () => { await refreshDevices(false); settingsModal(); });
  $('#stopBtn').addEventListener('click', () => stopAll(false));

  // menu application (F11)
  window.sf.onMenuAction(async (a) => {
    try {
      if (a === 'add') { const p = await window.sf.pickFiles(); if (p.length) addPaths(p).catch((e) => logErr('addPaths', e)); }
      else if (a === 'youtube') youtubeModal();
      else if (a === 'recorder') await recorderModal();
      else if (a === 'export') exportConfig();
      else if (a === 'import') importConfig();
      else if (a === 'settings') { await refreshDevices(false); settingsModal(); }
      else if (a === 'stop') stopAll(false);
      else if (a === 'search') { const i = $('#search'); i.focus(); i.select(); }
      else if (a === 'group') { cfg.settings.groupByCat = !cfg.settings.groupByCat; save(); const gc = $('#groupCat'); if (gc) gc.checked = !!cfg.settings.groupByCat; renderAll(); }
      else if (a.startsWith('view:')) { const v = a.slice(5); cfg.ui.cat = ['all', 'fav', 'none'].includes(v) || cfg.categories.some((c) => c.id === v) ? v : 'all'; save(); renderAll(); }
      else if (a === 'about') {
        const v = await window.sf.getVersion().catch(() => '?');
        const year = new Date().getFullYear();
        modal('SoundFart', [
          el('div', { class: 'about-hero' }, [
            el('div', { class: 'about-logo', text: '🎷' }),
            el('div', {}, [
              el('div', { class: 'about-name', text: 'SoundFart' }),
              el('div', { class: 'about-ver', text: 'Version ' + v }),
            ]),
          ]),
          el('p', { class: 'about-desc', text: 'Soundboard pour Discord — joue tes sons dans tes appels vocaux via VB-CABLE.' }),
          el('p', { class: 'about-credit', text: 'Développé par Benoit Prudent' }),
          el('p', { class: 'about-copy', text: '© ' + year + ' Benoit Prudent — Tous droits réservés' }),
          el('p', { class: 'hint', text: 'Propulsé par Electron · VB-CABLE par VB-Audio · yt-dlp & ffmpeg (outils libres)' }),
        ], [{ label: 'Fermer', onclick: (c) => c() }]);
      }
    } catch (e) { toast('Menu : ' + e.message, 'warn'); }
  });
  const master = $('#master');
  master.value = cfg.settings.master;
  $('#masterVal').textContent = cfg.settings.master + '%';
  master.addEventListener('input', () => {
    cfg.settings.master = +master.value;
    $('#masterVal').textContent = master.value + '%';
    for (const o of [audio.cable, audio.mon]) if (o) o.bus.gain.setTargetAtTime(master.value / 100, o.ctx.currentTime, 0.01);
    save();
  });
  document.addEventListener('click', () => $('#ctxmenu').classList.remove('on'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#ctxmenu').classList.remove('on'); });
  // Debounce : chaque focus relancait un scan complet de tous les chemins
  // (jusqu'a 5000, par lots de 200 sequentiels) — un partage reseau
  // injoignable gelait les badges sans timeout.
  let checkTimer = null;
  window.addEventListener('focus', () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => checkMissing().catch((e) => logErr('checkMissing', e)), 400);
  });
  $('#cableBannerBtn').addEventListener('click', () => showCableScreen());
  // devicechange peut spammer (casque, bluetooth...) : debounce puis re-resolution des peripheriques
  let devTimer = null;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    clearTimeout(devTimer);
    devTimer = setTimeout(async () => {
      try {
      const s = cfg.settings;
      const prev = { cable: s.cableId, mon: s.monId, mic: s.micId };
      const hadCable = cablePresent();
      await refreshDevices(false);
      resolveDevices();
      updateCableUi();
      // ne reconstruit les sorties que si un peripherique configure a disparu
      if (s.cableId !== prev.cable || s.monId !== prev.mon || s.micId !== prev.mic) await applyAudio().catch((e) => logErr('applyAudio', e));
      // Cable branche/installé a chaud : diffusion + bascule micro sans relancer l'app
      if (!hadCable && cablePresent()) {
        await applyAudio().catch((e) => logErr('applyAudio', e));
        window.sf.audioAutoSetup({ enabled: s.autoSwitchMic, cableLabel: s.cableLabel }).then((r) => {
          if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
        }).catch((e) => logErr('audioAutoSetup', e));
      }
      } catch (e) { logErr('devicechange', e); }
    }, 500);
  });

  // glisser-deposer de fichiers
  const overlay = $('#drop-overlay');
  let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; overlay.classList.add('on'); } });
  window.addEventListener('dragleave', (e) => { if (isFiles(e) && --depth <= 0) { depth = 0; overlay.classList.remove('on'); } });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('on');
    const paths = [...e.dataTransfer.files].map((f) => window.sf.pathForFile(f)).filter(Boolean);
    if (paths.length) addPaths(paths).catch((e) => logErr('addPaths', e));
  });
  // dragend/blur : un drag annule hors fenetre peut desequilibrer les
  // dragleave -> overlay fige (cosmetique, mais evitons-le).
  window.addEventListener('dragend', () => { depth = 0; overlay.classList.remove('on'); });
  window.addEventListener('blur', () => { depth = 0; overlay.classList.remove('on'); });

  // Bibliotheque vide (premier lancement) : injecter les sons par defaut bundled dans l'exe.
  if (!cfg.sounds.length && window.sf.seedSounds) {
    const raw = await window.sf.seedSounds().catch((e) => { logErr('seedSounds', e); return null; });
    const defs = Array.isArray(raw) ? raw : [];
    const now = Date.now();
    defs.forEach((d, i) => {
      if (cfg.sounds.length >= 5000) return;
      cfg.sounds.push({
        id: uid(), name: d.name, path: d.path, categoryId: null,
        volume: 100, addedAt: now + i, plays: 0,
        favorite: false, norm: 1, shortcut: null,
        trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
      });
    });
    if (defs.length) save();
  }

  renderAll();
  await refreshDevices(true);
  resolveDevices();
  save();
  checkMissing().catch((e) => logErr('checkMissing', e));
  const ok = await applyAudio();
  applyShortcuts().catch((e) => logErr('applyShortcuts', e));
  updateCableUi();
  showCableScreen();
  if (cablePresent()) window.sf.audioAutoSetup({ enabled: cfg.settings.autoSwitchMic, cableLabel: cfg.settings.cableLabel }).then((r) => {
    if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
    else if (r && !r.ok) console.warn('bascule micro auto :', r.err);
  }).catch((e) => logErr('audioAutoSetup', e));
  window.sf.onMicWatchOff && window.sf.onMicWatchOff(() => {
    toast('Entrée micro modifiée pendant la session — surveillance auto suspendue (réglages → surveillance micro).', 'warn');
  });
  window.sf.onPowerResume && window.sf.onPowerResume(() => {
    // Reveil systeme : peripheriques re-enumeres sans devicechange fiable.
    // Delai : les drivers audio/USB/Bluetooth peuvent mettre >1 s a se
    // re-initialiser — une enumeration prematuree partielle effacerait
    // cableId/monId (resolveDevices) et casserait le routage.
    setTimeout(() => {
      refreshDevices(false).then(() => { resolveDevices(); updateCableUi(); })
        .catch((e) => logErr('powerResume', e));
    }, 2500);
  });
  window.sf.onShortcut((key) => {
    if (key === '__stop__') { stopAll(false); return; }
    const s = cfg.sounds.find((x) => x.id === key);
    if (s) play(s);
  });
  if (!cfg.settings.cableId) {
    toast('Choisis ta sortie Discord (CABLE Input) dans les réglages audio.', 'warn');
    settingsModal();
  } else if (ok) {
    updateRoutes();
  }
}

init().catch((e) => {
  logErr('init', e);
  try { toast('Initialisation incomplète : ' + (e && e.message), 'warn'); } catch {}
});
