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
  assert.equal(U.findCableCapture([{ flow: 'capture', id: 'm', name: 'Micro' }], 'CABLE'), null);
});

test('findCableCapture : pas de capture -> null', () => {
  assert.equal(U.findCableCapture([{ flow: 'render', id: 'r', name: 'CABLE Input' }], 'CABLE Input'), null);
});

test('parseEndpoints : lignes malformees ne produisent pas de name undefined', () => {
  const eps = U.parseEndpoints('capture|{x}\n|\ntexte-sans-separateur\nrender|{r}|OK');
  for (const e of eps) {
    assert.equal(typeof e.flow, 'string');
    assert.equal(typeof e.id, 'string');
    assert.equal(typeof e.name, 'string'); // findCableCapture fait name.toLowerCase()
  }
  // Une sortie AudioEndpoint polluee ne doit pas faire planter findCableCapture.
  assert.doesNotThrow(() => U.findCableCapture(eps, 'CABLE'));
});

test('realDevices : placeholders deviceId vide filtres', () => {
  const placeholders = [
    { kind: 'audioinput', deviceId: '', label: '' },
    { kind: 'audiooutput', deviceId: '', label: '' },
  ];
  assert.equal(U.realDevices(placeholders).length, 0); // => detection degradee
  const complete = [
    { kind: 'audioinput', deviceId: 'abc', label: 'Micro G930' },
    { kind: 'audiooutput', deviceId: 'def', label: 'CABLE Input' },
  ];
  assert.equal(U.realDevices(complete).length, 2);
  assert.deepEqual(U.realDevices(null), []);
});

test('safeName : noms reserves Windows prefixes', () => {
  assert.equal(U.safeName('CON'), '_CON');
  assert.equal(U.safeName('nul.txt'), '_nul.txt');
  assert.equal(U.safeName('com1'), '_com1');
  assert.equal(U.safeName('LPT9.mp3'), '_LPT9.mp3');
  assert.equal(U.safeName('normal.mp3'), 'normal.mp3');
  assert.equal(U.safeName('console.mp3'), 'console.mp3'); // pas un nom reserve
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

// ---------- expandPathsAsync (meme contrat que expandPaths, non bloquant) ----------
test('expandPathsAsync : memes resultats que la version synchrone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-async-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'c.wav'), 'x');
    const sync = U.expandPaths([dir]).map((p) => path.basename(p)).sort();
    const asy = (await U.expandPathsAsync([dir])).map((p) => path.basename(p)).sort();
    assert.deepEqual(asy, sync);
    assert.deepEqual(asy, ['a.mp3', 'c.wav']);
    assert.deepEqual(await U.expandPathsAsync([path.join(dir, 'nope')]), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- writeRecording (extrait de rec:save, SF-REL-0058) ----------
test('writeRecording : nom libre, collision -> suffixe, ext invalide -> .webm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rec-'));
  try {
    const b1 = await U.writeRecording(dir, 'Mon Prise#1', '.webm', Buffer.from('aaa'));
    assert.equal(path.basename(b1), 'Mon Prise#1.webm'); // safeName : espaces gardes, # autorise
    assert.equal(fs.readFileSync(b1, 'utf8'), 'aaa');
    // Collision : meme nom -> -1
    const b2 = await U.writeRecording(dir, 'Mon Prise#1', '.webm', Buffer.from('bbb'));
    assert.equal(path.basename(b2), 'Mon Prise#1-1.webm');
    // Ext non whitelist -> .webm
    const b3 = await U.writeRecording(dir, 'x', '.exe', Buffer.from('c'));
    assert.ok(b3.endsWith('.webm'));
    // Nom vide -> safeName produit un nom non vide
    const b4 = await U.writeRecording(dir, '   ', '.wav', Buffer.from('d'));
    assert.ok(path.basename(b4).length > 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- tests de proprietes / concurrence ----------
test('writeRecording : N ecritures concurrentes meme nom -> N fichiers distincts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-recpar-'));
  try {
    const N = 20;
    const paths = await Promise.all(Array.from({ length: N }, (_, i) =>
      U.writeRecording(dir, 'prise', '.webm', Buffer.from('data' + i))));
    assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, N, 'aucun ecrasement');
    // Tous les fichiers existent et sont non vides
    for (const p of paths) assert.ok(fs.statSync(p).size > 0);
    // Aucun .part residuel
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('safeName : jamais de nom Windows invalide, jamais vide', () => {
  const bad = ['CON', 'con.mp3', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', '...', '   ', 'a/b\c:d*e?f"g<h>i|j', 'x'.repeat(200), '', null, undefined];
  for (const n of bad) {
    const s = U.safeName(n);
    assert.ok(s && s.length > 0 && s.length <= 80, 'safeName(' + JSON.stringify(n) + ') -> ' + JSON.stringify(s));
    assert.ok(!/[\/:*?"<>|]/.test(s.split('.')[0] === s ? s : s), 'chars invalides: ' + s);
  }
  // Extreemement long -> tronque a 80
  assert.ok(U.safeName('y'.repeat(300)).length <= 80);
});

test('parseEndpoints : fuzz — jamais de crash, champs toujours des chaines', () => {
  const inputs = ['', '\n', '|', '|||', 'a|b', 'render|{1}|Name With | Pipe', 'capture|{2}|', '\r\n\r\n', 'x'.repeat(10000), 'flow|id|nom\x00ctl'];
  for (const inp of inputs) {
    const out = U.parseEndpoints(inp);
    for (const e of out) {
      assert.equal(typeof e.flow, 'string');
      assert.equal(typeof e.id, 'string');
      assert.equal(typeof e.name, 'string');
    }
  }
});

test('chooseRestoreIds : endpoint sans nom jamais choisi comme fallback', () => {
  // Regression SF-REL-0140 : name='' passait VIRTUAL_RE.test('') ->
  // un endpoint virtuel sans nom etait traite « non virtuel ».
  const eps = [
    { flow: 'capture', id: '{noname}', name: '' },
    { flow: 'capture', id: '{virt}', name: 'CABLE Output (VB-Audio Virtual Cable)' },
    { flow: 'capture', id: '{real}', name: 'Micro Realtek' },
  ];
  const r = U.chooseRestoreIds(eps, { console: '', comm: '', multi: '' }, { console: '', comm: '', multi: '' });
  // Le fallback doit etre le vrai micro nomme, pas {noname} ni le cable.
  const all = [r.consoleId, r.commId, r.multiId, r.fallbackId].filter(Boolean);
  assert.ok(!all.includes('{noname}'), 'endpoint sans nom choisi');
  assert.ok(all.includes('{real}'), 'le vrai micro doit etre candidat');
});

test('parseTs : fuzz bornes et formats', () => {
  const good = [['90', 90], ['1:30', 90], ['1:02:03', 3723], ['0', 0], ['  45.5 ', 45.5], ['', 0], [null, 0]];
  for (const [v, exp] of good) assert.equal(U.parseTs(v), exp, v);
  const bad = ['abc', '1:2:3:4', '-5', '1,5', {}, 'NaN', '1:2:3:4:5'];
  for (const v of bad) assert.ok(Number.isNaN(U.parseTs(v)), JSON.stringify(v));
});

test('cbOrNoop : normalise les callbacks (SF-REL-0612/0614)', () => {
  // Le defaut historique : onProgress undefined/null/non-fonction
  // provoquait TypeError dans un handler -> mort du process main.
  for (const v of [undefined, null, 0, 'x', {}, [], true]) {
    const cb = U.cbOrNoop(v);
    assert.equal(typeof cb, 'function');
    assert.doesNotThrow(() => cb(0.5), JSON.stringify(v));
  }
  let called = 0;
  const real = U.cbOrNoop((f) => { called++; assert.equal(f, 0.5); });
  real(0.5);
  assert.equal(called, 1);
});
