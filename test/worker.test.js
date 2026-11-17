'use strict';
// Tests node:test pour service/worker.js — le handler fetch est exerce
// directement avec un env simule et un fetch() global stubbe qui capture
// les PUT vers l'API GitHub (simulation : AUCUN appel reseau reel).
// Verifie : healthz, rejets (methode, content-type, JSON, taille, volume),
// sanitization serveur des chemins/secrets, dedup batch, rate-limit IP,
// et que le contenu stocke dans le depot est bien sanitize.
const test = require('node:test');
const assert = require('node:assert/strict');

const worker = require('../service/worker.js');
const w = worker.default || worker;

const ENV = { GITHUB_TOKEN: 'fake-token-test', GITHUB_REPO: 'sidburn99-ux/SoundFart-reports', GITHUB_BRANCH: 'main' };

let ipSeq = 0;
const req = (path, init = {}, ip) => new Request('https://worker.test' + (path || '/'), {
  ...init,
  headers: { 'CF-Connecting-IP': ip || ('10.0.0.' + (++ipSeq)), ...(init.headers || {}) },
});
const post = (body, ip, headers = {}) => req('/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}, ip);

// Capture les appels sortants (api.github.com) sans reseau.
function stubGitHub(responder) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return responder ? responder(url, opts) : { ok: true, status: 201 };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const decodePut = (call) => JSON.parse(Buffer.from(JSON.parse(call.opts.body).content, 'base64').toString('utf8'));

test('healthz repond 200', async () => {
  const r = await w.fetch(req('/healthz'), ENV);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('methode non-POST rejetee (405)', async () => {
  const r = await w.fetch(req('/'), ENV);
  assert.equal(r.status, 405);
});

test('Content-Type non-JSON rejete (415)', async () => {
  const r = await w.fetch(post('{}', null, { 'Content-Type': 'text/plain' }), ENV);
  assert.equal(r.status, 415);
});

test('JSON invalide rejete (400)', async () => {
  const r = await w.fetch(post('{bad', null), ENV);
  assert.equal(r.status, 400);
});

test('reports[] absent ou vide rejete (400)', async () => {
  for (const b of [{}, { reports: [] }, { reports: 'x' }]) {
    const r = await w.fetch(post(b, null), ENV);
    assert.equal(r.status, 400);
  }
});

test('plus de 20 rapports rejetes (413)', async () => {
  const reports = Array.from({ length: 21 }, () => ({ module: 'm', type: 't' }));
  const r = await w.fetch(post({ reports }, null), ENV);
  assert.equal(r.status, 413);
});

test('corps > 128 Ko rejete (413)', async () => {
  const big = JSON.stringify({ reports: [{ module: 'm', type: 't', message: 'x'.repeat(200 * 1024) }] });
  const r = await w.fetch(post(big, null, { 'Content-Length': String(big.length) }), ENV);
  assert.equal(r.status, 413);
});

test('rate-limit : 429 apres 30 POST/min par IP', async () => {
  const ip = '10.9.9.9';
  let last = 0;
  for (let i = 0; i < 35; i++) {
    const r = await w.fetch(post({ reports: [] }, ip), ENV);
    last = r.status;
  }
  assert.equal(last, 429);
});

test('sanitization : chemins Windows/UNC/file:///, secrets, query URL', async (t) => {
  const gh = stubGitHub();
  t.after(() => gh.restore());
  const report = {
    app: 'SoundFart', version: '1.4.0', module: 'renderer', type: 'error',
    message: 'crash dans C:\\Users\\Bob\\Documents\\test.log apres \\\\serveur\\partage\\fichier.log et file:///C:/Users/Bob/app.js — Bearer abcdef1234567890 sur https://x.y/path?token=secret123',
    stack: 'Error: boom\n    at f (D:\\Documents\\SoundFart\\test.log:12:3)\n    at g (\\\\nas\\partage\\f.js:1:1)',
    os: { platform: 'win32', release: '10.0.22631', version: 'Windows 11' },
    timestamp: '2026-11-17T00:00:00Z',
    extra: { note: 'lu dans C:\\Users\\Bob\\x.txt', nested: { deep: 'token ghp_abcdefghijklmnopqrstu' } },
  };
  const r = await w.fetch(post({ reports: [report] }, null), ENV);
  assert.equal(r.status, 202);
  assert.equal(gh.calls.length, 1);

  // L'ecriture vise bien le depot prive via l'API Contents (jamais /issues).
  assert.match(gh.calls[0].url, /api\.github\.com\/repos\/sidburn99-ux\/SoundFart-reports\/contents\/reports\//);
  assert.ok(!gh.calls[0].url.includes('/issues'));
  assert.equal(gh.calls[0].opts.headers.Authorization, 'Bearer fake-token-test');

  const stored = decodePut(gh.calls[0]);
  const blob = JSON.stringify(stored);
  // AUCUN chemin utilisateur ni secret ne doit subsister.
  for (const bad of ['C:\\Users', 'Bob', 'serveur', 'D:\\Documents', 'test.log', 'secret123', 'abcdef1234567890', 'ghp_']) {
    assert.ok(!blob.includes(bad), 'fuite detectee: ' + bad);
  }
  // Les placeholders et les infos de diagnostic sont conserves.
  assert.ok(blob.includes('<path>'));
  assert.ok(blob.includes('crash dans'));
  assert.ok(stored.module === 'renderer' && stored.type === 'error' && stored.version === '1.4.0');
  assert.ok(stored.os.platform === 'win32');
  assert.ok(stored.stack.includes('boom'));
  assert.ok(stored.extra.note.includes('<path>'));
});

test('dedup intra-batch : 2 rapports identiques = 1 ecriture', async (t) => {
  const gh = stubGitHub();
  t.after(() => gh.restore());
  const rep = { module: 'main', type: 'uncaughtException', message: 'm' };
  const r = await w.fetch(post({ reports: [rep, rep] }, null), ENV);
  const j = await r.json();
  assert.equal(j.stored, 1);
  assert.equal(j.skipped, 1);
  assert.equal(gh.calls.length, 1);
});

test('rapport sans module/type ignore (skipped), pas d\'ecriture', async (t) => {
  const gh = stubGitHub();
  t.after(() => gh.restore());
  const r = await w.fetch(post({ reports: [{ message: 'rien' }, { module: 'm' }] }, null), ENV);
  const j = await r.json();
  assert.equal(j.stored, 0);
  assert.equal(j.skipped, 2);
  assert.equal(gh.calls.length, 0);
});

test('erreur GitHub -> 502 et failed compte, pas de crash', async (t) => {
  const gh = stubGitHub(() => { throw new Error('network down'); });
  t.after(() => gh.restore());
  const r = await w.fetch(post({ reports: [{ module: 'm', type: 't' }] }, null), ENV);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).failed, 1);
});

test('sans GITHUB_TOKEN/REPO -> 500 service non configure', async () => {
  const r = await w.fetch(post({ reports: [{ module: 'm', type: 't' }] }, null), {});
  assert.equal(r.status, 500);
});
