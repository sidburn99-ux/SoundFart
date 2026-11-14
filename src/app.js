'use strict';

const SR = 48000;
const VIRTUAL_RE = /cable|virtual|voicemeeter|vb-audio/i;
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
let saveTimer;

const defaults = () => ({
  version: 1,
  sounds: [],
  categories: [],
  settings: { cableId: '', cableLabel: '', monId: 'default', monLabel: '', micId: '', micLabel: '', micMix: false, master: 80, sort: 'added-desc', catSort: 'manual', stopShortcut: 'CommandOrControl+Alt+S', storageDir: '', autoSwitchMic: true, groupByCat: true },
  ui: { cat: 'all' },
});

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.sf.saveConfig(cfg), 250);
}
window.addEventListener('beforeunload', () => { if (cfg) window.sf.saveConfig(cfg); window.sf.restoreMic(); });

function normalizeCfg(saved) {
  const c = Object.assign(defaults(), saved || {});
  c.settings = Object.assign(defaults().settings, c.settings || {});
  c.ui = Object.assign(defaults().ui, c.ui || {});
  if (!Array.isArray(c.sounds)) c.sounds = [];
  if (!Array.isArray(c.categories)) c.categories = [];
  c.sounds.forEach((s) => {
    s.volume ??= 100; s.plays ??= 0; s.addedAt ??= 0; s.categoryId ??= null;
    s.favorite ??= false; s.norm ??= 1; s.shortcut ??= null;
    s.trimStart ??= 0; s.trimEnd ??= null; s.fadeIn ??= 0; s.fadeOut ??= 0;
  });
  const hasCat = (id) => c.categories.some((x) => x.id === id);
  if (!['all', 'none', 'fav'].includes(c.ui.cat) && !hasCat(c.ui.cat)) c.ui.cat = 'all';
  return c;
}

const catById = (id) => cfg.categories.find((c) => c.id === id);
const soundHasCat = (s) => !!(s.categoryId && catById(s.categoryId));

// ================================================================ interface generique
function toast(msg, kind = '') {
  const t = el('div', { class: 'toast ' + kind, text: msg });
  $('#toast').append(t);
  setTimeout(() => t.remove(), 4200);
}

function modal(title, body, buttons, opts = {}) {
  const root = $('#modal-root');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    el('h2', { text: title }),
    el('div', { class: 'modal-body' }, body),
    el('div', { class: 'modal-actions' },
      buttons.map((b) => el('button', { class: b.kind || '', text: b.label, onclick: () => b.onclick(close) }))));
  root.replaceChildren(el('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === e.currentTarget) close(); } }, box));
  return close;
}

const field = (label, node, hint) =>
  el('div', { class: 'field' }, el('label', { text: label }), node, hint ? el('div', { class: 'hint', text: hint }) : null);

function askText(title, label, initial, okLabel) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'text', value: initial || '', maxlength: 80 });
    const done = (close, v) => { close(); resolve(v); };
    const close = modal(title, [field(label, input)], [
      { label: 'Annuler', onclick: (c) => done(c, null) },
      { label: okLabel || 'OK', kind: 'primary', onclick: (c) => done(c, input.value.trim() || null) },
    ]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(close, input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

function confirmBox(title, msg, okLabel) {
  return new Promise((resolve) => {
    modal(title, [el('div', { text: msg })], [
      { label: 'Annuler', onclick: (c) => { c(); resolve(false); } },
      { label: okLabel || 'Confirmer', kind: 'primary', onclick: (c) => { c(); resolve(true); } },
    ]);
  });
}

// ================================================================ moteur audio
const decoder = new OfflineAudioContext(2, 1, SR);
const audio = { cable: null, mon: null, micStream: null, devices: { out: [], inp: [] } };
const bufCache = new Map();
const voices = new Set();

async function getBuffer(path) {
  if (bufCache.has(path)) {
    const b = bufCache.get(path);
    bufCache.delete(path);
    bufCache.set(path, b);
    return b;
  }
  const data = await window.sf.readFile(path);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const buf = await decoder.decodeAudioData(ab);
  bufCache.set(path, buf);
  if (bufCache.size > 16) bufCache.delete(bufCache.keys().next().value);
  return buf;
}

async function makeOutput(deviceId) {
  const ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
  try {
    await ctx.setSinkId(deviceId);
  } catch (e) {
    ctx.close();
    throw e;
  }
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
  for (const k of ['cable', 'mon']) {
    if (audio[k]) { try { await audio[k].ctx.close(); } catch {} audio[k] = null; }
  }
  if (audio.micStream) { audio.micStream.getTracks().forEach((t) => t.stop()); audio.micStream = null; }
}

async function applyAudio() {
  await teardownAudio();
  const s = cfg.settings;
  const warns = [];
  try {
    if (s.cableId) audio.cable = await makeOutput(s.cableId);
    if (s.monId) audio.mon = await makeOutput(s.monId);
  } catch (e) {
    warns.push('Erreur de sortie audio : ' + e.message);
  }
  // Mixage micro requis des que la bascule auto est active : sinon Discord n'entend que les
  // sons, jamais la voix. micMix reste un interrupteur manuel complementaire.
  const micMixOn = s.micMix || s.autoSwitchMic;
  if (micMixOn) {
    try {
      if (!audio.cable) warns.push('Mixage micro : choisis d\'abord une sortie Discord.');
      else if (!VIRTUAL_RE.test(s.cableLabel)) warns.push('Mixage micro désactivé : la sortie Discord n\'est pas un câble virtuel (tu t\'entendrais dans ton casque).');
      else if (s.cableId === s.monId) warns.push('Mixage micro désactivé : sortie Discord et écoute locale identiques.');
      else {
        // « default » pointerait sur CABLE Output depuis la bascule micro auto : on prend un vrai peripherique non virtuel
        let micDev = s.micId && s.micId !== 'default' ? s.micId : null;
        if (!micDev) {
          const real = (audio.devices.inp || []).find((d) => d.deviceId !== 'default' && !VIRTUAL_RE.test(d.label || ''));
          micDev = real ? real.deviceId : (s.micId === 'default' ? 'default' : undefined);
        }
        // Traitement vocal sur la voix uniquement (echo cancellation, bruit, gain) —
        // les sons joues via Web Audio ne sont pas concernes.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: micDev ? { exact: micDev } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        audio.micStream = stream;
        const src = audio.cable.ctx.createMediaStreamSource(stream);
        src.connect(audio.cable.lim);
      }
    } catch (e) {
      warns.push('Micro inaccessible : ' + e.message);
    }
  }
  updateRoutes();
  if (warns.length) toast(warns.join('\n'), 'warn');
  return warns.length === 0;
}

async function refreshDevices(askPermission) {
  if (askPermission) {
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch {}
  }
  const list = await navigator.mediaDevices.enumerateDevices();
  audio.devices.out = list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
  audio.devices.inp = list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
}

function resolveDevices() {
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

function setPlaying(id, delta) {
  const n = (playingCount.get(id) || 0) + delta;
  if (n <= 0) playingCount.delete(id); else playingCount.set(id, n);
  const c = cardEls.get(id);
  if (c) c.classList.toggle('playing', n > 0);
  const names = [...playingCount.keys()].map((i) => cfg.sounds.find((x) => x.id === i)?.name).filter(Boolean);
  $('#nowplaying').textContent = names.length ? '▶ ' + names.join(' + ') : 'Prêt';
}

function endVoice(v) {
  if (voices.delete(v)) setPlaying(v.soundId, -1);
}

function play(sound, opts = {}) {
  const active = (opts.monitorOnly ? [audio.mon] : [audio.cable, audio.mon]).filter(Boolean);
  if (!active.length) {
    toast(opts.monitorOnly ? 'Choisis une « écoute locale » dans les réglages pour pré-écouter sans que tes potes entendent.'
      : 'Aucune sortie audio active : ouvre les réglages audio.', 'warn');
    return Promise.resolve(null);
  }
  return getBuffer(sound.path).then((buf) => {
    const vol = ((opts.volume ?? sound.volume) / 100) * (sound.norm ?? 1);
    const offset = Math.min(Math.max(0, opts.trimStart ?? sound.trimStart ?? 0), Math.max(0, buf.duration - 0.05));
    const endRaw = opts.trimEnd !== undefined ? opts.trimEnd : sound.trimEnd;
    const dur = Math.max(0.05, Math.min(endRaw ?? buf.duration, buf.duration) - offset);
    let fi = (opts.fadeIn ?? sound.fadeIn ?? 0) / 1000;
    let fo = (opts.fadeOut ?? sound.fadeOut ?? 0) / 1000;
    if (fi + fo > dur) { const k = dur / (fi + fo); fi *= k; fo *= k; }
    const voice = { soundId: sound.id, nodes: [], preview: !!opts.preview };
    let remaining = active.length;
    for (const out of active) {
      if (out.ctx.state !== 'running') out.ctx.resume();
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
    voices.add(voice);
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
  }).catch(() => {
    toast(`Impossible de lire « ${sound.name} » : fichier introuvable ou illisible.`, 'warn');
    missing.add(sound.id);
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
  if (instant) endVoice(v);
}

function stopAll(instant) {
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

function findShortcutOwner(acc, excludeSoundId) {
  const a = (acc || '').toLowerCase();
  if (!a) return null;
  if ((cfg.settings.stopShortcut || '').toLowerCase() === a) return 'le raccourci STOP';
  const s = cfg.sounds.find((x) => x.id !== excludeSoundId && (x.shortcut || '').toLowerCase() === a);
  return s ? '« ' + s.name + ' »' : null;
}

async function applyShortcuts() {
  const entries = [];
  for (const s of cfg.sounds) if (s.shortcut) entries.push({ key: s.id, accel: s.shortcut });
  if (cfg.settings.stopShortcut) entries.push({ key: '__stop__', accel: cfg.settings.stopShortcut });
  try {
    const failed = await window.sf.applyShortcuts(entries);
    if (failed && failed.length) toast('Raccourcis refusés par Windows : ' + failed.map(fmtAccel).join(', '), 'warn');
  } catch (e) {
    logErr('shortcuts', e);
  }
}

function logErr(tag, e) { console.error(tag, e); }

// ================================================================ normalisation
async function computeNorm(path) {
  const buf = await getBuffer(path);
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const step = Math.max(1, Math.floor(d.length / 200000));
    for (let i = 0; i < d.length; i += step) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
  }
  if (!peak) return 1;
  return Math.min(4, Math.round((0.89 / peak) * 100) / 100);
}

async function normalizeAll() {
  const targets = cfg.sounds.filter((s) => !missing.has(s.id));
  if (!targets.length) { toast('Aucun son à normaliser.', 'warn'); return; }
  const prog = el('div', { class: 'hint', text: `0 / ${targets.length}` });
  const closeP = modal('Normalisation de la bibliothèque', [
    prog,
    el('div', { class: 'hint', text: 'Le volume de chaque son est ajusté pour un niveau cible. Ça peut prendre un moment sur une grosse bibliothèque.' }),
  ], [{ label: 'Fermer', onclick: (c) => c() }]);
  let done = 0, failed = 0;
  for (const s of targets) {
    try { s.norm = await computeNorm(s.path); } catch { failed++; s.norm = 1; }
    prog.textContent = `${++done} / ${targets.length}`;
    await new Promise((r) => setTimeout(r, 0));
  }
  save(); closeP(); renderAll();
  toast(`Normalisation terminée : ${done - failed} son(s) ajusté(s)` + (failed ? `, ${failed} ignoré(s)` : '') + '.');
}

// ================================================================ utilitaires
const fmtTime = (sec) => {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
};

function parseTs(v) {
  const t = String(v || '').trim();
  if (!t) return 0;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((a, b) => a * 60 + parseFloat(b), 0);
}

// ================================================================ donnees : sons & categories
async function addPaths(rawPaths) {
  const paths = await window.sf.expandPaths(rawPaths);
  if (!paths.length) { toast('Aucun fichier audio reconnu (mp3, wav, ogg, flac, m4a, aac, opus).', 'warn'); return; }
  const known = new Set(cfg.sounds.map((s) => s.path.toLowerCase()));
  const catId = catById(cfg.ui.cat) ? cfg.ui.cat : null;
  const now = Date.now();
  let n = 0;
  for (const p of paths) {
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
  toast(n ? `${n} son(s) ajouté(s).` : 'Ces sons sont déjà dans la liste.');
}

async function removeSound(s) {
  if (!(await confirmBox('Retirer ce son ?', `« ${s.name} » sera retiré de SoundFart. Le fichier audio d'origine n'est pas supprimé.`, 'Retirer'))) return;
  cfg.sounds = cfg.sounds.filter((x) => x.id !== s.id);
  save(); renderAll();
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

function sortedCategories() {
  const col = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const count = (c) => cfg.sounds.filter((x) => x.categoryId === c.id).length;
  const arr = [...cfg.categories];
  switch (cfg.settings.catSort) {
    case 'name-asc': return arr.sort((a, b) => col.compare(a.name, b.name));
    case 'name-desc': return arr.sort((a, b) => col.compare(b.name, a.name));
    case 'count-desc': return arr.sort((a, b) => count(b) - count(a) || col.compare(a.name, b.name));
    default: return arr;
  }
}

function moveCategory(c, dir) {
  const i = cfg.categories.indexOf(c);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cfg.categories.length) return;
  [cfg.categories[i], cfg.categories[j]] = [cfg.categories[j], cfg.categories[i]];
  save(); renderSidebar();
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

// ================================================================ edition d'un son
function editSound(s) {
  const nameIn = el('input', { type: 'text', value: s.name, maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name, selected: c.id === s.categoryId })));
  const favChk = el('input', { type: 'checkbox', checked: !!s.favorite });
  const vol = el('input', { type: 'range', min: 0, max: 300, step: 5, value: s.volume });
  const volLbl = el('span', { class: 'vol-val', text: s.volume + '%' });
  vol.addEventListener('input', () => { volLbl.textContent = vol.value + '%'; });

  // ---- raccourci clavier global
  let sc = s.shortcut || '';
  const scBtn = el('button', { text: sc ? fmtAccel(sc) : 'Aucun — cliquer pour définir' });
  const scHint = el('div', { class: 'hint', text: 'Fonctionne même fenêtre minimisée, Discord ou jeu au premier plan. Ex : Ctrl+Alt+Q ou F6.' });
  let scCleanup = () => {};
  scBtn.addEventListener('click', () => {
    scCleanup();
    scBtn.textContent = 'Appuie sur le raccourci… (Échap pour annuler)';
    const disarm = () => {
      window.removeEventListener('keydown', onKey, true);
      scCleanup = () => {};
      scBtn.textContent = sc ? fmtAccel(sc) : 'Aucun — cliquer pour définir';
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { disarm(); return; }
      const acc = buildAccel(e);
      if (!acc) { scHint.textContent = 'Ajoute un modifieur (Ctrl, Alt, Maj) ou utilise une touche F.'; return; }
      const owner = findShortcutOwner(acc, s.id);
      if (owner) { scHint.textContent = 'Ce raccourci est déjà utilisé par ' + owner + '.'; return; }
      sc = acc;
      scBtn.textContent = fmtAccel(acc);
      scHint.textContent = '';
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    scCleanup = disarm;
  });

  // ---- normalisation
  let norm = s.norm ?? 1;
  const normVal = el('span', { class: 'vol-val', text: '×' + norm });
  const normBtn = el('button', { text: 'Normaliser ce son', onclick: async () => {
    try {
      norm = await computeNorm(s.path);
      normVal.textContent = '×' + norm;
      toast(`Volume normalisé : ×${norm}.`);
    } catch { toast('Impossible d\'analyser ce fichier.', 'warn'); }
  } });

  // ---- decoupage non destructif (le fichier d'origine n'est jamais modifie)
  let dur = 0, peaks = null, drag = null, dragMoved = false, downX = 0, downT = 0;
  let pvVoice = null, pvPos = null;
  let ts = s.trimStart || 0;
  let te = s.trimEnd ?? 0;
  const canvas = el('canvas', { class: 'wave', height: 96 });
  const startIn = el('input', { type: 'number', min: 0, step: 0.01, value: ts.toFixed(2) });
  const endIn = el('input', { type: 'number', min: 0, step: 0.01, value: '' });
  const fiIn = el('input', { type: 'number', min: 0, max: 5000, step: 50, value: s.fadeIn || 0 });
  const foIn = el('input', { type: 'number', min: 0, max: 5000, step: 50, value: s.fadeOut || 0 });
  const info = el('div', { class: 'hint', text: "Chargement de l'onde…" });
  const outStart = () => (ts > 0.005 ? ts : 0);
  const outEnd = () => (dur ? (te < dur - 0.005 ? te : null) : (s.trimEnd ?? null));

  function sync() {
    startIn.value = ts.toFixed(2);
    endIn.value = dur ? te.toFixed(2) : '';
    if (dur) info.textContent = `Durée jouée : ${(te - ts).toFixed(2)} s sur ${dur.toFixed(2)} s`;
  }
  function draw() {
    const w = canvas.width, h = canvas.height, g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!peaks) return;
    const x0 = (ts / dur) * w, x1 = (te / dur) * w, n = peaks.length, bw = w / n;
    g.fillStyle = 'rgba(139,92,246,.18)';
    g.fillRect(x0, 0, x1 - x0, h);
    for (let i = 0; i < n; i++) {
      const x = i * bw;
      g.fillStyle = x >= x0 - bw && x <= x1 ? '#c4a8ff' : '#4a4870';
      const ph = Math.max(2, peaks[i] * h * 0.9);
      g.fillRect(x, (h - ph) / 2, Math.max(1, bw - 1), ph);
    }
    g.fillStyle = '#ec4899';
    g.fillRect(x0 - 1, 0, 3, h);
    g.fillRect(x1 - 2, 0, 3, h);
    if (pvPos != null && dur) {
      const xp = Math.min(w - 1, Math.max(0, (pvPos / dur) * w));
      g.fillStyle = '#ffffff';
      g.fillRect(xp - 1, 0, 2, h);
      g.beginPath();
      g.moveTo(xp - 5, 0); g.lineTo(xp + 5, 0); g.lineTo(xp, 7);
      g.closePath(); g.fill();
    }
  }
  const timeAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur)); };
  const applyMarker = (t) => {
    if (drag === 'start') ts = Math.min(t, te - 0.05); else te = Math.max(t, ts + 0.05);
    sync(); draw();
  };
  const move = (e) => {
    if (!drag || !dur) return;
    if (Math.abs(e.clientX - downX) > 6) dragMoved = true;
    applyMarker(timeAt(e));
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!dur) return;
    const t = timeAt(e);
    drag = Math.abs(t - ts) <= Math.abs(t - te) ? 'start' : 'end';
    dragMoved = false;
    downX = e.clientX;
    downT = t;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!dragMoved) {
      if (pvVoice) seekPreview(downT);
      else applyMarker(downT);
    }
    drag = null;
  });
  startIn.addEventListener('change', () => { if (dur) { ts = Math.min(Math.max(0, +startIn.value || 0), te - 0.05); sync(); draw(); } });
  endIn.addEventListener('change', () => { if (dur) { te = Math.max(Math.min(dur, +endIn.value || dur), ts + 0.05); sync(); draw(); } });

  const loadWave = () => getBuffer(s.path).then((buf) => {
    dur = buf.duration;
    const ch = buf.getChannelData(0);
    const N = 300, step = Math.max(1, Math.floor(ch.length / N));
    peaks = new Float32Array(N);
    let mx = 1e-4;
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let j = i * step, e = Math.min(ch.length, (i + 1) * step); j < e; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      peaks[i] = m;
      if (m > mx) mx = m;
    }
    for (let i = 0; i < N; i++) peaks[i] /= mx;
    te = s.trimEnd ? Math.min(s.trimEnd, dur) : dur;
    ts = Math.min(s.trimStart || 0, te - 0.05);
    sync(); draw();
  }).catch(() => { info.textContent = 'Onde indisponible (fichier introuvable ou illisible).'; });
  loadWave();

  const pvTime = el('div', { class: 'hint pvtime' });
  let pvToken = 0;
  const stopPreview = () => {
    if (pvVoice) { const v = pvVoice; pvVoice = null; stopVoice(v, true); }
    pvPos = null; pvTime.textContent = ''; draw();
  };
  const startPreview = async (from) => {
    const tok = ++pvToken;
    stopPreview();
    const v = await play(s, {
      monitorOnly: true, preview: true,
      volume: +vol.value,
      trimStart: from ?? outStart(),
      trimEnd: outEnd(),
      fadeIn: +fiIn.value || 0, fadeOut: +foIn.value || 0,
      onProgress: (frac, absPos, regionDur, regionStart) => {
        if (frac == null) { pvPos = null; pvTime.textContent = ''; draw(); return; }
        pvPos = absPos;
        pvTime.textContent = fmtTime(absPos - regionStart) + ' / ' + fmtTime(regionDur);
        draw();
      },
    });
    if (tok !== pvToken) { if (v) stopVoice(v, true); return; }
    pvVoice = v && voices.has(v) ? v : null;
  };
  function seekPreview(t) {
    if (!dur || !pvVoice) return;
    startPreview(Math.min(Math.max(t, ts + 0.02), te - 0.02));
  }
  const preview = () => startPreview();
  const reset = () => { ts = 0; te = dur; fiIn.value = 0; foIn.value = 0; sync(); draw(); };

  const scClear = el('button', { class: 'ghost', text: 'Effacer', onclick: () => { sc = ''; scBtn.textContent = 'Aucun — cliquer pour définir'; scHint.textContent = ''; } });
  const times = el('div', { class: 'times' },
    el('label', { text: 'Début (s)' }), startIn, el('label', { text: 'Fin (s)' }), endIn,
    el('label', { text: 'Fondu d\'entrée (ms)' }), fiIn, el('label', { text: 'Fondu de sortie (ms)' }), foIn);

  modal('Modifier le son', [
    field('Nom', nameIn),
    field('Catégorie', catSel),
    field('Favori', el('label', { class: 'check' }, favChk,
      el('span', { text: 'Visible dans la catégorie ★ Favoris, en haut de la barre latérale.' }))),
    field('Volume de ce son', el('div', { class: 'row' }, vol, volLbl),
      '100 % = volume d\'origine. Au-delà, le son est amplifié (un limiteur évite la saturation).'),
    field('Normalisation', el('div', { class: 'row' }, normBtn, normVal),
      'Ajuste le volume du son vers un niveau cible sans toucher au fichier. ×1 = inchangé.'),
    field('Raccourci clavier global', el('div', { class: 'row' }, scBtn, scClear), scHint),
    field('Découper (début / fin) et fondus', el('div', { class: 'trim' }, canvas, pvTime, info, times),
      'Glisse les repères roses sur l\'onde ou tape les temps. Clique sur l\'onde pendant l\'écoute pour déplacer la tête de lecture. Le fichier original n\'est jamais modifié.'),
    el('div', { class: 'row' },
      el('button', { text: '▶ Écouter (casque)', onclick: preview }),
      el('button', { text: 'MP3 de l\'extrait', title: 'Crée un petit fichier MP3 contenant uniquement l\'extrait choisi (ffmpeg est téléchargé au premier usage)', onclick: async () => {
        if (!dur) { toast('Attend le chargement de l\'onde.', 'warn'); return; }
        try {
          const out = await window.sf.mediaCut({ input: s.path, start: outStart(), end: outEnd() ?? dur, dir: cfg.settings.storageDir || '' });
          if (await confirmBox('Extrait MP3 créé', 'Fichier : ' + out + '\n\nL\'utiliser à la place du fichier actuel ? La découpe et les fondus seront réinitialisés (le MP3 contient déjà l\'extrait).', 'Utiliser')) {
            s.path = out;
            s.trimStart = 0; s.trimEnd = null; s.fadeIn = 0; s.fadeOut = 0;
            ts = 0; te = 0; dur = 0; peaks = null; pvPos = null;
            stopPreview();
            sync(); draw(); loadWave(); save(); renderAll();
            toast('Fichier remplacé par l\'extrait MP3.');
          } else {
            toast('MP3 créé : ' + out);
          }
        } catch (e) { toast('Export impossible : ' + e.message, 'warn'); }
      } }),
      el('button', { text: 'Tout réinitialiser', onclick: reset }),
      el('button', { text: 'Ouvrir l\'emplacement', onclick: () => window.sf.reveal(s.path) })),
    field('Fichier', el('div', { class: 'path hint', text: s.path })),
  ], [
    { label: 'Annuler', onclick: (c) => c() },
    { label: 'Enregistrer', kind: 'primary', onclick: (c) => {
      s.name = nameIn.value.trim() || s.name;
      s.volume = +vol.value;
      s.categoryId = catSel.value || null;
      s.favorite = favChk.checked;
      s.shortcut = sc || null;
      s.norm = norm;
      s.trimStart = outStart();
      s.trimEnd = outEnd();
      s.fadeIn = Math.max(0, +fiIn.value || 0);
      s.fadeOut = Math.max(0, +foIn.value || 0);
      save(); renderAll(); c();
      applyShortcuts();
    } },
  ], { wide: true, onClose: () => { pvToken++; stopPreview(); scCleanup(); } });
  requestAnimationFrame(() => { canvas.width = canvas.clientWidth || 600; draw(); });
}

// ================================================================ reglages audio
// ================================================================ sauvegarde (export/import)
function exportConfig() {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soundfart-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Configuration exportée (références uniquement, pas les fichiers audio).');
}

function importConfig(onDone) {
  const inp = el('input', { type: 'file', accept: '.json,application/json' });
  inp.style.display = 'none';
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    inp.remove();
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed || !Array.isArray(parsed.sounds)) throw new Error('fichier invalide');
      if (!(await confirmBox('Importer la configuration ?', 'La configuration actuelle (sons, catégories, réglages, raccourcis) sera remplacée. Les fichiers audio ne sont pas modifiés.', 'Importer'))) return;
      await teardownAudio();
      cfg = normalizeCfg(parsed);
      save();
      await refreshDevices(false);
      resolveDevices();
      await applyAudio();
      applyShortcuts();
      renderAll();
      toast('Configuration importée.');
      if (onDone) onDone();
    } catch (e) { toast('Import impossible : ' + e.message, 'warn'); }
  });
  inp.click();
}

function settingsModal() {
  const s = cfg.settings;
  const opts = (list, selected, withNone) => [
    withNone ? el('option', { value: '', text: '(aucune)' }) : null,
    list.map((d) => el('option', { value: d.deviceId, text: d.label || d.deviceId, selected: d.deviceId === selected })),
  ];
  const cableSel = el('select', {}, el('option', { value: '', text: '(choisir…)' }), opts(audio.devices.out, s.cableId, false));
  const monSel = el('select', {}, opts(audio.devices.out, s.monId, true));
  const micSel = el('select', {}, opts(audio.devices.inp, s.micId, false));
  const mix = el('input', { type: 'checkbox', checked: s.micMix });
  const hasCable = audio.devices.out.some((d) => VIRTUAL_RE.test(d.label));
  const lbl = (sel) => (sel.value ? sel.selectedOptions[0].textContent : '');

  // raccourci global STOP
  let stopSc = s.stopShortcut || '';
  const stopBtn = el('button', { text: stopSc ? fmtAccel(stopSc) : 'Aucun — cliquer pour définir' });
  const stopHint = el('div', { class: 'hint', text: 'Interrompt immédiatement tous les sons en cours, même fenêtre minimisée.' });
  let stopCleanup = () => {};
  stopBtn.addEventListener('click', () => {
    stopCleanup();
    stopBtn.textContent = 'Appuie sur le raccourci… (Échap pour annuler)';
    const disarm = () => {
      window.removeEventListener('keydown', onKey, true);
      stopCleanup = () => {};
      stopBtn.textContent = stopSc ? fmtAccel(stopSc) : 'Aucun — cliquer pour définir';
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { disarm(); return; }
      const acc = buildAccel(e);
      if (!acc) { stopHint.textContent = 'Ajoute un modifieur (Ctrl, Alt, Maj) ou utilise une touche F.'; return; }
      const owner = cfg.sounds.find((x) => (x.shortcut || '').toLowerCase() === acc.toLowerCase());
      if (owner) { stopHint.textContent = 'Ce raccourci est déjà attribué à « ' + owner.name + ' ».'; return; }
      stopSc = acc;
      stopBtn.textContent = fmtAccel(acc);
      stopHint.textContent = '';
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    stopCleanup = disarm;
  });

  // dossier de stockage des fichiers crees par l'app (imports YouTube, enregistrements, extraits)
  const dirLbl = el('div', { class: 'hint path', text: s.storageDir || 'Dossier SoundFart par défaut (%APPDATA%\\SoundFart)' });
  const pickDirBtn = el('button', { text: 'Choisir…', onclick: async () => {
    const d = await window.sf.pickDir();
    if (d) { s.storageDir = d; dirLbl.textContent = d; }
  } });
  const resetDirBtn = el('button', { class: 'ghost', text: 'Réinitialiser', onclick: () => { s.storageDir = ''; dirLbl.textContent = 'Dossier SoundFart par défaut (%APPDATA%\\SoundFart)'; } });
  const autoMic = el('input', { type: 'checkbox', checked: !!s.autoSwitchMic });

  const normAllBtn = el('button', { text: 'Normaliser toute la bibliothèque', onclick: () => { closeSettings(); normalizeAll(); } });
  const exportBtn = el('button', { text: 'Exporter la configuration', onclick: exportConfig });
  const importBtn = el('button', { text: 'Importer une configuration', onclick: () => importConfig(closeSettings) });

  const closeSettings = modal('Réglages audio', [
    field('Sortie vers Discord (micro virtuel)', cableSel,
      hasCable ? 'Choisis « CABLE Input ». Dans Discord, mets « CABLE Output » comme micro.'
        : 'Aucun câble virtuel détecté : installe VB-CABLE puis redémarre le PC.'),
    field('Écoute locale (ton casque)', monSel, 'Tu entends les sons dans ton casque, jamais ta propre voix.'),
    field('Mon micro', micSel),
    el('label', { class: 'check' }, mix,
      el('span', { text: 'Mixer mon micro dans la sortie Discord (sinon tes potes n\'entendent que les sons). Décoche si tu utilises « Écouter ce périphérique » de Windows.' })),
    field('Bascule micro automatique', el('label', { class: 'check' }, autoMic,
      el('span', { text: 'Au lancement, l\'entrée micro Windows passe sur « CABLE Output » et revient à ton micro à la fermeture. Dans Discord, choisis « Défaut » comme périphérique d\'entrée pour que ça suive.' }))),
    field('Dossier de stockage', el('div', { class: 'row' }, dirLbl, pickDirBtn, resetDirBtn),
      'Les fichiers créés par SoundFart (imports YouTube, enregistrements, extraits MP3) iront dans ce dossier (sous-dossiers imports/, recordings/, cuts/).'),
    field('Raccourci global STOP', el('div', { class: 'row' }, stopBtn), stopHint),
    field('Niveaux audio', el('div', { class: 'row' }, normAllBtn),
      'Normalise le volume de tous les sons vers un niveau cible (les fichiers ne sont pas modifiés).'),
    field('Sauvegarde', el('div', { class: 'row' }, exportBtn, importBtn),
      'La configuration contient les références aux fichiers, catégories, découpes, raccourcis et favoris — pas les fichiers audio eux-mêmes.'),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Appliquer', kind: 'primary', onclick: async (c) => {
      s.cableId = cableSel.value; s.cableLabel = lbl(cableSel);
      s.monId = monSel.value; s.monLabel = lbl(monSel);
      s.micId = micSel.value; s.micLabel = lbl(micSel);
      s.micMix = mix.checked;
      s.stopShortcut = stopSc || '';
      s.storageDir = s.storageDir || '';
      s.autoSwitchMic = autoMic.checked;
      save(); c();
      if (await applyAudio()) toast('Réglages audio appliqués.');
      applyShortcuts();
      window.sf.audioAutoSetup({ enabled: s.autoSwitchMic, cableLabel: s.cableLabel }).then((r) => {
        if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
        else if (r && !r.ok) toast('Bascule micro auto impossible : ' + r.err, 'warn');
      });
    } },
  ], { onClose: () => stopCleanup() });
}

// ================================================================ rendu
function visibleSounds() {
  const q = $('#search').value.trim().toLowerCase();
  const view = cfg.ui.cat;
  const col = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
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
  item('all', 'Tous les sons', cfg.sounds.length, null);
  item('fav', '★ Favoris', cfg.sounds.filter((s) => s.favorite).length, null);
  item('none', 'Sans catégorie', cfg.sounds.filter((s) => !soundHasCat(s)).length, null);
  for (const c of sortedCategories()) item(c.id, c.name, cfg.sounds.filter((s) => s.categoryId === c.id).length, c);
}

function renderGrid() {
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
  } catch {}
}

function renderAll() { renderSidebar(); renderGrid(); pushMenuState(); }

function showCtx(e, s) {
  const item = (label, fn, cls) => el('button', { class: cls || '', text: label, onclick: fn });
  const m = $('#ctxmenu');
  m.replaceChildren(
    item('Modifier (nom, volume, catégorie, raccourci)…', () => editSound(s)),
    item(s.favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris', () => { s.favorite = !s.favorite; save(); renderAll(); }),
    item('Ouvrir l\'emplacement du fichier', () => window.sf.reveal(s.path)),
    item('Retrouver le fichier…', () => relocateSound(s)),
    item('Retirer de la liste', () => removeSound(s), 'danger'));
  m.style.left = Math.min(e.clientX, innerWidth - 240) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - 140) + 'px';
  m.classList.add('on');
}

async function relocateSound(s) {
  const paths = await window.sf.pickFiles();
  const p = paths[0];
  if (!p) return;
  s.path = p;
  missing.delete(s.id);
  save(); renderAll();
  toast('Fichier retrouvé : ' + p);
}

async function checkMissing() {
  const miss = new Set(await window.sf.checkFiles(cfg.sounds.map((s) => s.path)));
  const next = new Set(cfg.sounds.filter((s) => miss.has(s.path)).map((s) => s.id));
  const changed = next.size !== missing.size || [...next].some((i) => !missing.has(i));
  missing = next;
  if (changed) renderGrid();
}

// ================================================================ enregistreur
async function recorderModal() {
  let streams = [], actx = null, rec = null, chunks = [];
  let recordedSound = null, recTimer = null, recStart = 0, looseTracks = [];

  // « default » exclu : apres la bascule micro auto, il pointerait sur CABLE Output (on enregistrerait la soundboard, pas le micro)
  const devs = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default');
  const micSel = el('select', {}, devs.map((d) => el('option', { value: d.deviceId, text: d.label || d.deviceId, selected: d.deviceId === cfg.settings.micId })));
  if (!micSel.value && devs.length) micSel.value = devs[0].deviceId;
  const micOn = el('input', { type: 'checkbox', checked: true });
  const pcOn = el('input', { type: 'checkbox', checked: false });
  const cableOn = el('input', { type: 'checkbox', checked: false });
  const status = el('div', { class: 'hint', text: 'Choisis les sources, puis lance l\'enregistrement.' });
  const nameIn = el('input', { type: 'text', value: 'Enregistrement ' + new Date().toLocaleString('fr-FR'), maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name })));
  const previewBtn = el('button', { text: '▶ Écouter', disabled: true });
  const startBtn = el('button', { text: '● Enregistrer', class: 'primary' });
  const stopBtn = el('button', { text: '■ Arrêter', disabled: true });

  const extFor = (mime) => (mime && mime.includes('mp4') ? '.m4a' : mime && mime.includes('ogg') ? '.ogg' : '.webm');
  const mimePick = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';

  const stopLoose = () => { looseTracks.forEach((t) => t.stop()); looseTracks = []; };

  const cleanup = () => {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    try { if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } } catch {}
    streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    stopLoose();
    window.sf.audioTapStop().catch(() => {});
    if (actx) actx.close().catch(() => {});
    streams = []; actx = rec = null;
  };

  // Capture l'audio systeme (Discord, musique...) = tout ce qui sort par le peripherique par defaut.
  // Methode 1 : chromeMediaSource (Electron/desktopCapturer) — la plus fiable sous Windows.
  // Methode 2 : getDisplayMedia + loopback (peut echouer : « Could not start audio source »).
  const audioOnly = (stream) => {
    const vids = stream.getVideoTracks();
    if (vids.length) looseTracks.push(...vids); // garder la video vivante : le loopback meurt avec elle
    return new MediaStream(stream.getAudioTracks());
  };
  const checkLive = async (stream) => {
    await new Promise((r) => setTimeout(r, 300));
    const tracks = stream.getAudioTracks();
    if (!tracks.length || tracks.some((t) => t.readyState !== 'live')) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('piste audio système interrompue (loopback indisponible)');
    }
    return stream;
  };
  const systemStream = async () => {
    const srcId = await window.sf.desktopSource().catch(() => null);
    const attempts = [];
    if (srcId) {
      attempts.push(() => navigator.mediaDevices.getUserMedia({
        audio: { chromeMediaSource: 'desktop', chromeMediaSourceId: srcId },
      }));
      attempts.push(() => navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: srcId } },
      }));
    }
    attempts.push(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((disp) => { looseTracks.push(...disp.getVideoTracks()); return new MediaStream(disp.getAudioTracks()); }));
    let lastErr = null;
    for (const fn of attempts) {
      try {
        const st = audioOnly(await fn());
        return await checkLive(st);
      } catch (e) {
        lastErr = e;
        stopLoose();
        window.sf.uiLog('systemStream: ' + (e && e.name) + ' ' + (e && e.message));
      }
    }
    throw lastErr || new Error('audio systeme indisponible');
  };

  // Peripherique d'entree qui correspond au cable virtuel (ex. « CABLE Output »)
  const cableStream = async () => {
    const inp = (audio.devices.inp || []).filter((d) => d.deviceId !== 'default');
    const d = inp.find((x) => /output/i.test(x.label) && VIRTUAL_RE.test(x.label))
      || inp.find((x) => /cable/i.test(x.label));
    if (!d) throw new Error('peripherique « CABLE Output » introuvable');
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: d.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  };

  previewBtn.addEventListener('click', () => {
    if (recordedSound) play(recordedSound, { monitorOnly: true, preview: true });
  });

  startBtn.addEventListener('click', async () => {
    try {
      streams = [];
      // « Audio du PC » : AudioTap injecte la sortie systeme dans CABLE Input -> on l'enregistre
      // via la source « CABLE Output » (fiable). Repli sur getDisplayMedia si le tap echoue.
      let tapOn = false;
      if (pcOn.checked) {
        try {
          const r = await window.sf.audioTapStart();
          tapOn = !!(r && r.ok);
          if (!tapOn) window.sf.uiLog('audioTapStart: ' + (r && r.err));
        } catch (e) { window.sf.uiLog('audioTapStart: ' + e.message); }
      }
      const want = [];
      if (micOn.checked) want.push(['micro', () => navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micSel.value ? { exact: micSel.value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })]);
      if (pcOn.checked && !tapOn) want.push(['audio du PC', systemStream]);
      if (cableOn.checked || tapOn) want.push(['câble SoundFart', cableStream]);
      if (!want.length) throw new Error('coche au moins une source');
      for (const [label, fn] of want) {
        try { streams.push(await fn()); }
        catch (e) { window.sf.uiLog('recorder src ' + label + ': ' + (e && e.name) + ' ' + (e && e.message)); streams.forEach((st) => st.getTracks().forEach((t) => t.stop())); streams = []; throw new Error(label + ' : ' + e.message); }
      }
      const mime = mimePick();
      actx = new AudioContext({ sampleRate: SR });
      const dest = actx.createMediaStreamDestination();
      const comp = actx.createDynamicsCompressor(); // evite l'ecrêtage quand plusieurs sources sont mixees
      comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 8;
      comp.connect(dest);
      streams.forEach((st) => actx.createMediaStreamSource(st).connect(comp));
      chunks = [];
      rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        if (recTimer) { clearInterval(recTimer); recTimer = null; }
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
          const ab = await blob.arrayBuffer();
          const fname = nameIn.value.trim() || 'enregistrement';
          const path = await window.sf.saveRecording({ data: ab, name: fname, ext: extFor(rec.mimeType || mime), dir: cfg.settings.storageDir || '' });
          recordedSound = {
            id: uid(), name: fname, path, volume: 100, plays: 0, addedAt: Date.now(),
            categoryId: null, favorite: false, norm: 1, shortcut: null,
            trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
          };
          status.textContent = 'Enregistrement prêt (' + fmtTime((Date.now() - recStart) / 1000) + ') : ' + path;
          previewBtn.disabled = false;
        } catch (e) {
          status.textContent = 'Sauvegarde impossible : ' + e.message;
        }
        streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
        stopLoose();
        window.sf.audioTapStop().catch(() => {});
        if (actx) { actx.close().catch(() => {}); actx = null; }
        startBtn.disabled = false; stopBtn.disabled = true;
        micSel.disabled = micOn.disabled = pcOn.disabled = cableOn.disabled = false;
      };
      rec.start(250);
      recStart = Date.now();
      recTimer = setInterval(() => { status.textContent = '● Enregistrement… ' + fmtTime((Date.now() - recStart) / 1000); }, 250);
      status.textContent = '● Enregistrement…';
      startBtn.disabled = true; stopBtn.disabled = false;
      micSel.disabled = micOn.disabled = pcOn.disabled = cableOn.disabled = true;
    } catch (e) {
      window.sf.uiLog('recorder start: ' + (e && e.name) + ' ' + (e && e.message));
      status.textContent = 'Source inaccessible : ' + e.message;
    }
  });

  stopBtn.addEventListener('click', () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {} });

  modal('Enregistreur', [
    field('Micro', el('div', { class: 'row' }, micOn, micSel), 'Voix via le périphérique d\'entrée choisi.'),
    field('Audio du PC', pcOn, 'Coche pour mixer ce que tu entends : voix Discord, musique, sons du jeu. Injecté dans le câble VB-CABLE le temps de l\'enregistrement (tu continues d\'entendre normalement).'),
    field('Câble SoundFart', cableOn, 'Coche pour ajouter ce qui passe dans le câble virtuel (sons de la soundboard + micro mixé).'),
    el('div', { class: 'hint', text: 'Tu peux combiner plusieurs sources : elles sont mixées avec un limiteur anti-saturation. Le son est enregistré en qualité numérique, sans passer par les haut-parleurs.' }),
    el('div', { class: 'row' }, startBtn, stopBtn, previewBtn),
    status,
    field('Nom', nameIn),
    field('Catégorie', catSel),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
      if (!recordedSound) { toast('Enregistre d\'abord un son.', 'warn'); return; }
      recordedSound.name = nameIn.value.trim() || recordedSound.name;
      recordedSound.categoryId = catSel.value || null;
      cfg.sounds.push(recordedSound);
      save(); renderAll(); c();
      toast('Son ajouté à la bibliothèque.');
      setTimeout(() => editSound(recordedSound), 60);
    } },
  ], { onClose: cleanup });
}

// ================================================================ import YouTube
const YT_RE = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//;

function youtubeModal() {
  const urlIn = el('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' });
  urlIn.style.flex = '1';
  const infoBox = el('div', { class: 'hint', text: 'Colle un lien YouTube puis « Analyser ».' });
  const startIn = el('input', { type: 'text', placeholder: '0 ou 02:15', value: '0' });
  const endIn = el('input', { type: 'text', placeholder: '13 ou 02:28', value: '' });
  startIn.style.flex = '1'; endIn.style.flex = '1';
  const nameIn = el('input', { type: 'text', placeholder: 'Nom du son (titre par défaut)' });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name })));
  const prog = el('div', { class: 'hint' });
  const bar = el('div', { class: 'ytbar' }, el('i'));
  const barFill = bar.firstChild;

  let info = null, dl = null, offProg = null, busy = false;
  const setProg = (p) => {
    if (p === -1 || p == null) { prog.textContent = 'Téléchargement…'; barFill.style.width = '100%'; barFill.style.opacity = '.4'; }
    else { prog.textContent = 'Téléchargement… ' + p + ' %'; barFill.style.opacity = '1'; barFill.style.width = p + '%'; }
  };

  const analyzeBtn = el('button', { text: 'Analyser', onclick: async () => {
    const url = urlIn.value.trim();
    if (!YT_RE.test(url)) { infoBox.textContent = 'Ce lien ne ressemble pas à une URL YouTube.'; return; }
    busy = true;
    infoBox.textContent = 'Vérification de l\'outil de téléchargement…';
    try {
      offProg = window.sf.onYtProgress(setProg);
      await window.sf.ytEnsure();
      infoBox.textContent = 'Lecture des infos de la vidéo…';
      info = await window.sf.ytInfo(url);
      infoBox.textContent = `« ${info.title} » — durée ${fmtTime(info.duration)}.`;
      if (!nameIn.value) nameIn.value = String(info.title).slice(0, 80);
      endIn.placeholder = info.duration ? 'Fin (max ' + fmtTime(info.duration) + ')' : 'Fin';
    } catch (e) {
      info = null;
      infoBox.textContent = 'Analyse impossible : ' + e.message;
    } finally {
      busy = false;
    }
  } });

  const dlBtn = el('button', { text: 'Télécharger l\'extrait', onclick: async () => {
    if (!info || busy) return;
    const start = parseTs(startIn.value);
    const end = parseTs(endIn.value);
    if (isNaN(start) || isNaN(end)) { prog.textContent = 'Heure invalide : utilise des secondes ou hh:mm:ss.'; return; }
    if (!(end > start)) { prog.textContent = 'La fin doit être après le début.'; return; }
    busy = true;
    dl = null;
    prog.textContent = 'Préparation…';
    barFill.style.width = '0%'; barFill.style.opacity = '1';
    try {
      offProg = offProg || window.sf.onYtProgress(setProg);
      const r = await window.sf.ytDownload({ url: urlIn.value.trim(), start, end, dir: cfg.settings.storageDir || '' });
      dl = { path: r.path, sectioned: r.sectioned, start, end };
      prog.textContent = r.sectioned
        ? 'Extrait MP3 prêt (' + fmtTime(end - start) + ').'
        : 'Audio complet téléchargé ; seul l\'extrait choisi sera joué (' + fmtTime(end - start) + ' sur ' + fmtTime(info.duration) + ').';
    } catch (e) {
      prog.textContent = 'Téléchargement impossible : ' + e.message;
    } finally {
      busy = false;
    }
  } });

  const previewBtn = el('button', { text: '▶ Écouter', onclick: () => {
    if (!dl) { prog.textContent = 'Télécharge d\'abord l\'extrait.'; return; }
    play({
      id: uid(), name: nameIn.value || 'YouTube', path: dl.path, volume: 100, plays: 0,
      norm: 1, favorite: false, shortcut: null,
      trimStart: dl.sectioned ? 0 : dl.start,
      trimEnd: dl.sectioned ? null : dl.end,
      fadeIn: 0, fadeOut: 0, addedAt: 0, categoryId: null,
    }, { monitorOnly: true, preview: true });
  } });

  modal('Importer depuis YouTube', [
    field('Lien YouTube', el('div', { class: 'row' }, urlIn, analyzeBtn)),
    infoBox,
    field('Extrait (secondes ou hh:mm:ss)', el('div', { class: 'row' },
      el('span', { class: 'hint', text: 'Début' }), startIn,
      el('span', { class: 'hint', text: 'Fin' }), endIn),
      'Ex. début « 02:15 », fin « 02:28 » pour un extrait de 13 s.'),
    el('div', { class: 'row' }, dlBtn, previewBtn),
    prog, bar,
    field('Nom', nameIn),
    field('Catégorie', catSel),
    el('div', { class: 'hint', text: 'Le fichier audio est enregistré dans le dossier « imports » de SoundFart. Respecte les droits d\'auteur et les conditions de YouTube.' }),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
      if (!dl) { toast('Télécharge d\'abord l\'extrait.', 'warn'); return; }
      const s = {
        id: uid(),
        name: nameIn.value.trim() || (info && info.title) || 'YouTube',
        path: dl.path,
        categoryId: catSel.value || null,
        volume: 100, addedAt: Date.now(), plays: 0,
        favorite: false, norm: 1, shortcut: null,
        trimStart: dl.sectioned ? 0 : dl.start,
        trimEnd: dl.sectioned ? null : dl.end,
        fadeIn: 0, fadeOut: 0,
      };
      cfg.sounds.push(s);
      save(); renderAll(); c();
      toast('Son YouTube ajouté.');
    } },
  ], { onClose: () => { if (offProg) offProg(); } });
}

// ================================================================ demarrage
async function init() {
  window.sf.getVersion().then((v) => { const e = $('#appVersion'); if (e) e.textContent = 'v' + v; }).catch(() => {});
  const saved = await window.sf.loadConfig();
  cfg = normalizeCfg(saved);

  // barre du haut & bas
  const sortSel = $('#sort');
  SORTS.forEach(([v, l]) => sortSel.append(el('option', { value: v, text: l, selected: v === cfg.settings.sort })));
  const catSortSel = $('#catSort');
  CAT_SORTS.forEach(([v, l]) => catSortSel.append(el('option', { value: v, text: l, selected: v === cfg.settings.catSort })));
  catSortSel.addEventListener('change', () => { cfg.settings.catSort = catSortSel.value; save(); renderSidebar(); });
  sortSel.addEventListener('change', () => { cfg.settings.sort = sortSel.value; save(); renderGrid(); });
  const groupCat = $('#groupCat');
  groupCat.checked = !!cfg.settings.groupByCat;
  groupCat.addEventListener('change', () => { cfg.settings.groupByCat = groupCat.checked; save(); renderAll(); });
  $('#search').addEventListener('input', renderGrid);
  $('#addBtn').addEventListener('click', async () => { const p = await window.sf.pickFiles(); if (p.length) addPaths(p); });
  $('#ytBtn').addEventListener('click', youtubeModal);
  $('#recBtn').addEventListener('click', () => recorderModal().catch((e) => toast('Enregistreur : ' + e.message, 'warn')));
  $('#addCat').addEventListener('click', newCategory);
  $('#openSettings').addEventListener('click', async () => { await refreshDevices(false); settingsModal(); });
  $('#stopBtn').addEventListener('click', () => stopAll(false));

  // menu application (F11)
  window.sf.onMenuAction(async (a) => {
    try {
      if (a === 'add') { const p = await window.sf.pickFiles(); if (p.length) addPaths(p); }
      else if (a === 'youtube') youtubeModal();
      else if (a === 'recorder') await recorderModal();
      else if (a === 'export') exportConfig();
      else if (a === 'import') importConfig();
      else if (a === 'settings') { await refreshDevices(false); settingsModal(); }
      else if (a === 'stop') stopAll(false);
      else if (a === 'search') { const i = $('#search'); i.focus(); i.select(); }
      else if (a === 'group') { cfg.settings.groupByCat = !cfg.settings.groupByCat; save(); renderAll(); }
      else if (a.startsWith('view:')) { cfg.ui.cat = a.slice(5); save(); renderAll(); }
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
  window.addEventListener('focus', checkMissing);
  navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices(false));

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
    if (paths.length) addPaths(paths);
  });

  // Bibliotheque vide (premier lancement) : injecter les sons par defaut bundled dans l'exe.
  if (!cfg.sounds.length && window.sf.seedSounds) {
    const defs = await window.sf.seedSounds();
    const now = Date.now();
    defs.forEach((d, i) => {
      cfg.sounds.push({
        id: uid(), name: d.name, path: d.path, categoryId: null,
        volume: 100, addedAt: now + i, plays: 0,
      });
    });
    if (defs.length) save();
  }

  renderAll();
  await refreshDevices(true);
  resolveDevices();
  save();
  checkMissing();
  const ok = await applyAudio();
  applyShortcuts();
  window.sf.audioAutoSetup({ enabled: cfg.settings.autoSwitchMic, cableLabel: cfg.settings.cableLabel }).then((r) => {
    if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
    else if (r && !r.ok) console.warn('bascule micro auto :', r.err);
  });
  window.sf.onCableReady(() => {
    toast('Composant audio virtuel installé — périphériques rechargés.');
    refreshDevices(false).then(async () => {
      resolveDevices();
      await applyAudio();
      window.sf.audioAutoSetup({ enabled: cfg.settings.autoSwitchMic, cableLabel: cfg.settings.cableLabel })
        .then((r) => { if (r && r.changed) toast('Entrée micro basculée sur ' + r.device); });
    });
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

init();
