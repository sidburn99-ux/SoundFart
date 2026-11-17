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
| `GITHUB_TOKEN` | secret (`wrangler secret put`) | PAT GitHub **fine-grained** idéalement : `Contents: Read and write` sur **ce seul dépôt privé** (sinon PAT classique scope `repo`) |
| `GITHUB_REPO` | var | `propriétaire/nom-du-depot` |
| `GITHUB_BRANCH` | var (optionnel) | branche cible, défaut `main` |

Checklist de vérification après déploiement :

```bash
curl https://<worker>.workers.dev/healthz        # {"ok":true,...}
curl -X POST https://<worker>.workers.dev/ -H 'Content-Type: application/json' -d '{"reports":[]}'   # 400 attendu
# Puis test réel : SOUNDFART_REPORT_URL=https://<worker>.workers.dev npm start
# provoquer une erreur (ou envoyer un rapport test) -> vérifier le fichier
# reports/AAAA-MM-JJ/<hash>.json dans le dépôt privé.
```

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
- Token GitHub : préférer un **fine-grained PAT** limité à
  `Contents: Read and write` sur le seul dépôt de rapports — un PAT
  classique `repo` donne accès à TOUS les dépôts privés du compte.
- **Honnêteté** : la transmission réelle n'a PAS été testée sans service
  déployé — `endpoint` vide côté client = file locale conservée, aucun
  envoi, aucune erreur. Le handler a été testé localement (healthz,
  rejets 400/413/415/429, POST → appel API GitHub). Après `wrangler
  deploy`, faire le test de bout en bout décrit ci-dessus.
