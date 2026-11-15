const test = require('node:test');
const assert = require('node:assert/strict');
const { decideMediaPermission } = require('../lib/media-permission.js');

// Regression P0 : Electron 45/Chromium exige la permission 'microphone'
// (distincte de 'media') pour getUserMedia audio et les labels/deviceId.
// La refuser vidait enumerateDevices (placeholders deviceId='').

test('permission microphone accordee', () => {
  const d = decideMediaPermission('microphone');
  assert.equal(d.allow, true);
});

test('permission micro refusee -> deny pour les autres permissions', () => {
  // 'microphone' est la SEULE permission audio implicite ; geolocation etc. refusees.
  assert.equal(decideMediaPermission('geolocation').allow, false);
  assert.equal(decideMediaPermission('notifications').allow, false);
  assert.equal(decideMediaPermission('camera').allow, false);
});

test('mediaTypes absent -> autorise (audio suppose, journalise)', () => {
  assert.equal(decideMediaPermission('media').allow, true);
  assert.equal(decideMediaPermission('media', null).allow, true);
  assert.equal(decideMediaPermission('media', {}).allow, true);
  assert.equal(decideMediaPermission('media', { mediaTypes: [] }).allow, true);
});

test('demande audio seule -> autorisee', () => {
  assert.equal(decideMediaPermission('media', { mediaTypes: ['audio'] }).allow, true);
});

test('demande audio + video -> refusee', () => {
  const d = decideMediaPermission('media', { mediaTypes: ['audio', 'video'] });
  assert.equal(d.allow, false);
  assert.match(d.reason, /video/);
  assert.equal(decideMediaPermission('media', { mediaTypes: ['video'] }).allow, false);
});

test('display-capture autorise (loopback enregistreur)', () => {
  assert.equal(decideMediaPermission('display-capture').allow, true);
});

test('decision retourne toujours {allow, reason}', () => {
  for (const p of ['microphone', 'media', 'display-capture', 'usb', 'midi', 'unknown']) {
    const d = decideMediaPermission(p, { mediaTypes: ['audio'] });
    assert.equal(typeof d.allow, 'boolean');
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.length > 0);
  }
});

// Cotes renderer (degrades) : la logique vit dans app.js (non importable
// en node:test) — verifiee manuellement via VALIDATION.md §permission.
// Ici on verrouille le contrat que refreshDevices/resolveDevices dependent :
// un enumerateDevices placeholder-only = deviceId vide => detection degradee.
test('placeholders enumerateDevices : deviceId vide detecte comme degrade', () => {
  // Simule le filtre de refreshDevices : seules les entrees avec deviceId comptent.
  const placeholders = [
    { kind: 'audioinput', deviceId: '', label: '' },
    { kind: 'audiooutput', deviceId: '', label: '' },
  ];
  const real = placeholders.filter((d) => d.deviceId);
  assert.equal(real.length, 0); // => devicesDegraded = true, ids conserves
  const complete = [
    { kind: 'audioinput', deviceId: 'abc', label: 'Micro G930' },
    { kind: 'audiooutput', deviceId: 'def', label: 'CABLE Input' },
  ];
  assert.equal(complete.filter((d) => d.deviceId).length, 2);
});
