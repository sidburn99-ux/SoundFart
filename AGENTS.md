# AGENTS.md — SoundFart (règles permanentes)

`AGENTS.md` est la seule source de règles agents — ne pas créer de `CLAUDE.md` ni fichier concurrent. Le code réel fait foi : si la doc diverge, corriger la doc après vérification.

## Règles critiques — Never

- Ne jamais modifier les originaux audio.
- Ne jamais contourner `contextIsolation`, `nodeIntegration: false` ou `sandbox: true`.
- Ne jamais embarquer ni installer VB-CABLE (licence) — `cable:openPage` ouvre uniquement `https://vb-audio.com/Cable/` après clic, URL fixe.
- Ne jamais committer de secrets, tokens, mots de passe ou données personnelles.
- Ne jamais prétendre qu'une feature marche sans test réel ; audio = niveau non nul **mesuré**.
- Jamais de `catch {}` silencieux qui masque le diagnostic.
- `ELECTRON_RUN_AS_NODE` ne doit pas rester actif pour tester l'exe.

## Règles critiques — Always / Ask first

- **Always** : `node --check` sur chaque JS modifié ; `npm test` ; `npm run dist` après changement fonctionnel ; `git push` après chaque commit ; statuts de test honnêtes dans `suivi.tsv`.
- **Ask first** : nouvelle dépendance, refonte d'un module, changement de comportement audio existant, écriture hors `SoundFart-data`, force-push ou réécriture d'historique.

## Architecture (contraignante)

```
main.js          # process main : IPC, fenêtre, audio natif, yt-dlp/ffmpeg, watchdog micro
preload.js       # contextBridge : surface API exposée au renderer
src/app.js       # renderer : UI, moteur Web Audio, enregistreur, réglages, config
src/index.html   # page unique (CSP stricte)
src/style.css    # thème
src/tap-processor.js  # AudioWorklet : PCM AudioTap -> graphe audio
lib/audio-utils.js    # fonctions pures partagées main/renderer (window.SFUtils)
test/            # node:test (npm test)
AudioEndpoint.cs # bascule micro Windows (compilé csc.exe à la volée)
AudioTap.cs      # loopback WASAPI -> PCM stdout
assets/          # icône exe + sons par défaut
```

- Chemins : `SoundFart-data\` à côté de l'exe (portable), repli `%APPDATA%\SoundFart\`, `--test-profile` → `%TEMP%\SoundFart-test`. Ne jamais coder `%APPDATA%` en dur : `app.getPath('userData')` / `storageRoot()`. Détail : SPECIFICATION.md.
- PCM AudioTap : float32 **stéréo** 48 kHz = **8 octets/frame** — tout découpage aligné (`main.js` tapPcmRem) ; worklet : `outputChannelCount:[2]`, `numberOfInputs:0`, message `'flush'` avant `rec.start`.
- Restauration micro : uniquement si `audio-restore.json` existe (marqueur d'une vraie bascule) — ne jamais forcer un virtuel→non-virtuel sans lui, ne jamais écraser un choix manuel.
- Crash renderer `AudioContext` (exitCode -1/143) : bug connu non résolu — le signaler s'il réapparaît, ne pas le masquer.
- `yt-dlp`/`ffmpeg` : versions épinglées + SHA-256 ; `runYt` timeout 2 min ; `yt:download` template unique par requête.
- `config.json` : écriture atomique + `.bak` ; corrompu → `.broken-<ts>` + fallback `.bak` ; `normalizeCfg` valide/déduplique à l'import.

## Commandes

```
npm test          # tests unitaires (node:test)
npm run dist      # build portable -> dist\SoundFart.exe
npm start         # dev
node --check <f>  # syntaxe JS
# Lancement test : env -u ELECTRON_RUN_AS_NODE ./dist/SoundFart.exe [--test-profile]
```

## Git

- `C:\Program Files\Git\cmd\git.exe`. Remote : `git@github.com:sidburn99-ux/SoundFart.git` — **SSH uniquement** (`~/.ssh/id_ed25519`).
- Un commit par changement cohérent, message axé « pourquoi ». Vérifier le diff avant.
- Jamais de secrets, fichiers temporaires ou changements étrangers.

## Travail

- Subagents (`run_subagent`) : audits, exploration parallèle, bugs complexes — quand pertinent, pas systématiquement.
- Ne pas s'arrêter avant la fin ; enchaîner les corrections indépendantes. Question seulement si blocage réel, poursuivre le reste sinon.
- Pas de refonte ni de feature non demandée. Préserver ce qui fonctionne ; en cas de doute, ne pas modifier.

## Vérification — honnêteté obligatoire

- Distinguer : écrit / compilé / testé auto / testé réel / validé terrain.
- UI : lancement + `soundfart.log` vérifié. Audio : niveau non nul mesuré, pas juste « fichier créé ».

## Documentation

- `suivi.tsv` + `suivi.html` (régénérer via `regen-suivi.ps1`) : à jour à chaque changement significatif ; le TSV est la source, le HTML n'est jamais édité à la main.
- Mettre à jour les docs impactées ; jamais de comportement documenté qui n'existe pas.

## Pour faire X, lis Y

| Besoin | Document |
|---|---|
| Comprendre l'architecture et les flux | `SPECIFICATION.md` |
| Utiliser l'application (fonctions, réglages) | `GUIDE.md` |
| État d'avancement et statut des tests | `suivi.tsv` |
| Tester sur une VM Windows propre | `TESTS_VM.md` |
| Historique des versions et décisions passées | `JOURNAL.md`, `JOURNAL_DE_DEVELOPMENT.md` |
| Reprendre un chantier d'audit/correction | `TECHNICAL_HARDENING_PLAN.md` |
| Mentions légales des dépendances | `THIRD-PARTY-NOTICES` |

## Ne pas lire par défaut

`JOURNAL.md`, `JOURNAL_DE_DEVELOPMENT.md`, `suivi.html` (généré), `TECHNICAL_HARDENING_PLAN.md` (sauf mission hardening), `dist/`.

## Definition of Done

- [ ] `node --check` OK sur chaque JS modifié, `npm test` vert
- [ ] `npm run dist` OK si changement fonctionnel
- [ ] Tests réels effectués ou explicitement marqués « NON testé »
- [ ] `suivi.tsv` + `suivi.html` à jour, docs impactées corrigées
- [ ] Commit + `git push` (SSH) effectués
- [ ] Rapport : fichiers, tests, restes, commits
