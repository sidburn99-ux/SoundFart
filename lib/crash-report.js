'use strict';
// ================================================================
// Rapports d'erreurs/crashs OPT-IN (telemetrie de diagnostic uniquement).
//
// - AUCUNE collecte sans consentement 'yes' explicite (getConsent()).
// - File locale bornee userData/reports/pending.jsonl : si le consentement
//   est retire ('no' ou absent), flush()/purge() vident la file — rien
//   n'est jamais envoye sans consentement present AU MOMENT de l'envoi.
// - Envoi HTTPS POST async, timeout 10 s, 3 tentatives max par rapport,
//   dedup par signature (cooldown 5 min) — jamais bloquant pour l'UI.
// - sanitize() elimine chemins utilisateur, nom d'utilisateur Windows,
//   secrets et query strings avant toute ecriture/envoi.
// - endpoint vide ('') : la file est conservee localement, aucun envoi,
//   aucune erreur (service non encore deploye).
// ================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const LIMITS = {
  MAX_QUEUE_REPORTS: 40,     // entrees max dans pending.jsonl
  MAX_QUEUE_BYTES: 256 * 1024,
  MAX_ATTEMPTS: 3,           // tentatives d'envoi par rapport
  COOLDOWN_MS: 5 * 60 * 1000,// dedup : meme signature = 1 envoi / 5 min
  DEDUP_MAX: 300,
  DEDUP_MAX_AGE_MS: 30 * 86400000,
  MAX_ENQUEUE_PER_MIN: 60,   // anti-spam (renderer qui boucle sur une erreur)
  POST_TIMEOUT_MS: 10000,
  MAX_BATCH: 20,             // rapports max par POST (limite du worker)
  MAX_POST_BYTES: 112 * 1024,// corps JSON max par POST : le worker refuse >128 Kio,
                             // marge de 16 Kio pour les ecarts d'encodage
  STACK_MAX: 8 * 1024,       // stack tronquee a ~8 Ko
  MESSAGE_MAX: 2000,
  EXTRA_MAX: 4000,
  REPORT_MAX_BYTES: 32 * 1024,
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Jetons « chemin absolu » : lettre de lecteur, UNC, file:///, ou / unix.
// Le prefixe exige un separateur (espace, quote, parenthese, =, <, {) pour
// ne PAS matcher « et/ou », « 12/05/2024 » ou « AC/DC » en milieu de texte.
const PATH_TOKEN_RE = /(^|[\s"'`(=\[{<])((?:file:\/\/)?(?:[a-zA-Z]:[\\/]|\\\\|\/)[^\s"'`<>)\]]+)/g;
const PATH_SUFFIX_RE = /((?::\d+){1,2})$/; // :ligne(:colonne) final a conserver

function sanitizeString(input, ctx) {
  if (typeof input !== 'string') return input;
  let s = input;
  const c = ctx || {};

  // 1. URLs http(s) : protegees le temps du filtrage des chemins (sinon
  //    « //hote/path » serait pris pour un chemin unix) ; query retiree
  //    (les URLs YouTube/yt-dlp peuvent porter des jetons dans la query).
  const urls = [];
  s = s.replace(/https?:\/\/[^\s"'`<>)\]]+/g, (u) => {
    const hadQuery = /[?#]/.test(u);
    urls.push(u.replace(/[?#][^\s"'`<>)\]]*$/, '') + (hadQuery ? '?…' : ''));
    return '@@SFURL' + (urls.length - 1) + '@@';
  });

  // 2. Chemins connus explicites -> placeholders nommes (les plus longs
  //    d'abord pour que userData gagne sur homedir). Variantes avec '/' :
  //    les stacks Electron peuvent melanger les separateurs.
  const known = [];
  for (const p of (c.paths || [])) {
    const pp = typeof p === 'string' ? p : (p && p.path);
    const ph = (p && p.placeholder) || '<path>';
    if (!pp) continue;
    known.push([pp, ph]);
    if (pp.indexOf('\\') >= 0) known.push([pp.replace(/\\/g, '/'), ph]);
  }
  known.sort((a, b) => b[0].length - a[0].length);
  for (const [p, ph] of known) {
    s = s.replace(new RegExp(escapeRe(p), 'gi'), ph);
  }

  // 3. Chemins absolus generiques -> <path> (en gardant :ligne:colonne).
  s = s.replace(PATH_TOKEN_RE, (m, pre, tok) => {
    let tail = '';
    const tm = tok.match(PATH_SUFFIX_RE);
    if (tm) { tail = tm[1]; tok = tok.slice(0, tok.length - tail.length); }
    return pre + '<path>' + tail;
  });

  // 4. Nom d'utilisateur Windows : occurrences hors chemins (dans les
  //    chemins il est deja absorbe par <path>). Mot entiers seulement.
  if (typeof c.userName === 'string' && c.userName.length >= 3) {
    s = s.replace(new RegExp('\\b' + escapeRe(c.userName) + '\\b', 'gi'), '<user>');
  }

  // 5. Secrets : Bearer/Basic, paires cle=valeur, jetons connus.
  s = s.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 <redacted>');
  s = s.replace(/\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|xox[baprs]|github_pat)-[A-Za-z0-9_-]{8,}/g, '<redacted>');
  s = s.replace(/(^|[^A-Za-z0-9_])(["']?(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|passwd|authorization|credential|session[_-]?key)["']?\s*[:=]\s*["']?)((?!(?:bearer|basic)\b)[^\s"',}&]{3,})/gi, '$1$2<redacted>');

  // 6. Restauration des URLs assainies.
  s = s.replace(/@@SFURL(\d+)@@/g, (m, i) => urls[+i] || m);
  return s;
}

function sanitizeValue(v, ctx, depth) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return sanitizeString(v, ctx);
  if (depth > 4) return String(v).slice(0, 200);
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitizeValue(x, ctx, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 30)) o[k] = sanitizeValue(v[k], ctx, depth + 1);
    return o;
  }
  return String(v).slice(0, 200);
}

// Sanitise un rapport brut {app, version, os, module, type, message, stack,
// timestamp, exitCode, extra} : ne conserve que les champs connus, assainit
// toutes les chaines et borne les tailles.
function sanitize(input, ctx) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of ['app', 'version', 'module', 'type', 'message', 'stack', 'timestamp', 'exitCode', 'os', 'extra']) {
    if (!(k in input)) continue;
    out[k] = sanitizeValue(input[k], ctx, 0);
  }
  if (typeof out.message === 'string' && out.message.length > LIMITS.MESSAGE_MAX)
    out.message = out.message.slice(0, LIMITS.MESSAGE_MAX) + '…';
  if (typeof out.stack === 'string' && out.stack.length > LIMITS.STACK_MAX)
    out.stack = out.stack.slice(0, LIMITS.STACK_MAX) + '…[tronqué]';
  if (out.extra && typeof out.extra === 'object') {
    try { if (JSON.stringify(out.extra).length > LIMITS.EXTRA_MAX) out.extra = { _truncated: true }; }
    catch { out.extra = { _truncated: true }; }
  }
  try {
    if (JSON.stringify(out).length > LIMITS.REPORT_MAX_BYTES) {
      out.stack = '';
      delete out.extra;
      if (JSON.stringify(out).length > LIMITS.REPORT_MAX_BYTES) out.message = String(out.message || '').slice(0, 500);
    }
  } catch { /* rapport aberrant : on renvoie au moins l'enveloppe */ }
  return out;
}

// Signature de dedup : module + type + message (deja assaini) — volontairement
// sans la stack pour absorber les variations d'adresses.
function signature(report) {
  const r = report || {};
  return crypto.createHash('sha256')
    .update(String(r.module || '') + '|' + String(r.type || '') + '|' + String(r.message || '').slice(0, 500))
    .digest('hex').slice(0, 16);
}

// POST HTTPS minimal (Node https) — utilise SEULEMENT https://, timeout 10 s.
function defaultPost(body, endpoint, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(endpoint); } catch (e) { return reject(new Error('endpoint invalide')); }
    if (u.protocol !== 'https:') return reject(new Error('endpoint non-HTTPS refuse'));
    const req = https.request({
      protocol: 'https:', hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'SoundFart-crash-report',
      },
      timeout: timeoutMs || LIMITS.POST_TIMEOUT_MS,
    }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('HTTP ' + res.statusCode));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout envoi rapport')));
    req.on('error', reject);
    req.end(body);
  });
}

// Endpoint public du service de collecte (worker Cloudflare). URL seule,
// aucun secret : l'endpoint n'autorise que l'ecriture de rapports validates.
const DEFAULT_ENDPOINT = 'https://soundfart-reports.sidburn99.workers.dev';

// Resolution de l'endpoint : SOUNDFART_REPORT_URL (dev/tests) prime,
// sinon le service de production. Chaine vide = valeur par defaut.
function resolveEndpoint(env) {
  const v = env && env.SOUNDFART_REPORT_URL;
  return (typeof v === 'string' && v) ? v : DEFAULT_ENDPOINT;
}

// Cree le collecteur. opts :
//   dir            : dossier de file (userData/reports)
//   endpoint       : URL https du service ('' = conservation locale seule)
//   getConsent()   : 'yes' | 'no' | null — relu a chaque operation
//   getMeta()      : {version, os:{platform,release,version}}
//   getSanitizeCtx(): {paths:[{path,placeholder}], userName}
//   log(msg,lvl)   : journal local (optionnel)
//   post(body,url,timeoutMs) : injectable pour les tests (defaut defaultPost)
//   now()          : injectable pour les tests (defaut Date.now)
function createCrashReporter(opts) {
  opts = opts || {};
  const dir = typeof opts.dir === 'string' && opts.dir ? opts.dir : null;
  const endpoint = typeof opts.endpoint === 'string' ? opts.endpoint : '';
  const getConsent = typeof opts.getConsent === 'function' ? opts.getConsent : () => null;
  const getMeta = typeof opts.getMeta === 'function' ? opts.getMeta : () => ({});
  const getSanitizeCtx = typeof opts.getSanitizeCtx === 'function' ? opts.getSanitizeCtx : () => null;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const post = typeof opts.post === 'function' ? opts.post : defaultPost;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  const pendingFile = () => path.join(dir, 'pending.jsonl');
  const dedupFile = () => path.join(dir, 'dedup.json');

  let flushTimer = null;
  let winStart = 0, winCount = 0;
  let flushing = null; // anti-reentrance : un flush lent ne doit pas doublonner les POST

  function readQueue() {
    const out = [];
    if (!dir) return out;
    let raw;
    try { raw = fs.readFileSync(pendingFile(), 'utf8'); } catch { return out; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const it = JSON.parse(line);
        if (it && it.r && typeof it.r === 'object') out.push({ r: it.r, attempts: it.attempts | 0 });
      } catch { /* ligne corrompue : ignoree */ }
    }
    return out;
  }

  function writeQueue(items) {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    // Borne dure : on jette les plus anciens jusqu'a rentrer dans les caps.
    let kept = items.slice();
    const enc = (arr) => arr.map((it) => JSON.stringify({ r: it.r, attempts: it.attempts | 0 })).join('\n') + (arr.length ? '\n' : '');
    while (kept.length > LIMITS.MAX_QUEUE_REPORTS || Buffer.byteLength(enc(kept)) > LIMITS.MAX_QUEUE_BYTES) {
      kept = kept.slice(1);
      if (!kept.length) break;
    }
    const f = pendingFile();
    if (!kept.length) { try { fs.unlinkSync(f); } catch {} return; }
    const tmp = f + '.tmp';
    try {
      fs.writeFileSync(tmp, enc(kept), 'utf8');
      fs.renameSync(tmp, f);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      log('[reports] ecriture file: ' + (e && e.message), 'warn');
    }
  }

  function readDedup() {
    const out = {};
    if (!dir) return out;
    try {
      const j = JSON.parse(fs.readFileSync(dedupFile(), 'utf8'));
      if (j && typeof j === 'object') for (const k of Object.keys(j)) if (Number.isFinite(j[k])) out[k] = j[k];
    } catch { /* absent ou corrompu : repartie a zero */ }
    return out;
  }

  function writeDedup(map) {
    if (!dir) return;
    try {
      const t = now();
      const entries = Object.entries(map)
        .filter(([, ts]) => t - ts < LIMITS.DEDUP_MAX_AGE_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, LIMITS.DEDUP_MAX);
      const obj = {};
      for (const [k, ts] of entries) obj[k] = ts;
      fs.mkdirSync(dir, { recursive: true });
      const f = dedupFile();
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      fs.renameSync(tmp, f);
    } catch (e) { log('[reports] dedup: ' + (e && e.message), 'warn'); }
  }

  function scheduleFlush() {
    if (flushTimer || !dir) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, 4000);
    if (flushTimer.unref) flushTimer.unref();
  }

  // Enregistre un evenement {module, type, message, stack, exitCode, extra}.
  // Retourne true si le rapport a ete mis en file (consentement 'yes' requis).
  function report(evt) {
    try {
      if (!dir || getConsent() !== 'yes') return false;
      const t = now();
      if (t - winStart >= 60000) { winStart = t; winCount = 0; }
      if (++winCount > LIMITS.MAX_ENQUEUE_PER_MIN) return false;
      const meta = getMeta() || {};
      const raw = {
        app: 'SoundFart',
        version: meta.version,
        os: meta.os,
        module: evt && evt.module,
        type: evt && evt.type,
        message: evt && evt.message,
        stack: evt && evt.stack,
        timestamp: new Date(t).toISOString(),
        exitCode: evt && Number.isFinite(evt.exitCode) ? evt.exitCode : null,
        extra: evt && evt.extra,
      };
      const clean = sanitize(raw, getSanitizeCtx());
      const items = readQueue();
      items.push({ r: clean, attempts: 0 });
      writeQueue(items);
      scheduleFlush();
      return true;
    } catch (e) {
      try { log('[reports] enqueue: ' + (e && e.message), 'warn'); } catch {}
      return false;
    }
  }

  // Vide la file locale — appele par le main des qu'un consentement
  // autre que 'yes' est connu (revocation = aucun envoi possible).
  function purge() {
    try {
      if (!dir) return;
      try { fs.unlinkSync(pendingFile()); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
    } catch (e) { try { log('[reports] purge: ' + (e && e.message), 'warn'); } catch {} }
  }

  // Envoie les rapports en attente. Regles :
  //  - consentement != 'yes'  -> file PURGEE, aucun envoi (invariant absolu)
  //  - endpoint vide          -> file conservee, aucun envoi, aucune erreur
  //  - signature deja vue < 5 min -> rapport abandonne (anti-boucle)
  //  - echec reseau           -> attempts++ (max 3), sinon abandonne
  //  - file trop grosse       -> fractionnee en plusieurs POST : chaque lot
  //    respecte MAX_BATCH (20) ET MAX_POST_BYTES (112 Kio < 128 Kio worker).
  //    Un lot trop volumineux n'abandonne JAMAIS les rapports : les lots
  //    suivants restent en file intacts pour le prochain flush.
  async function doFlush() {
      const result = { sent: 0, kept: 0, dropped: 0, reason: null };
      try {
        if (!dir) { result.reason = 'no-dir'; return result; }
        if (getConsent() !== 'yes') {
          purge();
          result.reason = 'no-consent';
          return result;
        }
        if (!endpoint) { result.reason = 'no-endpoint'; return result; }
        const queue = readQueue();
        if (!queue.length) return result;
        const dedup = readDedup();
        const t = now();
        const sendable = [], keptQueue = [];
        const batchSigs = new Set(); // dedup intra-batch : 2 rapports identiques dans la file = 1 envoi
        for (const it of queue) {
          const sig = signature(it.r);
          const last = dedup[sig] || 0;
          if (t - last < LIMITS.COOLDOWN_MS || batchSigs.has(sig) || (it.attempts | 0) >= LIMITS.MAX_ATTEMPTS) {
            result.dropped++;
            continue;
          }
          batchSigs.add(sig);
          sendable.push({ it, sig });
        }
        // Partition en lots : <= MAX_BATCH rapports ET corps JSON <= MAX_POST_BYTES.
        // Taille du corps = {"reports":[...]} : 14 octets d'enveloppe + items
        // + 1 virgule par jointure. Le calcul est exact car JSON.stringify
        // d'un tableau concatene les representations sans les modifier.
        const batches = [];
        let cur = [], curBytes = 14;
        for (const x of sendable) {
          const itemBytes = Buffer.byteLength(JSON.stringify(x.it.r));
          const need = itemBytes + (cur.length ? 1 : 0);
          if (cur.length && (cur.length >= LIMITS.MAX_BATCH || curBytes + need > LIMITS.MAX_POST_BYTES)) {
            batches.push(cur);
            cur = [];
            curBytes = 14;
          }
          cur.push(x);
          curBytes += need;
        }
        if (cur.length) batches.push(cur);
        // Envoi sequentiel : des que UN lot echoue, on n'essaie pas les
        // suivants (meme endpoint, meme session reseau) — leurs rapports
        // restent en file sans tentative consommee.
        const unsent = [];
        for (const batch of batches) {
          const body = JSON.stringify({ reports: batch.map((x) => x.it.r) });
          try {
            await post(body, endpoint, LIMITS.POST_TIMEOUT_MS);
            result.sent += batch.length;
            for (const x of batch) dedup[x.sig] = t;
          } catch (e) {
            result.kept += batch.length;
            for (const x of batch) {
              x.it.attempts = (x.it.attempts | 0) + 1;
              if (x.it.attempts < LIMITS.MAX_ATTEMPTS) unsent.push(x.it);
              else result.dropped++;
            }
            log('[reports] envoi echoue: ' + (e && e.message), 'warn');
            for (let i = batches.indexOf(batch) + 1; i < batches.length; i++) {
              unsent.push(...batches[i].map((x) => x.it));
              result.kept += batches[i].length;
            }
            break;
          }
        }
        keptQueue.push(...unsent);
        writeQueue(keptQueue);
        writeDedup(dedup);
        return result;
      } catch (e) {
        try { log('[reports] flush: ' + (e && e.message), 'warn'); } catch {}
        result.reason = 'error';
        return result;
      }
  }

  // Anti-reentrance : un flush lent (POST en vol) ne doit pas etre
  // duplique. .finally() et PAS un finally dans l'IIFE : sans await
  // intermediaire, le finally s'executerait AVANT l'affectation de
  // `flushing` et laisserait une promesse resolue bloqueer les flush
  // suivants a jamais (bug constate en test).
  function flush() {
    if (flushing) return flushing;
    flushing = doFlush().finally(() => { flushing = null; });
    return flushing;
  }

  return {
    report,
    flush,
    purge,
    dir,
    pendingFile,
    dedupFile,
    LIMITS,
  };
}

module.exports = { sanitize, sanitizeString, signature, createCrashReporter, defaultPost, resolveEndpoint, DEFAULT_ENDPOINT, LIMITS };
