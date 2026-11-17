// Tests de normalizeCfg (src/app.js) — la fonction n'est pas exportee et
// vit dans un script navigateur : on en extrait les declarations utiles
// par marqueurs et on les evalue dans un contexte minimal. Fragile par
// nature : si app.js est restructure, ce test doit etre ajuste (mieux
// vaut un test qui casse qu'une fonction critique non couverte).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/audio-utils');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf-8');

// Extrait un bloc entre deux chaines marqueurs (incluses).
const between = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, 'marqueurs introuvables : ' + a.slice(0, 40));
  return src.slice(i, j);
};

// normalizeCfg + ses dependances pures, re-evalues hors DOM.
const code = [
  between('const PALETTE =', 'const $ ='),
  between('const defaults =', 'let saveErrNotified'),
  between('function normalizeCfg(saved)', 'const catById'),
  between('const RESERVED_SC =', 'function findShortcutOwner'),
  'return normalizeCfg;',
].join('\n');

const normalizeCfg = new Function('window', 'uiLog', code)(
  { SFUtils: U },
  () => {},
);

let sndSeq = 0;
const mkSound = (over = {}) => Object.assign({
  id: 's' + Math.random().toString(36).slice(2, 8),
  name: 'son', path: 'C:\\sons\\s' + (sndSeq++) + '.mp3', volume: 100, plays: 0,
}, over);

// ---------- fuzz : jamais de crash, toujours un objet coherent ----------
test('normalizeCfg : entrees adverses ne jettent jamais', () => {
  const junk = [null, undefined, 0, 'x', [], true, {}, { sounds: 'x' }, { settings: 42 }, { categories: null }, { ui: 'no' }];
  for (const j of junk) {
    const c = normalizeCfg(j);
    assert.ok(c && Array.isArray(c.sounds) && Array.isArray(c.categories));
    assert.ok(Number.isFinite(+c.settings.master));
  }
});

test('normalizeCfg : __proto__ dans le JSON importe ne pollue pas', () => {
  const parsed = JSON.parse('{"__proto__":{"master":0,"polluted":true},"sounds":[],"settings":{"master":50}}');
  const c = normalizeCfg(parsed);
  assert.equal({}.polluted, undefined);
  assert.equal(c.settings.master, 50);
  assert.equal(c.settings.polluted, undefined);
});

test('normalizeCfg : ids/chemins invalides purges, doublons dedupliques', () => {
  const c = normalizeCfg({
    sounds: [
      mkSound({ id: '__stop__', path: 'C:\\a.mp3' }),       // id reserve STOP
      mkSound({ id: 'ok1', path: 'relative/path.mp3' }),   // non absolu -> drop
      mkSound({ id: 'ok2', path: 'C:\\b.mp3' }),
      mkSound({ id: 'ok2', path: 'C:\\c.mp3' }),            // id duplique -> drop
      mkSound({ id: 'ok3', path: 'C:\\B.MP3' }),            // path duplique CI -> drop
      mkSound({ id: 'ok4', path: 'C:\\d.mp3', name: 42 }),  // name non-string -> drop
    ],
    categories: [
      { id: 'c1', name: 'A', color: '#fff' },
      { id: 'c1', name: 'B' },                              // id duplique -> drop
      { id: 'c2', name: 'C', color: 'pas-une-couleur' },    // couleur invalide -> palette
    ],
  });
  // ok4 (name:42) droppe ; ok3 (C:\B.MP3) = doublon CI de C:\b.mp3 -> droppe
  assert.equal(c.sounds.length, 1);
  assert.equal(c.sounds[0].id, 'ok2');
  assert.equal(c.categories.length, 2);
  assert.match(c.categories[1].color, /^#/);
});

test('normalizeCfg : bornes settings (normLufs, maxSoundDur, voiceDspLvl, master)', () => {
  const c = normalizeCfg({ settings: { normLufs: 5, maxSoundDur: -3, voiceDspLvl: 9, master: 250 } });
  assert.equal(c.settings.normLufs, -18);   // >0 invalide -> defaut
  assert.equal(c.settings.maxSoundDur, 45); // negatif -> defaut
  assert.equal(c.settings.voiceDspLvl, 2);  // hors 1-4 -> defaut
  assert.equal(c.settings.master, 100);     // borne haute
  const c2 = normalizeCfg({ settings: { normLufs: -30, maxSoundDur: 0, voiceDspLvl: 4, master: -5 } });
  assert.equal(c2.settings.normLufs, -30);
  assert.equal(c2.settings.maxSoundDur, 0); // 0 = illimite, conserve
  assert.equal(c2.settings.voiceDspLvl, 4);
  assert.equal(c2.settings.master, 0);
});

test('normalizeCfg : raccourcis — doublons CI, stopShortcut et reserved purges', () => {
  const c = normalizeCfg({
    settings: { stopShortcut: 'Ctrl+Alt+S' },
    sounds: [
      mkSound({ id: 'a', shortcut: 'Ctrl+1' }),
      mkSound({ id: 'b', shortcut: 'ctrl+1' }),   // doublon CI -> null
      mkSound({ id: 'c', shortcut: 'Ctrl+Alt+S' }), // = STOP -> null
      mkSound({ id: 'd', shortcut: 'F11' }),       // reserved -> null
      mkSound({ id: 'e', shortcut: 'CommandOrControl+2' }),
      mkSound({ id: 'f', shortcut: 'Ctrl+2' }),    // equivalent Windows -> null
    ],
  });
  const byId = Object.fromEntries(c.sounds.map((s) => [s.id, s.shortcut]));
  assert.equal(byId.a, 'Ctrl+1');
  assert.equal(byId.b, null);
  assert.equal(byId.c, null);
  assert.equal(byId.d, null);
  assert.equal(byId.e, 'CommandOrControl+2');
  assert.equal(byId.f, null);
});

test('normalizeCfg : stopShortcut reserved remplace par defaut', () => {
  const c = normalizeCfg({ settings: { stopShortcut: 'F12' } });
  assert.equal(c.settings.stopShortcut, 'CommandOrControl+Alt+S');
});

test('normalizeCfg : plafonds 5000 sons / 500 categories / noms tronques', () => {
  const sounds = Array.from({ length: 5001 }, (_, i) => mkSound({ id: 's' + i, path: 'C:\\' + i + '.mp3' }));
  const c = normalizeCfg({ sounds, categories: Array.from({ length: 501 }, (_, i) => ({ id: 'k' + i, name: 'c' + i })) });
  assert.equal(c.sounds.length, 5000);
  assert.equal(c.categories.length, 500);
  const long = normalizeCfg({ sounds: [mkSound({ id: 'x'.repeat(500), name: 'n'.repeat(500), path: 'C:\\x.mp3' })] });
  assert.ok(long.sounds[0].id.length <= 128);
  assert.ok(long.sounds[0].name.length <= 200);
});

test('normalizeCfg : valeurs numeriques aberrantes coercees (NaN, strings, negatives)', () => {
  const c = normalizeCfg({ sounds: [mkSound({ volume: 'abc', norm: -2, plays: NaN, addedAt: 'x', trimStart: -1, fadeIn: '2' })] });
  const s = c.sounds[0];
  assert.equal(s.volume, 100);
  assert.equal(s.norm, 1);
  assert.equal(s.plays, 0);
  assert.equal(s.addedAt, 0);
  assert.equal(s.trimStart, 0);
  assert.equal(s.fadeIn, 2); // string numerique coercie
});

test('normalizeCfg : migration v1->v2 invalide les norm heritees', () => {
  const c = normalizeCfg({ version: 1, sounds: [mkSound({ norm: 3.7 })] });
  assert.equal(c.sounds[0].norm, 1);
  assert.equal(c.version, 2);
  const c2 = normalizeCfg({ version: 2, sounds: [mkSound({ norm: 1.5 })] });
  assert.equal(c2.sounds[0].norm, 1.5);
});
