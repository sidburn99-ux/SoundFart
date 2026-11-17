# Service de collecte de rapports d'erreurs SoundFart

**Déployé et fonctionnel** : `https://soundfart-reports.sidburn99.workers.dev`
(compte Cloudflare `Sidburn99@gmail.com's Account`). Le test de bout en
bout a été effectué le 17/11/2026 : POST → `{"ok":true,"stored":1,...}` →
fichier `reports/2026-11-17/<hash>.json` vérifié dans le dépôt privé.

Reçoit les rapports d'erreurs/crashs **opt-in** envoyés par SoundFart
(consentement `settings.crashReport === 'yes'` dans la config utilisateur)
et les archive dans un **dépôt GitHub privé** via l'API Contents.
Aucune issue n'est jamais créée — le worker n'appelle que
`PUT /repos/{repo}/contents/{path}`.

## Pourquoi GitHub plutôt que KV/D1

- Les rapports sont destined à être **lus par un humain** (diagnostic) :
  un dépôt git donne historique, recherche (`git log -S`, GitHub search)
  et consultation sans outillage supplémentaire.
- KV/D1 seraient plus simples à interroger mais ajoutent une dépendance
  de schéma et masquent les rapports dans un format moins lisible.
- Volume attendu très faible (crashs uniquement, dédup 5 min côté client)
  → l'API Contents (limite ~5 000 req/h sur PAT) suffit largement.

## Prérequis (une fois)

1. **Dépôt GitHub privé** `SoundFart-reports` dans le compte du projet
   (GitHub → New repository → Private, sans README ni licence).
2. **Fine-grained Personal Access Token** :
   GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token :
   - *Repository access* : **Only select repositories** → `SoundFart-reports`
   - *Permissions* : **Contents → Read and write** (rien d'autre)
   - Expiration : au choix (prévoir le renouvellement)

## Déploiement

```bash
cd service
npm i -g wrangler   # ou npx wrangler
wrangler login
wrangler secret put GITHUB_TOKEN   # Fine-grained PAT : Contents R/W sur SoundFart-reports
# GITHUB_REPO / GITHUB_BRANCH sont deja dans wrangler.toml — adapter si besoin
wrangler deploy
```

Secrets et variables :

| Nom | Type | Rôle |
|---|---|---|
| `GITHUB_TOKEN` | secret (`wrangler secret put`) | **Fine-grained PAT uniquement** : `Contents: Read and write`, limité au seul dépôt privé `SoundFart-reports` — ne pas utiliser un PAT classique `repo` (accès à tous les dépôts privés du compte) |
| `GITHUB_REPO` | var (`wrangler.toml`) | `sidburn99-ux/SoundFart-reports` — adapter si le dépôt diffère |
| `GITHUB_BRANCH` | var (`wrangler.toml`) | `main` |

Checklist de vérification après déploiement :

```bash
curl https://<worker>.workers.dev/healthz        # {"ok":true,...}
curl -X POST https://<worker>.workers.dev/ -H 'Content-Type: application/json' -d '{"reports":[]}'   # 400 attendu
# Puis test réel : SOUNDFART_REPORT_URL=https://<worker>.workers.dev npm start
# provoquer une erreur (ou envoyer un rapport test) -> vérifier le fichier
# reports/AAAA-MM-JJ/<hash>.json dans le dépôt privé.
```

Côté client : `REPORT_ENDPOINT` dans `main.js` vaut par défaut
`https://soundfart-reports.sidburn99.workers.dev` — **jamais de secret
dans l'exe**, l'URL seule ne permet que d'écrire des rapports déjà
validés. Surcharge possible en dev : `SOUNDFART_REPORT_URL=https://...`.
Le client fractionne ses envois pour rester sous les 128 Ko/20 rapports
par POST du worker (limite client : 112 Ko par requête, marge 16 Ko).

## Format du rapport

POST `application/json` vers `/` :

```json
{ "reports": [ {
    "app": "SoundFart", "version": "1.4.0",
    "os": { "platform": "win32", "release": "10.0.22631", "version": "Windows 11 Pro" },
    "module": "main|renderer|child",
    "type": "uncaughtException|render-process-gone|child-process-gone|error|unhandledrejection|unresponsive|did-fail-load",
    "message": "…", "stack": "…",
    "timestamp": "2026-…Z", "exitCode": 1,
    "extra": { }
} ] }
```

Chaque rapport est écrit dans `reports/AAAA-MM-JJ/<sha256-16>.json`
(dédoublonnage naturel : contenu identique = même fichier, PUT idempotent).

## Limites connues

- **Pas d'authentification** : l'endpoint n'est pas un secret (impossible
  d'en cacher un dans un exe). La protection = `Content-Type: application/json`
  obligatoire, validation stricte (champs whitelistés, bornes de taille,
  20 rapports/POST max, 128 Ko max), **re-sanitization du contenu**
  (chemins, username, secrets, query d'URL masqués côté serveur même si
  le client est modifié), dédup intra-batch et dépôt privé.
- **Rate-limit best-effort** : 30 POST/min/IP en mémoire d'isolate
  (remise à zéro au cold start, non partagé entre isolates — protection
  anti-rafale, pas anti-détermination). Un KV donnerait un quota strict
  par IP ; à ajouter seulement si un abus réel est observé (les commits
  git spam restent visibles et supprimables).
- Token GitHub : **fine-grained PAT obligatoire**, `Contents: Read and
  write` limité au seul dépôt `SoundFart-reports`. Un PAT classique
  `repo` donnerait accès à TOUS les dépôts privés du compte — ne pas
  l'utiliser.
- **Honnêteté** : la transmission réelle A ÉTÉ testée le 17/11/2026 —
  POST depuis `lib/crash-report.js` → `{"ok":true,"stored":1,...}` →
  fichier vérifié dans `sidburn99-ux/SoundFart-reports`. Le handler a
  été testé localement (healthz, rejets 400/413/415/429, POST → appel
  API GitHub simulé).
