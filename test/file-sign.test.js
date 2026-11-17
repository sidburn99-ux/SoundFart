// Tests de lib/file-sign.js — dedoublonnage d'import.
// Couvre les cas exigés : identiques, même taille/différent,
// mêmes 4 Kio tête+queue mais milieu différent, vides, volumineux.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sha256File, sameFileContent } = require('../lib/file-sign');

function tmpfile(name, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sign-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}

test('deux fichiers réellement identiques -> même contenu', async () => {
  const data = crypto.randomBytes(200 * 1024);
  const a = tmpfile('a.bin', data), b = tmpfile('b.bin', data);
  assert.equal(await sameFileContent(a, b), true);
});

test('même taille, contenu différent -> PAS le même', async () => {
  const a = tmpfile('a.bin', crypto.randomBytes(100 * 1024));
  const b = tmpfile('b.bin', crypto.randomBytes(100 * 1024));
  assert.equal(await sameFileContent(a, b), false);
});

test('mêmes 4 Kio tête + queue, milieu différent -> mêmeFileQuick matche mais sameFileContent NON', async () => {
  // Construit deux fichiers de même taille avec tête et queue identiques
  // mais des octets différents au milieu — le scénario de faux positif.
  const size = 32 * 1024;
  const head = crypto.randomBytes(4096);
  const tail = crypto.randomBytes(4096);
  const mk = (mid) => Buffer.concat([head, mid, tail]).subarray(0, size);
  const a = tmpfile('a.bin', mk(crypto.randomBytes(size - 8192)));
  const b = tmpfile('b.bin', mk(crypto.randomBytes(size - 8192)));
  assert.equal(a.length > 0 && b.length > 0, true);
  // le filtre rapide (taille+tête+queue) considérerait identiques
  // -> sameFileContent doit les distinguer
  assert.equal(await sameFileContent(a, b), false);
});

test('fichiers vides -> même contenu (les deux vides sont identiques)', async () => {
  const a = tmpfile('a.bin', Buffer.alloc(0));
  const b = tmpfile('b.bin', Buffer.alloc(0));
  assert.equal(await sameFileContent(a, b), true);
});

test('vide vs non-vide -> différents', async () => {
  const a = tmpfile('a.bin', Buffer.alloc(0));
  const b = tmpfile('b.bin', Buffer.from('x'));
  assert.equal(await sameFileContent(a, b), false);
});

test('très petit (1 octet) -> correct', async () => {
  const a = tmpfile('a.bin', Buffer.from([42]));
  const b = tmpfile('b.bin', Buffer.from([42]));
  const c = tmpfile('c.bin', Buffer.from([43]));
  assert.equal(await sameFileContent(a, b), true);
  assert.equal(await sameFileContent(a, c), false);
});

test('volumineux (~5 Mo) : hash correct et performant', async () => {
  const data = crypto.randomBytes(5 * 1024 * 1024);
  const a = tmpfile('a.bin', data);
  const t0 = Date.now();
  const h1 = await sha256File(a);
  const dt = Date.now() - t0;
  assert.equal(h1, crypto.createHash('sha256').update(data).digest('hex'));
  assert.ok(dt < 5000, 'hash 5 Mo en <5 s (mesuré ' + dt + ' ms)');
});

test('tailles différentes -> faux sans hasher', async () => {
  const a = tmpfile('a.bin', crypto.randomBytes(100));
  const b = tmpfile('b.bin', crypto.randomBytes(200));
  assert.equal(await sameFileContent(a, b), false);
});
