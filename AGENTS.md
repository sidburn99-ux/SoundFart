# AGENTS.md — SoundFart (règles permanentes)

`AGENTS.md` est la seule source de règles agents — ne pas créer de `CLAUDE.md`, `.devin/rules/` ni fichier concurrent. Le code réel fait foi : si la doc diverge, corriger la doc après vérification.

## Never

- Ne jamais modifier les originaux audio (bibliothèque, fichiers importés, enregistrements) ni les données utilisateur (`SoundFart-data`, config, `tools\`).
- Les fichiers sources du projet (code, docs, scripts) se modifient normalement ; « hors SoundFart-data » ne concerne que les données utilisateur.
- Ne jamais contourner `contextIsolation`, `nodeIntegration: false` ou `sandbox: true`.
- Ne jamais embarquer ni installer VB-CABLE (licence) — `cable:openPage` ouvre uniquement `https://vb-audio.com/Cable/` après clic.
- Ne jamais committer de secrets ni données personnelles.
- Ne jamais prétendre qu'une feature est testée sans l'avoir réellement testée (voir « Vérification »).
- Jamais de `catch {}` silencieux qui masque le diagnostic.
- `ELECTRON_RUN_AS_NODE` ne doit pas rester actif pour tester l'exe (sinon sortie silencieuse).

## Always / Ask first

- **Always** : `node --check` sur chaque JS modifié ; `npm test` ; `npm run dist` après changement fonctionnel ; `git push` après chaque commit ; statuts honnêtes dans `suivi.tsv`.
- **Ask first** : nouvelle dépendance, refonte d'un module, changement de comportement audio, push sur `main` sans autorisation, force-push ou réécriture d'historique.

## Architecture (contraignante)

```
main.js          # process main : IPC, fenêtre, audio natif, yt-dlp/ffmpeg, watchdog micro
preload.js       # contextBridge : surface API exposée au renderer
src/app.js       # renderer : UI, moteur Web Audio, enregistreur, réglages, config
src/index.html   # page unique (CSP stricte)   ·   src/style.css : thème
src/tap-processor.js  # AudioWorklet : PCM AudioTap -> graphe audio
lib/audio-utils.js    # fonctions pures partagées main/renderer (window.SFUtils)
test/            # node:test (npm test)
AudioEndpoint.cs # bascule micro Windows (compilé csc.exe à la volée)
AudioTap.cs      # loopback WASAPI -> PCM stdout
assets/          # icône exe + sons par défaut
*.bat/*.ps1      # run-dev, build, test-env, regen-suivi
suivi.tsv/html   # journal de suivi (régénérer le html après tsv)
```

Contraintes à ne pas casser :

- Chemins : `SoundFart-data\` à côté de l'exe (config, `tools\`, `soundfart.log`), repli `%APPDATA%\SoundFart\`, `--test-profile` → `%TEMP%\SoundFart-test`. Jamais de `%APPDATA%` codé en dur : `app.getPath('userData')` / `storageRoot()`.
- PCM AudioTap : float32 **stéréo** 48 kHz = **8 octets/frame** — tout découpage aligné (`main.js` tapPcmRem) ; worklet : `outputChannelCount:[2]`, `numberOfInputs:0`, `'flush'` avant `rec.start`.
- Restauration micro : uniquement si `audio-restore.json` existe — jamais forcer un virtuel→non-virtuel sans lui, jamais écraser un choix manuel.
- Crash renderer `AudioContext` (exitCode -1/143) : bug connu non résolu — le signaler s'il réapparaît, ne pas le masquer.
- `yt-dlp`/`ffmpeg` : versions épinglées + SHA-256 ; `runYt` timeout 2 min ; `yt:download` template unique par requête.
- `config.json` : écriture atomique + `.bak` ; corrompu → `.broken-<ts>` + fallback `.bak` ; `normalizeCfg` valide/déduplique à l'import.

## Commandes

Node.js ≥ 18 requis (`node:test`) ; Electron 45.

```
npm test          # tests unitaires (node:test)
npm run dist      # build portable -> dist\SoundFart.exe
npm start         # dev
node --check <f>  # syntaxe JS
# Lancement test : ./test-env.bat, ou sous bash : env -u ELECTRON_RUN_AS_NODE ./dist/SoundFart.exe [--test-profile]
```

## Pièges d'environnement

- Git Bash mange les flags `/x` de `csc.exe` → utiliser `-nologo -target:exe …` (ou cmd).
- `npm run dist` échoue si `dist\SoundFart.exe` tourne (verrou fichier) — faire fermer l'app d'abord.
- `.bat` neutralisent déjà `ELECTRON_RUN_AS_NODE` ; en bash, préfixer `env -u`.

## Git

- `C:\Program Files\Git\cmd\git.exe`. Remote : `git@github.com:sidburn99-ux/SoundFart.git` — **SSH uniquement** (`~/.ssh/id_ed25519`).
- Commits locaux sur la branche de travail, `git push` après chaque commit — jamais de push direct sur `main` sans autorisation (PR via `gh pr create` pour docs et changements multi-fichiers).
- Un commit par changement cohérent, message en français axé « pourquoi » + trailer Devin. Vérifier le diff avant ; jamais de secrets, temporaires ou changements étrangers.

## Travail

- Subagents (`run_subagent`) : audits, exploration parallèle, bugs complexes — quand pertinent, pas systématiquement.
- Ne pas s'arrêter avant la fin ; enchaîner les corrections indépendantes. Question seulement si blocage réel.
- Pas de refonte ni de feature non demandée. Préserver ce qui fonctionne ; en cas de doute, ne pas modifier.

## Vérification — honnêteté obligatoire

- Distinguer : écrit / compilé / testé auto / testé réel / validé terrain ; sinon statut « NON testé ».
- UI : lancement + `soundfart.log` vérifié. Audio : niveau non nul mesuré, pas juste « fichier créé ».

## Documentation

- Livraison/release : invoquer le skill `release` (`.devin/skills/release/SKILL.md`) — il exécute la Definition of Done.
- `suivi.tsv` + `suivi.html` (régénérer via `regen-suivi.ps1`) : à jour à chaque changement significatif ; le TSV est la source, le HTML jamais édité à la main.
- Tout changement de comportement → mettre à jour les docs impactées (`SPECIFICATION.md` pour le technique, `GUIDE.md` pour l'utilisateur, `README.md` si visible) ; jamais de comportement documenté qui n'existe pas.
- `TECHNICAL_HARDENING_PLAN.md` : vidé ou archivé en fin de mission hardening — ne pas le laisser pourrir avec des constats obsolètes.

## Pour faire X, lis Y

| Besoin | Document |
|---|---|
| Présentation du projet | `README.md` |
| Architecture et flux | `SPECIFICATION.md` |
| Utiliser l'application | `GUIDE.md` |
| État d'avancement et tests | `suivi.tsv` |
| Tester sur VM Windows propre | `TESTS_VM.md` |
| Historique des versions | `JOURNAL.md`, `JOURNAL_DE_DEVELOPMENT.md` |
| Reprendre un chantier hardening | `TECHNICAL_HARDENING_PLAN.md` |
| Mentions légales | `THIRD-PARTY-NOTICES` |

## Ne pas lire par défaut

`JOURNAL.md`, `JOURNAL_DE_DEVELOPMENT.md`, `suivi.html` (généré), `TECHNICAL_HARDENING_PLAN.md` (sauf mission hardening), `dist/` (sauf pour vérifier le build).

## Definition of Done

- [ ] `node --check` OK sur chaque JS modifié, `npm test` vert
- [ ] `npm run dist` OK si changement fonctionnel
- [ ] Tests réels effectués ou explicitement marqués « NON testé »
- [ ] `suivi.tsv` + `suivi.html` à jour, docs impactées corrigées
- [ ] Commit + `git push` de la branche de travail (SSH) effectués
- [ ] Rapport : fichiers, tests, restes, commits
