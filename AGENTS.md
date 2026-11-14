# AGENTS.md — SoundFart (règles permanentes)

Toute intervention sur ce dépôt doit respecter ce fichier. Le code réel fait foi : si la doc diverge, corriger la doc après vérification.

## Stack

- Electron 45 — `main.js` (main), `preload.js` (bridge), `src/app.js` + `src/index.html` + `src/style.css` (renderer vanilla JS, aucun framework).
- Outils natifs C# compilés à la volée via `csc.exe` : `AudioEndpoint.cs` (bascule micro Windows), `AudioTap.cs` (loopback WASAPI → PCM).
- `yt-dlp.exe` + `ffmpeg.exe` téléchargés au premier usage, versions épinglées, SHA-256 vérifié.
- `lib/audio-utils.js` : fonctions pures partagées main/renderer (`window.SFUtils`). Tests : `test/audio-utils.test.js` (`node:test`).

## Chemins (mode portable)

- Exe : `dist\SoundFart.exe` via `npm run dist` — **portable uniquement**, pas d'installeur.
- Données : `SoundFart-data\` à côté de l'exe (`PORTABLE_EXECUTABLE_DIR`) — config, `tools\`, `soundfart.log`, caches. Repli `%APPDATA%\SoundFart\` si non accessible. `--test-profile` → `%TEMP%\SoundFart-test`.
- Ne jamais codifier `%APPDATA%` en dur : résoudre via `app.getPath('userData')` / `storageRoot()`.
- **Piège** : `ELECTRON_RUN_AS_NODE=1` dans l'environnement fait exécuter l'exe en Node pur → sortie silencieuse. Toujours `env -u ELECTRON_RUN_AS_NODE` pour les tests de lancement.

## Git — OBLIGATOIRE

- Git : `C:\Program Files\Git\cmd\git.exe`. Remote : `git@github.com:sidburn99-ux/SoundFart.git` — **SSH uniquement** (`~/.ssh/id_ed25519`).
- **`git push` après CHAQUE commit** — le remote reste à jour en permanence.
- Un commit par changement cohérent, message axé "pourquoi". Vérifier le diff avant.
- Jamais de secrets, fichiers temporaires ou changements étrangers. Jamais de force-push/reset destructif/réécriture d'historique sans autorisation explicite.

## Travail

- **Subagents** (`run_subagent`) : pour audits, exploration parallèle, bugs complexes — quand c'est pertinent, pas systématiquement.
- Ne pas s'arrêter avant la fin de la tâche ; enchaîner les corrections indépendantes sans attendre. Poser une question uniquement si un blocage l'exige, et poursuivre le reste en parallèle.
- Pas de refonte ni de feature non demandée. Préserver ce qui fonctionne ; en cas de doute, ne pas modifier.
- Pas de `catch {}` silencieux qui masque une erreur utile au diagnostic.

## Vérification — honnêteté obligatoire

- Après chaque JS modifié : `node --check`. Tests : `npm test`. Build : `npm run dist` après tout changement fonctionnel.
- **Jamais prétendre qu'une feature marche sans test réel** : audio = niveau non nul mesuré ; UI = lancement + log `soundfart.log` vérifié ; sinon statut « NON testé » explicite dans `suivi.tsv`.
- Distinguer : écrit / compilé / testé auto / testé réel / validé terrain.

## Audio — règles dures

- Originaux audio JAMAIS modifiés (édition = trim/fondu/normalisation non destructive uniquement).
- Routage : sons → `CABLE Input` (Discord) ; monitoring → casque ; micro → mixé sur le câble avec EC/NS/AGC.
- `AudioTap` PCM : float32 stéréo 48 kHz, 8 octets/frame — toute modification de la chaîne doit préserver l'alignement.
- Restauration micro : uniquement les changements réellement effectués par SoundFart (`audio-restore.json` = marqueur). Ne jamais forcer un périphérique virtiel→non-virtuel sans ce marqueur, ne jamais écraser un choix manuel de l'utilisateur.
- `VB-CABLE` : JAMAIS embarqué ni installé (licence VB-Audio). L'utilisateur l'installe depuis https://vb-audio.com/Cable/ — ouverture uniquement après clic, URL fixe dans `main.js`.
- Crash renderer `AudioContext` (exitCode -1/143) : **bug connu non résolu** — ne pas le masquer, le signaler s'il réapparaît.

## Sécurité Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — ne jamais contourner.
- Tout handler IPC passe par le garde `fromApp` (page `index.html` uniquement). Valider types/bornes/chemins (`path.isAbsolute`, whitelist extensions) de chaque argument.
- `openExternal` : URL fixe uniquement. Pas d'exécution de commande depuis des données utilisateur. Pas de secrets dans le dépôt.

## Config & données

- Écriture atomique (`tmp` + rename) + `.bak` ; JSON corrompu → `.broken-<ts>` + fallback `.bak`.
- `normalizeCfg` : valider/dédupliquer à l'import (types, bornes, ids uniques) — une config pourrie ne doit ni crasher l'UI ni casser l'audio.
- `suivi.tsv` + `suivi.html` (régénéré via `regen-suivi.ps1`) : tenus à jour à chaque changement significatif, statuts honnêtes.

## Documentation

- `README.md` (usage), `SPECIFICATION.md` (spec réelle), `GUIDE.md` (guide), `JOURNAL*.md` (historique), `TESTS_VM.md` (tests manuels VM), `THIRD-PARTY-NOTICES`.
- Mettre à jour les docs impactées par chaque changement ; jamais de comportement documenté qui n'existe pas.

## Rapport de fin de tâche

À la fin d'un chantier/session : modifications, fichiers, tests exécutés + résultats, ce qui n'a PAS été testé, bugs restants, commits + état du push, prochaines étapes. Ne jamais déclarer terminé si des vérifications indispensables manquent.
