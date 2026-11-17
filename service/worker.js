// ================================================================
// SoundFart — service de collecte de rapports d'erreurs (opt-in)
// Cloudflare Worker : recoit le POST du client, re-valide et re-sanitize
// le contenu, puis ecrit chaque rapport dans un depot GitHub PRIVE via
// l'API Contents. AUCUNE issue publique n'est jamais creee.
//
// Secrets/vars requis (wrangler) :
//   GITHUB_TOKEN   : Personal Access Token classique, scope « repo »
//                   (contents:write) sur un depot PRIVE dedie.
//                   -> `wrangler secret put GITHUB_TOKEN`
//   GITHUB_REPO    : "proprietaire/nom-du-depot" (var, pas secret)
//   GITHUB_BRANCH  : branche par defaut (var, optionnel, defaut "main")
//
// Limites : pas d'authentification cote client (l'URL n'est pas un secret
// et ne peut pas en etre un dans un exe) — la validation stricte taille/
// type + le depot prive sont la protection. Pas de rate-limit natif sans
// KV : a ajouter si le volume le justifie (voir README.md).
// ================================================================

const MAX_BODY_BYTES = 128 * 1024;   // corps POST max
const MAX_REPORTS = 20;               // rapports max par POST
const MAX_REPORT_BYTES = 16 * 1024;   // taille max d'un rapport re-sanitize
const FIELD_MAX = {
  app: 64, version: 64, module: 32, type: 80,
  message: 4000, stack: 12000, timestamp: 64,
};
const OS_MAX = { platform: 32, release: 64, version: 128 };
const EXTRA_MAX = 4000;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Re-sanitization cote serveur : ne conserve QUE les champs connus, avec
// des bornes — le client sanitise deja, ceci est une ceinture+bretelles
// contre un client modifie ou un bug d'assainissement.
function cleanReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const k of ['app', 'version', 'module', 'type', 'message', 'stack', 'timestamp']) {
    const v = str(r[k], FIELD_MAX[k]);
    if (v) out[k] = v;
  }
  if (typeof r.exitCode === 'number' && Number.isFinite(r.exitCode)) out.exitCode = r.exitCode;
  if (r.os && typeof r.os === 'object') {
    const os = {};
    for (const k of ['platform', 'release', 'version']) {
      const v = str(r.os[k], OS_MAX[k]);
      if (v) os[k] = v;
    }
    if (Object.keys(os).length) out.os = os;
  }
  if (r.extra != null) {
    let j;
    try { j = JSON.stringify(r.extra); } catch { j = null; }
    if (j && j.length <= EXTRA_MAX) {
      try { out.extra = JSON.parse(j); } catch {}
    }
  }
  if (!out.module || !out.type) return null; // rapport sans type = inutile
  const json = JSON.stringify(out);
  if (json.length > MAX_REPORT_BYTES) {
    out.stack = '';
    delete out.extra;
    if (JSON.stringify(out).length > MAX_REPORT_BYTES) return null;
  }
  return out;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64utf8(text) {
  // btoa travaille en Latin-1 : on passe par l''echappement UTF-8 standard.
  return btoa(unescape(encodeURIComponent(text)));
}

async function putReport(env, path, content) {
  const branch = env.GITHUB_BRANCH || 'main';
  const apiPath = `/repos/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'soundfart-reports-worker',
    },
    body: JSON.stringify({
      message: `rapport ${path.split('/').pop()}`,
      content: b64utf8(content),
      branch,
    }),
  });
  // 422 = fichier deja present (le nom est un hash du contenu) : un
  // doublon est donc IDEMPOTENT — on le compte comme stocke, pas en echec.
  return res.ok || res.status === 422;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'soundfart-reports' });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'POST uniquement' }, { status: 405 });
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      return Response.json({ error: 'service non configure' }, { status: 500 });
    }
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY_BYTES) {
      return Response.json({ error: 'trop volumineux' }, { status: 413 });
    }
    let body;
    try { body = await request.text(); } catch {
      return Response.json({ error: 'corps illisible' }, { status: 400 });
    }
    if (body.length > MAX_BODY_BYTES) {
      return Response.json({ error: 'trop volumineux' }, { status: 413 });
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      return Response.json({ error: 'JSON invalide' }, { status: 400 });
    }
    const list = Array.isArray(parsed && parsed.reports) ? parsed.reports : null;
    if (!list || !list.length) {
      return Response.json({ error: 'reports[] requis' }, { status: 400 });
    }
    if (list.length > MAX_REPORTS) {
      return Response.json({ error: 'trop de rapports' }, { status: 413 });
    }

    const date = new Date().toISOString().slice(0, 10);
    let stored = 0, failed = 0, skipped = 0;
    for (const raw of list) {
      const clean = cleanReport(raw);
      if (!clean) { skipped++; continue; }
      const content = JSON.stringify(clean, null, 2);
      const hash = await sha256Hex(content).then((h) => h.slice(0, 16));
      const path = `reports/${date}/${hash}.json`;
      try {
        if (await putReport(env, path, content)) stored++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return Response.json({ ok: failed === 0, stored, failed, skipped }, { status: failed ? 502 : 202 });
  },
};
