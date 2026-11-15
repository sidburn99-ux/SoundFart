# SoundFart — Spécification fonctionnelle (pour évaluation par IA)

> Rôle : spécification technique de référence (architecture, flux, IPC, formats). Statut : **actuel** (v1.4.0). À consulter : pour comprendre ou modifier le code ; ne jamais aligner la spec sur le code sans vérification.

> Document de référence décrivant **fidèlement** ce que fait le programme tel qu'implémenté (v1.4.0). Utilisable tel quel comme prompt d'évaluation.

---

## Contexte

**SoundFart** est une soundboard Windows pour Discord, développée en **Electron 45** (JavaScript vanilla, zéro framework, zéro dépendance runtime). Objectif : jouer des sons dans un salon vocal Discord via un câble virtuel audio (VB-CABLE), pendant qu'on joue, avec une interface sombre et compacte.

- **Livrable** : `dist\SoundFart.exe` portable (~375 Mo, compression `store`). Aucun prérequis pour l'utilisateur final **hors** : VB-CABLE (installé manuellement, requis pour la diffusion Discord) ; `csc.exe` du .NET Framework (présent sur tout Windows 10/11) pour compiler les outils audio au premier usage.
- **Config** : `SoundFart-data\config.json` à côté de l'exe (repli `%APPDATA%\SoundFart\`) — les sons sont des **références** à des fichiers existants, jamais copiés ni modifiés.
- **Journal** : `SoundFart-data\soundfart.log`.
- **Outils téléchargés au premier usage** dans `SoundFart-data\tools\` : `yt-dlp.exe` (~15 Mo, import YouTube), `ffmpeg.exe` (~115 Mo, coupes MP3), `AudioEndpoint-<hash>.exe` + `AudioTap-<hash>.exe` (compilés localement depuis les `.cs` via le `csc.exe` de .NET Framework — bascule micro et capture loopback).

## Architecture

```
main.js          processus principal : IPC, config, fichiers, yt-dlp, ffmpeg,
                 raccourcis globaux, bascule micro Windows, menu F11, journal
preload.js       pont contextBridge sécurisé (contexte isolé, sandbox)
src/app.js       toute la logique renderer : moteur Web Audio, UI, bibliothèque
src/index.html   markup · src/style.css : thème sombre
```

Sécurité : CSP stricte (`default-src 'self'`), `contextIsolation`, `sandbox`, navigation bloquée, seuls les fichiers audio sont lisibles.

### Trajet audio (cartographie des chemins critiques)

**Lecture soundboard** : `fichier → sf:readFile (main, ≤512 Mo) → decodeAudioData → cache LRU 256 Mo (entrée >256 Mo non cachée, fichier >150 Mo refusé avant décodage) → AudioBufferSourceNode+GainNode par sortie → bus→DynamicsCompressor→destination`. Sorties : `cable` (périphérique `cableId`, vers Discord via VB-CABLE) et `mon` (`monId`, écoute locale) — dédupliquées par deviceId. `playGen` invalide les lectures en vol au STOP ; `voices` suit chaque voix, `onended` ou watchdog `dur+15 s` la retire ; `stopAll` stoppe sources+gains.

**Enregistrement** : 3 sources mixées dans un `MediaRecorder` — micro (`getUserMedia` + EC/NS/AGC), audio du PC (`AudioTap.exe` WASAPI loopback → PCM stéréo 48 kHz float32, 8 o/frame → stdout → IPC `sf:tapPcm` → `tapPcmRem` aligné → AudioWorklet `tap-processor` → `comp`), câble (`getUserMedia` sur CABLE Output ou repli worklet). `flush` du worklet avant `rec.start`. Mort du tap → `sf:tapDead` → arrêt + toast.

**Routage micro → Discord** : `autoSwitchMic` fait basculer l'entrée Windows par défaut sur CABLE Output (`AudioEndpoint.exe set`, rôles console+comm+multi), écrit `audio-restore.json` (ids d'origine + owner=pid) puis spawn `guard` détaché (pid+StartTime anti-réutilisation). Restauration : will-quit, `uncaughtException`, guard si mort du parent, watchdog 30 s (suspendu si l'entrée change hors SoundFart). Micro physique → `getUserMedia` → `lim` (compresseur) → bus câble — le master ne couvre que les sons.

**Cycle de vie** : `applyAudio` sérialisé (`audioApplyChain`) → `teardownAudio` (stopAll, playGen++, endVoice, ctx.close, micStream.stop) → `makeOutput` par sortie (`setSinkId`, écoute `statechange` : suspended/interrupted/closed logués). `devicechange` débouncé 500 ms → refreshDevices+resolveDevices+applyAudio. Render-process-gone → 1 reload max.

**WASAPI (AudioTap.cs)** : partagé, `AUDCLNT_STREAMFLAGS_LOOPBACK`, format via `GetMixFormat` (PCM 16/24/32 bits int + float32, WAVEFORMATEXTENSIBLE avec cbSize vérifié ; 24 bits décodé, float64 rejeté), conversion vers float32 stéréo 48 kHz (downmix multicanal, décimation par moyenne anti-repliement, upsampling linéaire), file bornée 500 ms (mode non-pcm ; en mode pcm la sortie stdout est immédiate — l'app utilise toujours pcm), parent-check par PID+StartTime toutes les 500 ms, Codes S_ tolérés, HRESULT<0 fatals avec message. `AUDCLNT_E_DEVICE_INVALIDATED` → reconnexion à chaud : Stop/Release, re-résolution complète des périphériques (l'id a pu changer), re-init (`InitTap`), file vidée — bornée à 5 tentatives (backoff 0,5→2,5 s), échec net code 2 → `tapDead` côté renderer. Init de démarrage : 5 retries (driver en cours de chargement). `timeBeginPeriod(1)` pour le Sleep(4).

**Récupération micro (AudioEndpoint.cs)** : `list`/`get`/`set`/`restore`/`guard`. `chooseRestoreIds` (JS) ≡ `RestoreFromFile` (C#) : défaut Windows non virtuel > ids d'origine > 1er non virtuel. Owner revérifié sur la même lecture que les ids (anti-TOCTOU guard/nouvelle instance). `SetDefaultEndpoint` journalise chaque rôle sur stderr.

---

## Fonctionnalités implémentées

### 1. Bibliothèque et import
- Glisser-déposer de **fichiers et dossiers** (expansion récursive, profondeur max 3).
- Formats : mp3, wav, ogg, flac, m4a, aac, opus, webm, mp4, mkv, mov, m4v.
- Référence au fichier original (chemin mémorisé, jamais copié/modifié).
- **Fichier manquant** : badge « Fichier introuvable » + action « Retrouver le fichier… » (sélecteur de fichier).
- Nom + catégorie attribuables à l'import ; menus contextuels (renommer, modifier, retirer, catégorie).
- Recherche instantanée, tri persistant (Ajout récent/ancien, Nom A→Z/Z→A, Plus utilisés, Volume).
- **Vignettes** : chaque carte affiche un emoji + dégradé de couleur déterministe (hash nom + catégorie).

### 2. Catégories
- Créer, renommer, supprimer, changer la couleur.
- Ordre manuel (▲▼), tri A→Z, Z→A, par nombre de sons — persisté.
- Glisser-déposer des sons entre catégories (sidebar).
- Vues sidebar : Tous les sons, ★ Favoris, Sans catégorie, chaque catégorie.

### 3. Favoris
- Étoile ★/☆ sur chaque carte, vue « ★ Favoris », persisté.

### 4. Regroupement par catégorie
- Case « Par catégorie » dans la topbar (persistée, activée par défaut).
- Dans « Tous les sons » et « Favoris » : en-têtes de groupe (couleur, nom, nombre) ; « Sans catégorie » en dernier.

### 5. Diffusion audio
- Clic = lecture **immédiate** vers la sortie « Discord » configurée (ex. `CABLE Input`) **et** vers l'écoute locale (casque) — un `AudioContext` Web Audio par route.
- **Limiteur** anti-saturation sur chaque sortie, volume maître global (0-100 %).
- Volume par son (0-300 %), badge si ≠ 100 %.
- **Normalisation** : par son (gain calculé sur le pic réel décodé, cible `settings.normTarget` en fraction du plein échelle — défaut 0,89 ≈ -1 dBFS, bornée 0,1–1,0 — plafonnée à ×4, peut aussi atténuer un son trop fort) et « toute la bibliothèque » — non destructive, badge ⚖.
- **Bouton STOP** global + raccourci clavier global STOP configurable (défaut `Ctrl+Alt+S`), fonction même fenêtre minimisée.
- Avertissements si la sortie Discord n'est pas un câble virtuel (évite l'écho micro).

### 6. Éditeur audio (non destructif)
- Forme d'onde affichée, repères début/fin **déplaçables à la souris**, saisie précise en secondes.
- Fondus d'entrée/sortie en millisecondes, préécoute de l'extrait.
- **Tête de lecture** temps réel sur l'onde pendant l'écoute + clic pour chercher.
- Réinitialisation ; paramètres stockés en config, appliqués à la lecture **sans modifier le fichier**.
- **Export MP3 physique** : « MP3 de l'extrait » → `ffmpeg -ss <début> -i <src> -t <durée>` produit un vrai fichier dans `<stockage>/cuts/` ; option de remplacer le son par ce MP3 (découpe/fondus réinitialisés).

### 7. Import YouTube
- Coller un lien → `yt-dlp` (téléchargé auto) analyse titre/durée.
- **Timeline vide** (début+fin) → **audio complet** du média ; timeline renseignée → extraction de l'extrait (timeline partielle = début sans fin refusée avec message explicite).
- **Si ffmpeg présent** : vrai MP3 de l'extrait (`--download-sections`) ; sinon audio complet + trim non destructif.
- Préécoute, nom + catégorie, ajout direct. Barre de progression.
- Conforme : yt-dlp standard, pas de contournement de DRM (responsabilité utilisateur).

### 8. Raccourcis clavier globaux
- Par son : clic sur le champ → appuyer sur la touche (modifiers + touche/F-key).
- Détection de conflits (raccourci déjà pris par un autre son ou STOP), badge ⌨ sur les cartes.
- Fonctionnent **application non focalisée** (globalShortcut Electron).
- STOP global configurable dans les réglages.

### 9. Enregistreur intégré
- **Multi-sources combinables** (mixées via AudioContext + DynamicsCompressor) :
  - **Micro** : périphérique au choix, avec traitement vocal (echoCancellation, noiseSuppression, autoGainControl) — la voix seule est traitée.
  - **Audio du PC** : `AudioTap.exe` (C#, WASAPI loopback) sort du **PCM float32 stéréo 48 kHz sur stdout** → relayé par IPC (`sf:tapPcm`, aligné sur 8 octets/frame) → **AudioWorklet** (`src/tap-processor.js`) → limiteur → enregistreur. **Ce flux ne passe jamais par CABLE Input** → pas d'écho Discord par construction. Repli : `getDisplayMedia` + loopback `audio:'loopback'` si le tap/worklet échoue. Garde parent par temps (500 ms, anti-réutilisation de PID) : l'orphelin meurt avec le parent.
  - **Câble SoundFart** : captation de `CABLE Output` → sons de la soundboard + micro mixé.
- Durée affichée, préécoute de l'enregistrement, nom + catégorie, ajout direct à la bibliothèque (puis ouverture de l'éditeur pour découper).
- Fichiers enregistrés en webm/opus (ou m4a/ogg selon support) dans `<stockage>/recordings/`, noms uniques.

### 10. Bascule automatique du micro Windows
- Au lancement (si activé, défaut ON) : l'entrée micro Windows par défaut passe sur **CABLE Output** via `AudioEndpoint.exe` (C#, Core Audio `IMMDeviceEnumerator` + `IPolicyConfig.SetDefaultEndpoint`, rôles console + multimedia + communications).
- Le périphérique d'origine (ex. G930) est mémorisé dans `audio-restore.json`.
- **Restauration** : uniquement si `audio-restore.json` existe (preuve d'une vraie bascule SoundFart) — à la fermeture propre, après crash/kill du process (`AudioEndpoint.exe guard <pid>` détaché, vérifie `owner` dans `audio-restore.json` + `StartTime` du process contre la réutilisation de PID), sur `uncaughtException`, et **manuellement** via le bouton « Restaurer mon micro Windows » des réglages. Sans marqueur, SoundFart ne touche **jamais** au micro (choix manuel respecté, même si l'entrée est sur un périphérique virtuel). `unhandledRejection` ne restaure pas (log seulement).
- **Watchdog** (réglage `watchdogMic`, défaut ON) : `execFile` async toutes les 30 s, anti-chevauchement ; si l'entrée est modifiée hors SoundFart, la surveillance est **suspendue pour la session** (impossible de distinguer l'utilisateur d'une app tierce comme Discord).
- Discord doit utiliser « Défaut » comme entrée pour suivre la bascule (documenté).

### 11. Stockage configurable
- Réglage « Dossier de stockage » : les fichiers **créés** par l'app (imports YouTube, enregistrements, extraits MP3) vont dans `<dossier>/imports|recordings|cuts/`. Avant chaque import YouTube et chaque enregistrement, un sélecteur de dossier est proposé (dernier dossier mémorisé dans `lastDestDir`).
- **5 sons par défaut** copiés une fois dans `<stockage>/default-sounds/` à la première installation (la bibliothèque référence ces copies).
- **Pas de migration** d'une éventuelle ancienne config `%APPDATA%\SoundFart` vers `SoundFart-data` : utiliser Export/Import JSON ou copier manuellement `config.json`.
- **Mode portable complet** : dans l'exe portable, `userData` = `SoundFart-data/` à côté de l'exe (config, outils compilés, logs, caches Electron) via `PORTABLE_EXECUTABLE_DIR` ; repli `%APPDATA%\SoundFart` si non accessible. `--test-profile` isole dans `%TEMP%\SoundFart-test`.
- **VB-CABLE** : jamais embarqué ni installé (licence VB-Audio). L'utilisateur l'installe depuis https://vb-audio.com/Cable/ ; sans câble, écran d'accueil « VB-CABLE requis » + bandeau permanent, flux câble et bascule micro auto désactivés — un autre périphérique de sortie virtuelle (ex. Voicemeeter) reste sélectionnable manuellement ; détection à chaud par `devicechange`.

### 12. Sauvegarde / export-import
- Export JSON de **toute** la config : catégories + ordre, sons (noms, chemins, volumes, favoris, raccourcis, trim/fondus, normalisation), réglages.
- Import avec confirmation (remplace la config ; fichiers audio non modifiés).
- Les sons originaux ne sont **jamais** copiés.

### 13. Menu application (F11)
- Menu natif Windows togglé par **F11** (Alt fonctionne aussi).
- Fichier : Ajouter (Ctrl+O), YouTube, Enregistreur, Exporter/Importer config, Quitter.
- Édition : Rechercher (Ctrl+F). Audio : Stopper tous les sons (raccourci STOP), Réglages.
- Affichage : vue courante (radio, catégories synchronisées) + « Regrouper par catégorie ».
- Aide : Outils de dev (F12), À propos (version).
- Version affichée à côté du nom en haut à gauche (lue depuis les métadonnées de l'app — actuellement `v1.4.0`).

### 14. Divers
- Instance unique (2e lancement → focus fenêtre), icône/thème sombre, design compact (1180×760, min 900×600).
- Journal d'erreurs + console renderer → `soundfart.log` ; F12 ouvre les DevTools.
- Persistance de tout après redémarrage.

---

## Points non vérifiés / limites connues (honnêteté)

- **Diffusion audio réelle vers Discord** non testée en conditions réelles (dépend du câble VB-CABLE installé par l'utilisateur et du réglage Discord).
- **Capture « Audio du PC »** : flux PCM AudioTap→worklet mesuré non nul en local (peak=179205), mais **non validé en appel Discord réel** (écho côté interlocuteur à vérifier).
- **VB-CABLE** : non installé par SoundFart — toute la chaîne micro/câble/Discord reste à tester après installation manuelle du pilote.
- **npm audit** : 6 vulnérabilités modérées dans `minimatch` (via electron-builder, dépendance de build **non embarquée** dans l'app) — non corrigées (le fix impose un downgrade cassant).
- **Import YouTube** : nécessite réseau + yt-dlp ; ffmpeg téléchargé au 1er usage (~115 Mo).
- Formats conteneurs exotiques (mkv, mov…) : décodage dépend de l'ffmpeg embarqué d'Electron, certains peuvent échouer.
- Raccourcis globaux : testés à l'enregistrement, pas validés en jeu.
- L'enregistreur multi-sources : micro + loopback + câble simultanés non testé en charge réelle.
- **Watchdog voix** (arrêt forcé après `dur+15 s` si `onended` ne tire pas, ex. AudioContext suspendu) : implémenté, non testé en veille/réveil réel.
- **AudioTap** : reconnexion à chaud sur `DEVICE_INVALIDATED` implémentée (5 tentatives bornées) — non testée sur débranchement USB réel ni redémarrage `audiosrv`.
- **I/O fichiers** : `files:expand`/`file:check` sont désormais asynchrones (plus de gel sur chemin réseau), non testés sur NAS injoignable réel.
- **Endurance** : aucune session de plusieurs heures mesurée (mémoire, CPU, fuites) — non réalisée.

## Scripts

- `npm.cmd start` : dev · `npm.cmd test` : tests unitaires (node:test) · `node --check <fichier>` : syntaxe · `npm.cmd run dist` : build exe portable (`build.bat` disponible) · `powershell regen-suivi.ps1` : régénère `suivi.html` depuis `suivi.tsv`.
- `run-dev.bat` : dev sans terminal · `test-env.bat` : lance l'exe portable en profil de test (`%TEMP%\SoundFart-test`).
