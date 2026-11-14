# AGENTS.md — Règles de développement SoundFart (immuables)

## Stack
- Electron 45 (main: `main.js`, preload: `preload.js`, renderer: `src/app.js` + `src/index.html` + `src/style.css`)
- Vanila JS, pas de framework. Outils natifs C# compilés à la volée via `csc.exe` dans `SoundFart-data\tools\` (à côté de l'exe ; repli `%APPDATA%\SoundFart\tools`)
- Build : `npm run dist` → `dist\SoundFart.exe` — application PORTABLE uniquement, aucun installeur ni désinstalleur.
- Config : `SoundFart-data\config.json` (à côté de l'exe) — Log : `SoundFart-data\soundfart.log` ; repli `%APPDATA%\SoundFart\` si dossier de données non accessible ; `--test-profile` isole dans `%TEMP%\SoundFart-test`.

## Règles de travail OBLIGATOIRES

### Git
- Git est OBLIGATOIRE pour versionner CHAQUE changement.
- Git est installé à `C:\Program Files\Git\cmd\git.exe` (ajouter au PATH des sessions ou appeler par chemin absolu).
- Remote : GitHub `git@github.com:sidburn99-ux/SoundFart.git` — **SSH uniquement** (clé `~/.ssh/id_ed25519`, compte `sidburn99-ux`).
- **`git push` OBLIGATOIRE après CHAQUE commit** — le remote doit toujours être à jour.
- Un commit par changement cohérent, message clair axé "pourquoi".
- Ne jamais committer de secrets. `.gitignore` couvre `node_modules/`, `dist/`, `*.log`.

### Subagents
- Utiliser des subagents (`run_subagent`) pour diviser les tâches et explorer en parallèle quand c'est pertinent.
- Ne pas s'arrêter tant que la tâche demandée n'est pas entièrement implémentée.

### Vérification
- Après chaque modification : `node --check` sur les JS modifiés.
- Rebuild `npm run dist` après tout changement fonctionnel.
- Tests de régression : relancer l'app, vérifier `soundfart.log`, tester les flux touchés.
- NE JAMAIS prétendre qu'une feature audio marche sans test réel (niveau non nul mesuré, pas juste "fichier créé").

### Suivi
- `suivi.tsv` à la racine = journal de suivi des fonctionnalités/tests (colonnes : date, feature, statut, note).
- `suivi.html` = page de consultation générée depuis le TSV, ouvrable via `file://` (HTML+CSS inline, AUCUN serveur web, AUCUNE dépendance externe).
- Mettre à jour le TSV à chaque changement significatif, régénérer le HTML.

### Code
- Pas de commentaires superflus ; style compact ; suivre les conventions existantes.
- Les originaux audio ne sont JAMAIS modifiés.
- Les outils (yt-dlp, ffmpeg, AudioEndpoint, AudioTap) se téléchargent/compilent à la volée dans `%APPDATA%\SoundFart\tools\`.
- Sécurité : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — ne jamais contourner.

## Architecture audio (rappel)
- Sortie sons → Web Audio → `CABLE Input` (rendu) ; monitoring → périphérique `monId`.
- Micro → `getUserMedia` avec EC/NS/AGC → mixé vers CABLE Input + monitoring.
- Enregistreur : sources micro + audio PC (via `AudioTap.exe` loopback WASAPI en mode `pcm` → IPC → AudioWorklet, SANS passer par le câble) + câble SoundFart, mixées.
- `AudioEndpoint.exe` : bascule auto du micro par défaut vers CABLE Output au lancement ; restauration à la fermeture, après crash (`guard <pid>` détaché), ou manuellement (bouton « Restaurer mon micro Windows »).
- `VB-CABLE` : JAMAIS embarqué ni installé par SoundFart (licence VB-Audio : redistribution interdite sans accord). L'utilisateur l'installe depuis https://vb-audio.com/Cable/ ; l'app détecte les endpoints et invite via un lien dans les réglages.
