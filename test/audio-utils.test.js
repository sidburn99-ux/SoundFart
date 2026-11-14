const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../lib/audio-utils.js');

// ---------- parseEndpoints / parseGet ----------
test('parseEndpoints : flow|id|nom, pipes dans le nom', () => {
  const eps = U.parseEndpoints('render|{a}|CABLE Input\r\ncapture|{b}|Micro (G930)\n');
  assert.equal(eps.length, 2);
  assert.deepEqual(eps[0], { flow: 'render', id: '{a}', name: 'CABLE Input' });
  assert.equal(eps[1].flow, 'capture');
  const weird = U.parseEndpoints('capture|{x}|Nom|avec|pipes');
  assert.equal(weird[0].name, 'Nom|avec|pipes');
});

test('parseGet : console/comm/multi', () => {
  const g = U.parseGet('console={1}\ncomm={2}\nmulti={3}\n');
  assert.deepEqual(g, { console: '{1}', comm: '{2}', multi: '{3}' });
  assert.deepEqual(U.parseGet(''), { console: '', comm: '', multi: '' });
});

// ---------- findCableCapture / hasVirtualCable ----------
const EP = [
  { flow: 'render', id: 'r1', name: 'Haut-parleurs (Realtek)' },
  { flow: 'render', id: 'r2', name: 'CABLE Input' },
  { flow: 'capture', id: 'c1', name: 'Micro (G930)' },
  { flow: 'capture', id: 'c2', name: 'CABLE Output' },
];

test('findCableCapture : label CABLE Input -> CABLE Output', () => {
  assert.equal(U.findCableCapture(EP, 'CABLE Input').id, 'c2');
  assert.equal(U.findCableCapture(EP, '').id, 'c2'); // fallback /output/ + virtuel
});

test('findCableCapture : noms localises / variantes', () => {
  const eps = [
    { flow: 'capture', id: 'fr', name: 'Sortie du cable virtuel' },
    { flow: 'capture', id: 'real', name: 'Micro' },
  ];
  assert.equal(U.findCableCapture(eps, 'Entree du cable').id, 'fr'); // via /cable/
  assert.equal(U.findCableCapture(EP, 'Inconnu XYZ').id, 'c2'); // fallback output+cable
  assert.equal(U.findCableCapture([{ flow: 'capture', id: 'm', name: 'Micro' }], ''), null === undefined ? null : U.findCableCapture([{ flow: 'capture', id: 'm', name: 'Micro' }], ''));
});

test('findCableCapture : pas de capture -> null', () => {
  assert.equal(U.findCableCapture([{ flow: 'render', id: 'r', name: 'CABLE Input' }], 'CABLE Input'), null);
});

test('hasVirtualCable : specifique VB-CABLE, pas Voicemeeter', () => {
  assert.equal(U.hasVirtualCable([{ flow: 'render', id: '1', name: 'CABLE Input' }]), true);
  assert.equal(U.hasVirtualCable([{ flow: 'render', id: '1', name: 'Voicemeeter Input' }]), false);
  assert.equal(U.hasVirtualCable([{ flow: 'capture', id: '1', name: 'CABLE Output' }]), false);
});

// ---------- chooseRestoreIds (restauration micro) ----------
const RESTORE_EPS = [
  { flow: 'capture', id: 'g930', name: 'Microphone (G930)' },
  { flow: 'capture', id: 'cable', name: 'CABLE Output' },
];

test('restauration : micro d origine disparu -> defaut Windows ou 1er non virtuel', () => {
  const prev = { console: '{gone}', comm: '{gone2}' };
  const cur = { console: '', comm: '', multi: 'g930' };
  const r = U.chooseRestoreIds(RESTORE_EPS, prev, cur);
  assert.equal(r.consoleId, 'g930'); // multi non virtuel = defaut
  assert.equal(r.commId, 'g930');
});

test('restauration : sans defaut multi -> ids d origine puis fallback', () => {
  const prev = { console: 'g930', comm: 'g930' };
  const r = U.chooseRestoreIds(RESTORE_EPS, prev, { console: '', comm: '', multi: 'cable' });
  assert.equal(r.consoleId, 'g930');
  assert.equal(r.multiId, 'g930');
});

test('restauration : que des peripheriques virtuels -> chaine vide', () => {
  const eps = [{ flow: 'capture', id: 'cable', name: 'CABLE Output' }];
  const r = U.chooseRestoreIds(eps, { console: 'cable', comm: 'cable' }, { console: 'cable', comm: 'cable', multi: 'cable' });
  assert.equal(r.consoleId, '');
  assert.equal(r.commId, '');
  assert.equal(r.fallbackId, '');
});

test('restauration : crash (prev ids perimes) -> fallback non virtuel', () => {
  const eps = [
    { flow: 'capture', id: 'usb', name: 'Micro USB' },
    { flow: 'capture', id: 'cable', name: 'CABLE Output' },
  ];
  const r = U.chooseRestoreIds(eps, { console: '{dead}', comm: '{dead}' }, { console: '', comm: '', multi: '' });
  assert.equal(r.consoleId, 'usb');
  assert.equal(r.commId, 'usb');
});

// ---------- safeName / parseTs / fmtTime ----------
test('safeName : caracteres interdits, espaces, vide', () => {
  assert.equal(U.safeName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(U.safeName('  trop   d\'espaces  '), 'trop d\'espaces');
  assert.equal(U.safeName(''), 'son');
  assert.equal(U.safeName(null), 'son');
  assert.ok(U.safeName('x'.repeat(200)).length <= 80);
});

test('parseTs : mm:ss, secondes, invalide', () => {
  assert.equal(U.parseTs(''), 0);
  assert.equal(U.parseTs('90'), 90);
  assert.equal(U.parseTs('1:30'), 90);
  assert.equal(U.parseTs('1:30.5'), 90.5);
  assert.ok(Number.isNaN(U.parseTs('abc')));
  assert.ok(Number.isNaN(U.parseTs('1:2:3:4')));
});

test('fmtTime : affichage m:ss.d', () => {
  assert.equal(U.fmtTime(0), '0:00.0');
  assert.equal(U.fmtTime(65.25), '1:05.3');
  assert.equal(U.fmtTime(600), '10:00.0');
});

// ---------- expandPaths ----------
test('expandPaths : audio seulement, profondeur, dossiers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'c.wav'), 'x');
    fs.mkdirSync(path.join(dir, 'sub', 'deep', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'c.wav'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'd.flac'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'e.mp3'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'deeper', 'f.mp3'), 'x'); // trop profond -> exclu
    const out = U.expandPaths([dir]);
    const names = out.map((p) => path.basename(p)).sort();
    assert.deepEqual(names, ['a.mp3', 'c.wav', 'd.flac', 'e.mp3']);
    // inexistants ignores sans exception
    assert.deepEqual(U.expandPaths([path.join(dir, 'nope'), path.join(dir, 'b.txt')]), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
