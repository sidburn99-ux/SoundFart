# AGENTS.md — SoundFart (règles permanentes)

Toute intervention sur ce dépôt respecte ce fichier. `AGENTS.md` est la seule source de règles agents — ne pas créer de `CLAUDE.md` ni fichier concurrent. Le code réel fait foi : si la doc diverge, corriger la doc après vérification.

## Arborescence

```
main.js          # process main : IPC, fenêtres, audio natif, yt-dlp/ffmpeg, watchdog micro
preload.js       # contextBridge : surface API exposée au renderer
src/app.js       # renderer : UI, moteur Web Audio, enregistreur, réglages, config
src/index.html   # page unique (CSP stricte)
src/style.css    # styles
src/tap-processor.js  # AudioWorklet : PCM AudioTap -> graphe audio
lib/audio-utils.js    # fonctions pures partagées main/renderer (window.SFUtils)
test/            # node:test (npm test)
AudioEndpoint.cs # bascule micro Windows (compilé csc.exe à la volée)
AudioTap.cs      # loopback WASAPI -> PCM stdout
assets/          # icône exe + sons par défaut
```

## Limites

- **Always** : `node --check` sur chaque JS modifié ; `npm test` ; `npm run dist` après changement fonctionnel ; `git push` après chaque commit ; statuts de test honnêtes dans `suivi.tsv`.
- **Ask first** : nouvelle dépendance, refonte d'un module, changement de comportement audio existant, écriture hors `SoundFart-data`, force-push ou réécriture d'historique.
- **Never** : modifier les originaux audio ; contourner `contextIsolation`/`nodeIntegration`/`sandbox` ; embarquer ou installer VB-CABLE ; committer des secrets ; prétendre qu'une feature marche sans test réel ; `catch {}` silencieux qui masque le diagnostic ; `ELECTRON_RUN_AS_NODE` laissé actif pour tester l'exe.

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
- Un commit par changement cohérent, message axé "pourquoi". Vérifier le diff avant.
- Jamais de secrets, fichiers temporaires ou changements étrangers.

## Chemins

- Données : `SoundFart-data\` à côté de l'exe — config, `tools\`, `soundfart.log`. Repli `%APPDATA%\SoundFart\`. `--test-profile` → `%TEMP%\SoundFart-test`.
- Ne jamais codifier `%APPDATA%` en dur : `app.getPath('userData')` / `storageRoot()`.

## Pièges connus (ne pas réintroduire)

- `ELECTRON_RUN_AS_NODE=1` dans l'env → exe exécuté en Node pur, sortie silencieuse. Tests de lancement : `env -u ELECTRON_RUN_AS_NODE`.
- PCM AudioTap : float32 **stéréo** 48 kHz = **8 octets/frame** — tout découpage doit rester aligné (`main.js` tapPcmRem) ; worklet : `outputChannelCount:[2]`, `numberOfInputs:0`, message `'flush'` avant `rec.start`.
- Restauration micro : uniquement si `audio-restore.json` existe (marqueur d'une vraie bascule) — ne jamais forcer un virtuel→non-virtuel sans lui, ne jamais écraser un choix manuel.
- Crash renderer `AudioContext` (exitCode -1/143) : bug connu non résolu — le signaler s'il réapparaît, ne pas le masquer.
- `yt-dlp`/`ffmpeg` : versions épinglées + SHA-256 ; `runYt` a un timeout 2 min ; sortie `yt:download` template unique par requête.
- `config.json` : écriture atomique + `.bak` ; corrompu → `.broken-<ts>` + fallback `.bak` ; `normalizeCfg` valide/déduplique à l'import.
- `VB-CABLE` : JAMAIS embarqué ni installé (licence) — ouverture https://vb-audio.com/Cable/ uniquement après clic, URL fixe.

## Travail

- Subagents (`run_subagent`) : audits, exploration parallèle, bugs complexes — quand pertinent, pas systématiquement.
- Ne pas s'arrêter avant la fin ; enchaîner les corrections indépendantes. Question seulement si blocage réel, poursuivre le reste sinon.
- Pas de refonte ni de feature non demandée. Préserver ce qui fonctionne ; en cas de doute, ne pas modifier.

## Vérification — honnêteté obligatoire

- Audio : niveau non nul **mesuré**, pas juste « fichier créé ». UI : lancement + `soundfart.log` vérifié. Sinon statut « NON testé ».
- Distinguer : écrit / compilé / testé auto / testé réel / validé terrain.

## Documentation

- `README.md`, `SPECIFICATION.md`, `GUIDE.md`, `JOURNAL*.md`, `TESTS_VM.md`, `THIRD-PARTY-NOTICES`.
- `suivi.tsv` + `suivi.html` (régénérer via `regen-suivi.ps1`) : à jour à chaque changement significatif.
- Mettre à jour les docs impactées ; jamais de comportement documenté qui n'existe pas.

## Definition of Done

- [ ] `node --check` OK sur chaque JS modifié, `npm test` vert
- [ ] `npm run dist` OK si changement fonctionnel
- [ ] Tests réels effectués ou explicitement marqués « NON testé »
- [ ] `suivi.tsv` + `suivi.html` à jour, docs impactées corrigées
- [ ] Commit + `git push` (SSH) effectués
- [ ] Rapport : fichiers, tests, restes, commits
