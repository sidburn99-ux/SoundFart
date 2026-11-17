'use strict';
// Tests node:test pour lib/crash-report.js — consentement, sanitization,
// file bornee, dedup/cooldown, endpoint vide, tentatives.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitize, sanitizeString, createCrashReporter, signature, resolveEndpoint, DEFAULT_ENDPOINT, LIMITS } = require('../lib/crash-report');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sf-reports-'));
const readQueue = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, 'pending.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
};

const CTX = {
  paths: [
    { path: 'C:\\Users\\Alice\\AppData\\Roaming\\SoundFart', placeholder: '<userData>' },
    { path: 'D:\\Mes sons', placeholder: '<storageDir>' },
  ],
  userName: 'Alice',
};

test('sanitizeString : chemins utilisateur remplaces par <path>', () => {
  const s = sanitizeString('crash dans C:\\Users\\Alice\\Documents\\son.mp3 puis C:/Users/Alice/x.wav', CTX);
  assert.ok(!s.includes('Alice'), s);
  assert.ok(!s.includes('Documents'), s);
  assert.strictEqual((s.match(/<path>/g) || []).length, 2, s);
});

test('sanitizeString : chemins connus -> placeholders nommes', () => {
  const s = sanitizeString('log: C:\\Users\\Alice\\AppData\\Roaming\\SoundFart\\soundfart.log', CTX);
  assert.ok(s.includes('<userData>'), s);
  assert.ok(!s.includes('Alice'), s);
  const s2 = sanitizeString('fichier D:\\Mes sons\\imports\\a.mp3', CTX);
  assert.ok(s2.includes('<storageDir>'), s2);
});

test('sanitizeString : file:///, UNC, unix et :ligne:colonne conserves', () => {
  assert.strictEqual(
    sanitizeString('at foo (file:///C:/Users/Alice/app.js:10:5)', CTX),
    'at foo (<path>:10:5)');
  assert.strictEqual(sanitizeString('err \\\\NAS\\partage\\fichier.txt ici', CTX), 'err <path> ici');
  assert.strictEqual(sanitizeString('err /home/alice/proj/x.js:3:1 ok', CTX), 'err <path>:3:1 ok');
});

test('sanitizeString : ne touche pas les fractions ni « et/ou »', () => {
  const s = sanitizeString('ratio 12/05/2024 et AC/DC ou et/ou', CTX);
  assert.strictEqual(s, 'ratio 12/05/2024 et AC/DC ou et/ou');
});

test('sanitizeString : nom d utilisateur masque hors chemins', () => {
  const s = sanitizeString('Alice a quitte brutalement', CTX);
  assert.ok(!/\bAlice\b/.test(s), s);
  assert.ok(s.includes('<user>'), s);
});

test('sanitizeString : secrets et Bearer masques', () => {
  const s = sanitizeString('Authorization: Bearer abcdef123456 token=ghp_abcdefghijklmnop password: "hunter2"', CTX);
  assert.ok(!s.includes('abcdef123456'), s);
  assert.ok(!s.includes('ghp_abcdefghijklmnop'), s);
  assert.ok(!s.includes('hunter2'), s);
  assert.ok(s.includes('Bearer <redacted>'), s);
});

test('sanitizeString : query string d URL retiree', () => {
  const s = sanitizeString('telechargement https://youtu.be/abc123?si=secret&t=5 echoue', CTX);
  assert.ok(s.includes('https://youtu.be/abc123'), s);
  assert.ok(!s.includes('si=secret'), s);
  assert.ok(s.includes('?…'), s);
});

test('sanitize : champs inconnus exclus, stack bornee a ~8 Ko', () => {
  const big = 'x'.repeat(20000);
  const r = sanitize({ module: 'main', type: 't', message: 'm', stack: big, evil: 'DROP', config: { a: 1 } }, CTX);
  assert.strictEqual(r.evil, undefined);
  assert.strictEqual(r.config, undefined);
  assert.ok(r.stack.length <= LIMITS.STACK_MAX + 20, String(r.stack.length));
  assert.ok(r.stack.includes('[tronqué]'), r.stack.slice(-30));
});

test('signature : stable par module+type+message', () => {
  const a = signature({ module: 'main', type: 'x', message: 'boom' });
  const b = signature({ module: 'main', type: 'x', message: 'boom' });
  const c = signature({ module: 'main', type: 'x', message: 'boom2' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

function makeReporter(over = {}) {
  const dir = over.dir || tmpdir();
  const state = { consent: 'consent' in over ? over.consent : 'yes', now: over.now || 1000000, posts: over.posts || [] };
  const r = createCrashReporter({
    dir,
    endpoint: over.endpoint !== undefined ? over.endpoint : 'https://reports.example.com/in',
    getConsent: () => state.consent,
    getMeta: () => ({ version: '9.9.9', os: { platform: 'win32', release: '10.0.1', version: 'Windows 11' } }),
    getSanitizeCtx: () => CTX,
    post: over.post || (async (body) => { state.posts.push(JSON.parse(body)); }),
    now: () => state.now,
    log: () => {},
  });
  return { r, dir, state };
}

test('consentement : no/absent = aucun enqueue, aucun envoi', async () => {
  for (const consent of ['no', null, undefined]) {
    const { r, dir, state } = makeReporter({ consent });
    assert.strictEqual(r.report({ module: 'main', type: 'x', message: 'm' }), false);
    await r.flush();
    assert.strictEqual(state.posts.length, 0);
    assert.strictEqual(readQueue(dir).length, 0);
  }
});

test('cycle complet : consentement yes -> file -> POST -> purge sur no', async () => {
  const { r, dir, state } = makeReporter({});
  assert.strictEqual(r.report({ module: 'main', type: 'uncaughtException', message: 'ReferenceError: x is not defined', stack: 'at f (C:\\Users\\Alice\\app\\main.js:1:1)', exitCode: 1 }), true);
  await r.flush();
  assert.strictEqual(state.posts.length, 1);
  const rep = state.posts[0].reports[0];
  assert.strictEqual(rep.module, 'main');
  assert.strictEqual(rep.version, '9.9.9');
  assert.strictEqual(rep.exitCode, 1);
  assert.ok(!JSON.stringify(rep).includes('Alice'), JSON.stringify(rep));
  assert.strictEqual(readQueue(dir).length, 0); // file vide apres envoi

  // Nouveau rapport, puis revocation : la file ne doit JAMAIS partir.
  state.consent = 'yes';
  r.report({ module: 'main', type: 'x', message: 'pending' });
  state.posts.length = 0;
  // Faire echouer l'envoi pour garder le rapport en file.
  // (on recree un reporter avec post qui echoue)
  const posts2 = [];
  const r2 = createCrashReporter({
    dir, endpoint: 'https://x', getConsent: () => state.consent,
    post: async () => { throw new Error('down'); }, now: () => state.now, log: () => {},
  });
  state.consent = 'yes';
  r2.report({ module: 'main', type: 'y', message: 'will-fail' });
  await r2.flush(); // echoue -> reste en file (attempts=1)
  assert.strictEqual(readQueue(dir).length >= 1, true);
  state.consent = 'no';
  await r2.flush(); // revocation -> purge sans envoi
  assert.strictEqual(readQueue(dir).length, 0);
  assert.strictEqual(posts2.length, 0);
});

test('endpoint vide : file conservee, aucun envoi, aucune erreur', async () => {
  const posts = [];
  const { r, dir, state } = makeReporter({ endpoint: '', posts });
  r.report({ module: 'main', type: 'x', message: 'queued' });
  const res = await r.flush();
  assert.strictEqual(res.reason, 'no-endpoint');
  assert.strictEqual(posts.length, 0);
  assert.strictEqual(readQueue(dir).length, 1); // conservee pour plus tard
});

test('file bornee : > MAX_QUEUE_REPORTS reports -> tronquee', () => {
  const { r, dir } = makeReporter({ endpoint: '' });
  for (let i = 0; i < LIMITS.MAX_QUEUE_REPORTS + 15; i++) {
    r.report({ module: 'main', type: 'x', message: 'm' + i });
  }
  const q = readQueue(dir);
  assert.ok(q.length <= LIMITS.MAX_QUEUE_REPORTS, String(q.length));
  assert.ok(q.length > 0);
});

test('dedup/cooldown : meme signature = 1 envoi / 5 min, puis renvoi', async () => {
  const posts = [];
  const { r, state } = makeReporter({ posts });
  state.now = 1000000;
  // Deux rapports identiques en file -> UN SEUL dans le batch.
  r.report({ module: 'main', type: 'x', message: 'same crash' });
  r.report({ module: 'main', type: 'x', message: 'same crash' });
  await r.flush();
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].reports.length, 1);

  // Dans la fenetre de cooldown : nouveau rapport identique -> abandonne.
  r.report({ module: 'main', type: 'x', message: 'same crash' });
  await r.flush();
  assert.strictEqual(posts.length, 1);

  // Apres le cooldown : renvoi autorise.
  state.now += LIMITS.COOLDOWN_MS + 1000;
  r.report({ module: 'main', type: 'x', message: 'same crash' });
  await r.flush();
  assert.strictEqual(posts.length, 2);
});

test('tentatives : echec -> attempts++, abandon apres MAX_ATTEMPTS', async () => {
  const dir = tmpdir();
  let calls = 0;
  const r = createCrashReporter({
    dir, endpoint: 'https://x', getConsent: () => 'yes',
    post: async () => { calls++; throw new Error('down'); },
    now: () => 1000000, log: () => {},
  });
  r.report({ module: 'main', type: 'x', message: 'always fails' });
  for (let i = 0; i < LIMITS.MAX_ATTEMPTS; i++) await r.flush();
  assert.strictEqual(calls, LIMITS.MAX_ATTEMPTS);
  await r.flush(); // tentative MAX+1 : abandon sans POST
  assert.strictEqual(calls, LIMITS.MAX_ATTEMPTS);
  assert.strictEqual(readQueue(dir).length, 0);
});

test('anti-spam : > MAX_ENQUEUE_PER_MIN evenements/min rejetes', () => {
  const { r } = makeReporter({ endpoint: '' });
  let accepted = 0;
  for (let i = 0; i < LIMITS.MAX_ENQUEUE_PER_MIN + 10; i++) {
    if (r.report({ module: 'main', type: 'x', message: 'spam' + i })) accepted++;
  }
  assert.strictEqual(accepted, LIMITS.MAX_ENQUEUE_PER_MIN);
});

test('lots multiples : > MAX_BATCH rapports -> plusieurs POST sequentiels', async () => {
  const posts = [];
  const { r, dir } = makeReporter({ posts });
  const n = LIMITS.MAX_BATCH + 5;
  for (let i = 0; i < n; i++) {
    r.report({ module: 'main', type: 'x', message: 'batch-' + i });
  }
  const res = await r.flush();
  assert.strictEqual(res.sent, n);
  assert.strictEqual(posts.length, 2, 'deux POST attendus');
  assert.strictEqual(posts[0].reports.length, LIMITS.MAX_BATCH);
  assert.strictEqual(posts[1].reports.length, 5);
  assert.strictEqual(readQueue(dir).length, 0);
});

test('limite 112 Kio : chaque POST reste sous MAX_POST_BYTES', async () => {
  const posts = [];
  const { r } = makeReporter({ posts });
  // ~14 Ko par rapport (stack 8 Ko + extra 4 Ko + message) : 10 rapports
  // ~140 Ko > 112 Kio -> fractionnement obligatoire (2 lots), tout en
  // restant sous MAX_QUEUE_BYTES (256 Kio) cote file.
  for (let i = 0; i < 10; i++) {
    r.report({
      module: 'main', type: 'big', message: 'big-' + i,
      stack: 'S'.repeat(8000), extra: { blob: 'E'.repeat(3900) },
    });
  }
  const res = await r.flush();
  assert.strictEqual(res.sent, 10);
  assert.ok(posts.length >= 2, 'attendu >= 2 POST, recu ' + posts.length);
  for (const p of posts) {
    const bytes = Buffer.byteLength(JSON.stringify(p));
    assert.ok(bytes <= LIMITS.MAX_POST_BYTES, 'POST de ' + bytes + ' octets > ' + LIMITS.MAX_POST_BYTES);
    assert.ok(p.reports.length <= LIMITS.MAX_BATCH);
  }
});

test('lot trop gros : les rapports non envoyes restent en file', async () => {
  const dir = tmpdir();
  const posts = [];
  let failFirst = true;
  const r = createCrashReporter({
    dir, endpoint: 'https://x', getConsent: () => 'yes',
    post: async (body) => {
      if (failFirst) { failFirst = false; throw new Error('HTTP 500'); }
      posts.push(JSON.parse(body));
    },
    now: () => 1000000, log: () => {},
  });
  // Assez de rapports pour creer 2 lots (~140 Ko) : le 1er echoue,
  // le 2e n'est pas tente ce flush-ci.
  for (let i = 0; i < 10; i++) {
    r.report({
      module: 'main', type: 'big', message: 'big-' + i,
      stack: 'S'.repeat(8000), extra: { blob: 'E'.repeat(3900) },
    });
  }
  const res = await r.flush();
  assert.strictEqual(res.sent, 0);
  assert.ok(posts.length === 0);
  const q = readQueue(dir);
  assert.strictEqual(q.length, 10, 'tous les rapports doivent rester en file');
  // Le lot tente a consomme une tentative ; les lots non tentes restent a 0.
  assert.ok(q.some((it) => it.attempts === 1), 'le lot tente doit avoir attempts=1');
  assert.ok(q.every((it) => it.attempts <= 1), 'aucun rapport ne doit depasser attempts=1 ici');
  // 2e flush : le POST reussit -> tout part.
  await r.flush();
  assert.strictEqual(readQueue(dir).length, 0);
});

test('echec lot ulterieur : lot 1 accepte+retire, lot 2 attempts++, lot 3 conserve intact', async () => {
  const dir = tmpdir();
  const posts = [];
  let calls = 0;
  const r = createCrashReporter({
    dir, endpoint: 'https://x', getConsent: () => 'yes',
    post: async (body) => {
      calls++;
      if (calls === 2) throw new Error('HTTP 500'); // 2e lot echoue
      posts.push(JSON.parse(body));
    },
    now: () => 1000000, log: () => {},
  });
  // ~12 Ko/rapport x 19 = ~230 Ko -> 3 lots (9+9+1 environ).
  // Reste sous MAX_QUEUE_BYTES (256 Kio) pour ne pas tronquer a l'enqueue.
  for (let i = 0; i < 19; i++) {
    r.report({
      module: 'main', type: 'big', message: 'p-' + i,
      stack: 'S'.repeat(8000), extra: { blob: 'E'.repeat(3900) },
    });
  }
  const res = await r.flush();
  assert.strictEqual(calls, 2, 'le 3e lot ne doit PAS etre tente apres l echec');
  assert.strictEqual(posts.length, 1, 'seul le 1er lot a ete accepte');
  assert.strictEqual(res.sent, posts[0].reports.length);
  const q = readQueue(dir);
  const batch1Size = posts[0].reports.length;
  assert.strictEqual(q.length, 19 - batch1Size, 'file = lots 2+3 uniquement');
  // Lot 2 (echoue) : attempts=1. Lot 3 (non tente) : attempts=0.
  const a1 = q.filter((it) => it.attempts === 1).length;
  const a0 = q.filter((it) => it.attempts === 0).length;
  assert.ok(a1 > 0 && a0 > 0, 'repartition attempts 1/0 attendue: ' + a1 + '/' + a0);
  assert.strictEqual(a1 + a0, q.length);
  // Ordre preserve : les messages restants sont dans l ordre d origine.
  const msgs = q.map((it) => it.r.message);
  assert.deepStrictEqual(msgs, msgs.slice().sort((x, y) => +x.slice(2) - +y.slice(2)));
});

test('limite en octets UTF-8 : caracteres accentues comptes en octets, pas en chars', async () => {
  const bodies = [];
  const dir = tmpdir();
  const r = createCrashReporter({
    dir, endpoint: 'https://x', getConsent: () => 'yes',
    post: async (body) => { bodies.push(body); },
    now: () => 1000000, log: () => {},
  });
  // 'é' = 1 char JS mais 2 octets UTF-8 : string.length sous-estimerait
  // la taille reelle du corps. ~6 Kio de 'é' par rapport -> ~12 Kio reels.
  for (let i = 0; i < 10; i++) {
    r.report({
      module: 'main', type: 'utf8', message: 'u-' + i,
      stack: 'é'.repeat(6000),
    });
  }
  await r.flush();
  assert.ok(bodies.length >= 2, 'fractionnement attendu avec des accents, recu ' + bodies.length);
  for (const b of bodies) {
    const bytes = Buffer.byteLength(b, 'utf8');
    assert.ok(bytes <= LIMITS.MAX_POST_BYTES, 'corps de ' + bytes + ' octets > ' + LIMITS.MAX_POST_BYTES);
    assert.ok(JSON.parse(b).reports.length <= LIMITS.MAX_BATCH);
  }
  assert.strictEqual(readQueue(dir).length, 0);
});

test('rapport trop volumineux seul : envoye isole, ne bloque pas les suivants', async () => {
  const posts = [];
  const { r, dir } = makeReporter({ posts });
  // REPORT_MAX_BYTES (32 Kio) + STACK_MAX/EXTRA_MAX bornent chaque rapport
  // bien sous MAX_POST_BYTES : le pire cas tient toujours dans un lot,
  // mais on verifie qu'un rapport lourd ne repousse pas les suivants
  // dans un autre lot de maniere incorrecte.
  for (let i = 0; i < 3; i++) {
    r.report({
      module: 'main', type: 'huge', message: 'h-' + i,
      stack: 'H'.repeat(8000), extra: { blob: 'X'.repeat(3900) },
    });
  }
  for (let i = 0; i < 3; i++) r.report({ module: 'main', type: 'x', message: 'small' + i });
  const res = await r.flush();
  assert.strictEqual(res.sent, 6);
  assert.strictEqual(readQueue(dir).length, 0);
  // Tous les rapports sont partis, dans l'ordre file.
  const all = posts.flatMap((p) => p.reports);
  assert.strictEqual(all.length, 6);
  assert.deepStrictEqual(all.map((x) => x.message), ['h-0', 'h-1', 'h-2', 'small0', 'small1', 'small2']);
});

test('endpoint : defaut Cloudflare, surcharge SOUNDFART_REPORT_URL, vide = defaut', () => {
  // Comportemental : resolveEndpoint est la fonction utilisee par main.js.
  assert.strictEqual(DEFAULT_ENDPOINT, 'https://soundfart-reports.sidburn99.workers.dev');
  assert.strictEqual(resolveEndpoint({}), DEFAULT_ENDPOINT);
  assert.strictEqual(resolveEndpoint({ SOUNDFART_REPORT_URL: '' }), DEFAULT_ENDPOINT);
  assert.strictEqual(resolveEndpoint({ SOUNDFART_REPORT_URL: 'https://x.test/in' }), 'https://x.test/in');
  // main.js doit bien consommer cette fonction (garde-fou statique).
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(src.includes('resolveEndpoint(process.env)'), 'main.js utilise resolveEndpoint');
});

test('sanitize integration : le rapport envoye ne contient aucune donnee utilisateur', async () => {
  const posts = [];
  const { r } = makeReporter({ posts });
  r.report({
    module: 'main', type: 'uncaughtException',
    message: 'ENOENT: C:\\Users\\Alice\\Sounds\\secret-song.mp3 token=abcdef123456',
    stack: 'Error: x\n    at f (C:\\Users\\Alice\\SoundFart\\main.js:10:5)',
    extra: { file: 'C:\\Users\\Alice\\config.json', note: 'Bearer zzz999yyy' },
  });
  await r.flush();
  const body = JSON.stringify(posts[0]);
  assert.ok(!body.includes('Alice'), body);
  assert.ok(!body.includes('secret-song'), body);
  assert.ok(!body.includes('abcdef123456'), body);
  assert.ok(!body.includes('zzz999yyy'), body);
});
