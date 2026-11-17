# Service de collecte de rapports d'erreurs SoundFart

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

## Déploiement

```bash
cd service
npm i -g wrangler   # ou npx wrangler
wrangler login
wrangler secret put GITHUB_TOKEN   # PAT « repo » sur un dépôt PRIVÉ dédié
# éditer wrangler.toml : décommenter name/main/[vars], renseigner GITHUB_REPO
wrangler deploy
```

Secrets et variables :

| Nom | Type | Rôle |
|---|---|---|
| `GITHUB_TOKEN` | secret (`wrangler secret put`) | PAT GitHub, scope `repo` (contents:write), dépôt **privé** uniquement |
| `GITHUB_REPO` | var | `propriétaire/nom-du-depot` |
| `GITHUB_BRANCH` | var (optionnel) | branche cible, défaut `main` |

Côté client : renseigner `REPORT_ENDPOINT` dans `main.js` (constante à
éditer au déploiement — **jamais de secret dans l'exe**, l'URL seule ne
permet que d'écrire des rapports déjà validés) ou lancer avec
`SOUNDFART_REPORT_URL=https://<worker>.workers.dev`.

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
  d'en cacher un dans un exe). La protection = validation stricte
  (taille, type, champs whitelistés, 20 rapports/POST max, 128 Ko max)
  + dépôt privé. Du spam resterait visible comme commits git.
- **Pas de rate-limit** par IP (nécessiterait KV) : à ajouter si abus.
- **Honnêteté** : la transmission réelle n'a PAS été testée sans service
  déployé — `endpoint` vide côté client = file locale conservée, aucun
  envoi, aucune erreur. Tester après `wrangler deploy` avec
  `SOUNDFART_REPORT_URL` pointée sur le worker.
