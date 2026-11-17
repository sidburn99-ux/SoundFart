// Tests de lib/import.js — import audio avec dedoublonnage et concurrence.
// Scénarios : imports simultanés même nom/contenus différents, doublon réel,
// même taille/contenu différent (faux positif sameFileQuick), nettoyage .part.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { importAudioFiles, enqueueImport } = require('../lib/import');

function dirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-imp-'));
  return { base, root: path.join(base, 'storage'), src: path.join(base, 'src') };
}
function mkSrc(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}
const sons = (root) => path.join(root, 'sons');

test('import simple : fichier copié dans sons/', async () => {
  const { root, src } = dirs();
  const s = mkSrc(src, 'a.mp3', crypto.randomBytes(5000));
  const out = await importAudioFiles([s], root);
  assert.equal(out.length, 1);
  assert.equal(out[0].error, undefined);
  assert.equal(fs.readFileSync(out[0].path).length, 5000);
  assert.ok(out[0].path.startsWith(sons(root)));
});

test('deux imports simultanés, même nom, contenus DIFFÉRENTS : aucun écrasement', async () => {
  const { root, src } = dirs();
  const d1 = path.join(src, 'd1'), d2 = path.join(src, 'd2');
  const s1 = mkSrc(d1, 'son.mp3', crypto.randomBytes(8000));
  const s2 = mkSrc(d2, 'son.mp3', crypto.randomBytes(8000));
  // Même taille mais contenu différent -> ni doublon ni écrasement
  const data1 = fs.readFileSync(s1), data2 = fs.readFileSync(s2);
  assert.notDeepEqual(data1, data2);
  // Les deux en parallèle via la file d'attente (comme deux IPC concurrents)
  const [o1, o2] = await Promise.all([
    enqueueImport(root, () => importAudioFiles([s1], root)),
    enqueueImport(root, () => importAudioFiles([s2], root)),
  ]);
  assert.equal(o1[0].error, undefined);
  assert.equal(o2[0].error, undefined);
  assert.notEqual(o1[0].path, o2[0].path, 'deux cibles distinctes attendues');
  const f1 = fs.readdirSync(sons(root)).sort();
  // Les deux fichiers doivent exister avec leur contenu d'origine
  const contents = f1.map((f) => fs.readFileSync(path.join(sons(root), f)));
  assert.ok(contents.some((c) => c.equals(data1)), 'contenu 1 présent');
  assert.ok(contents.some((c) => c.equals(data2)), 'contenu 2 présent');
});

test('deux imports du MÊME fichier : réutilisation, pas de doublon', async () => {
  const { root, src } = dirs();
  const s = mkSrc(src, 'meme.mp3', crypto.randomBytes(4000));
  const [o1, o2] = await Promise.all([
    enqueueImport(root, () => importAudioFiles([s], root)),
    enqueueImport(root, () => importAudioFiles([s], root)),
  ]);
  assert.equal(o1[0].path, o2[0].path);
  const files = fs.readdirSync(sons(root));
  assert.equal(files.filter((f) => f.endsWith('.mp3')).length, 1, 'un seul fichier');
});

test('même nom + mêmes 4 Kio tête/queue mais milieu différent : PAS de substitution', async () => {
  const { root, src } = dirs();
  const size = 32 * 1024;
  const head = crypto.randomBytes(4096), tail = crypto.randomBytes(4096);
  const mk = (mid) => Buffer.concat([head, mid, tail]).subarray(0, size);
  // d1 importé d'abord, puis d2 : le filtre quick matche, le SHA-256 doit refuser
  const s1 = mkSrc(path.join(src, 'd1'), 'x.mp3', mk(crypto.randomBytes(size - 8192)));
  const s2 = mkSrc(path.join(src, 'd2'), 'x.mp3', mk(crypto.randomBytes(size - 8192)));
  await importAudioFiles([s1], root);
  const o2 = await importAudioFiles([s2], root);
  assert.equal(o2[0].error, undefined);
  // Le second doit avoir atterri sous un AUTRE nom, pas réutilisé à tort
  const files = fs.readdirSync(sons(root)).sort();
  assert.equal(files.length, 2, 'deux fichiers distincts, pas de substitution');
  assert.notEqual(o2[0].path, path.join(sons(root), 'x.mp3'));
});

test('même nom + contenu strictement identique : réutilisé (vrai doublon)', async () => {
  const { root, src } = dirs();
  const data = crypto.randomBytes(6000);
  const s1 = mkSrc(path.join(src, 'd1'), 'y.mp3', data);
  const s2 = mkSrc(path.join(src, 'd2'), 'y.mp3', data);
  await importAudioFiles([s1], root);
  const o2 = await importAudioFiles([s2], root);
  assert.equal(o2[0].path, path.join(sons(root), 'y.mp3'), 'réutilisation du doublon réel');
  assert.equal(fs.readdirSync(sons(root)).length, 1);
});

test('import avec un fichier illisible : erreur par fichier, lot continue', async () => {
  const { root, src } = dirs();
  const ok = mkSrc(src, 'ok.mp3', crypto.randomBytes(1000));
  const bad = path.join(src, 'fantome.mp3'); // inexistant
  const out = await importAudioFiles([bad, ok], root);
  assert.equal(out.length, 2);
  assert.equal(out[0].error, 'illisible');
  assert.equal(out[1].error, undefined);
});

test('aucun .part résiduel après import', async () => {
  const { root, src } = dirs();
  const s = mkSrc(src, 'z.mp3', crypto.randomBytes(2000));
  await importAudioFiles([s], root);
  assert.equal(fs.readdirSync(sons(root)).filter((f) => f.endsWith('.part')).length, 0);
});

test('extensions non audio ignorées silencieusement', async () => {
  const { root, src } = dirs();
  const txt = mkSrc(src, 'note.txt', 'hello');
  const out = await importAudioFiles([txt], root);
  assert.equal(out.length, 0);
});
