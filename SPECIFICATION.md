# SoundFart — Spécification fonctionnelle (pour évaluation par IA)

> Rôle : spécification technique de référence (architecture, flux, IPC, formats). Statut : **actuel** (v1.4.0). À consulter : pour comprendre ou modifier le code ; ne jamais aligner la spec sur le code sans vérification.

> Document de référence décrivant **fidèlement** ce que fait le programme tel qu'implémenté (v1.4.0). Utilisable tel quel comme prompt d'évaluation.

---

## Contexte

**SoundFart** est une soundboard Windows pour Discord, développée en **Electron 45** (JavaScript vanilla, zéro framework, zéro dépendance runtime). Objectif : jouer des sons dans un salon vocal Discord via un câble virtuel audio (VB-CABLE), pendant qu'on joue, avec une interface sombre et compacte.

- **Livrable** : `dist\SoundFart.exe` portable (~375 Mo, compression `store`). Aucun prérequis pour l'utilisateur final **hors** : VB-CABLE (installé manuellement, requis pour la diffusion Discord) ; `csc.exe` du .NET Framework 4.x (généralement présent sur Windows 10/11 ; son absence est gérée proprement — bascule micro et AudioTap indisponibles, le reste fonctionne) pour compiler les outils audio au premier usage.
- **Config** : `%APPDATA%\SoundFart\config.json` (userData Electron) — les sons sont des **références** à des fichiers existants, jamais modifiés ; les sons **ajoutés** sont copiés dans `<dossier de sons>/sons/` (choisi par l'utilisateur, obligatoire).
- **Journal** : `%APPDATA%\SoundFart\soundfart.log`.
- **Outils téléchargés au premier usage** dans `%APPDATA%\SoundFart\tools\` : `yt-dlp.exe` (~15 Mo, import YouTube — version de repli épinglée + SHA-256, **auto-mise à jour** ~hebdo vérifiée par hash), `ffmpeg.exe` (~100 Mo, coupes MP3), `AudioEndpoint-<hash>.exe` + `AudioTap-<hash>.exe` (compilés localement depuis les `.cs` via le `csc.exe` de .NET Framework — bascule micro et capture loopback).

## Architecture

```
main.js          processus principal : IPC, config, fichiers,
                 raccourcis globaux, bascule micro Windows, menu F11, journal
main/media-tools.js  ffmpeg (coupe MP3) + yt-dlp : createMediaTools(deps)
preload.js       pont contextBridge sécurisé (contexte isolé, sandbox)
lib/audio-utils.js   fonctions pures partagées main/renderer (window.SFUtils)
lib/media-permission.js  décision permissions média (getUserMedia/displayMedia)
src/app.js       renderer core : état/config, moteur Web Audio, rendu, init
src/normalize.js normalisation LUFS · src/edit-sound.js éditeur de son
src/settings.js  réglages + export/import · src/recorder.js enregistreur
src/youtube.js   import YouTube + récupération imports orphelins — scripts
                 classiques chargés avant app.js
                 (portée globale partagée, init() voit tout)
src/tap-processor.js  AudioWorklet : PCM AudioTap → graphe audio
src/voice-gate.js     AudioWorklet : traitement vocal (filtre + noise gate)
src/index.html   markup · src/style.css : thème sombre
```

Sécurité : CSP stricte (`default-src 'self'`), `contextIsolation`, `sandbox`, navigation bloquée, seuls les fichiers audio sont lisibles.

### Trajet audio (cartographie des chemins critiques)

**Lecture soundboard** : `fichier → file:read (main, ≤512 Mo) → refus >150 Mo avant décodage → decodeAudioData (sémaphore 2, timeout 30 s — un décodage pendu après timeout est compté « zombie », borné à 2 : au-delà, nouveaux décodages refusés) → PCM >512 Mo refusé → cache LRU 256 Mo (entrée >256 Mo non cachée ; fichiers disparus purgés du cache) → AudioBufferSourceNode+GainNode par sortie → bus→DynamicsCompressor→destination`. Sorties : `cable` (périphérique `cableId`, vers Discord via VB-CABLE) et `mon` (`monId`, écoute locale) — dédupliquées par deviceId. `playGen` invalide les lectures en vol au STOP ; `voices` suit chaque voix, `onended` ou watchdog `dur+15 s` la retire ; `stopAll` stoppe sources+gains.

**Enregistrement** : 3 sources mixées dans un `MediaRecorder` — micro (`getUserMedia` + EC/NS/AGC), audio du PC (`AudioTap.exe` WASAPI loopback → PCM stéréo 48 kHz float32, 8 o/frame → stdout → IPC `sf:tapPcm` → `tapPcmRem` aligné → AudioWorklet `tap-processor` → `comp`), câble (`getUserMedia` sur CABLE Output ; le repli worklet/`systemStream` ne concerne que la source « audio du PC »). `flush` du worklet avant `rec.start`. Mort du tap → `sf:tapDead` → arrêt + toast.

**Routage micro → Discord** : `autoSwitchMic` fait basculer l'entrée Windows par défaut sur CABLE Output (`AudioEndpoint.exe set`, rôles console+comm+multi), écrit `audio-restore.json` (ids d'origine + owner=pid) puis spawn `guard` détaché **unique** (pid+StartTime anti-réutilisation ; les guards des bascules précédentes sont tués — un seul garde le pid parent ; si le parent est déjà mort au premier check, le guard tente quand même la restauration, bornée par le check `owner` du marqueur). Restauration : will-quit, `uncaughtException`, guard si mort du parent, watchdog 30 s (suspendu si l'entrée change hors SoundFart). Micro physique → `getUserMedia` → `voice-gate` AudioWorklet optionnel (filtre passe-bande + noise gate, intensités Léger/Normal/Fort/Max via `settings.voiceDsp`, repli direct si le module échoue) → `lim` (compresseur) → bus câble — **le master soundboard ne couvre pas la voix** (micro et sons découplés).

**Cycle de vie** : `applyAudio` sérialisé (`audioApplyChain`) → `teardownAudio` (stopAll, playGen++, endVoice, ctx.close, micStream.stop) → `makeOutput` par sortie (`setSinkId`, écoute `statechange` : suspended/interrupted/closed logués). `devicechange` débouncé 500 ms → refreshDevices+resolveDevices+applyAudio. Render-process-gone → 1 reload max.

**WASAPI (AudioTap.cs)** : partagé, `AUDCLNT_STREAMFLAGS_LOOPBACK`, format via `GetMixFormat` (PCM 16/24/32 bits int + float32, WAVEFORMATEXTENSIBLE avec cbSize vérifié ; 24 bits décodé, float64 rejeté), conversion vers float32 stéréo 48 kHz (downmix multicanal, décimation par moyenne anti-repliement, upsampling linéaire), file bornée 500 ms (mode non-pcm ; en mode pcm la sortie stdout est immédiate — l'app utilise toujours pcm), parent-check par PID+StartTime toutes les 500 ms, Codes S_ tolérés, HRESULT<0 fatals avec message. `AUDCLNT_E_DEVICE_INVALIDATED` → reconnexion à chaud : Stop/Release, re-résolution complète des périphériques (l'id a pu changer), re-init (`InitTap`), file vidée — bornée à 5 tentatives (backoff 0,5→2,5 s), échec net code 2 → `tapDead` côté renderer. Init de démarrage : 5 retries (driver en cours de chargement). `timeBeginPeriod(1)` pour le Sleep(4).

**Récupération micro (AudioEndpoint.cs)** : `list`/`get`/`set`/`restore`/`guard`. `chooseRestoreIds` (JS) ≡ `RestoreFromFile` (C#) : défaut Windows non virtuel > ids d'origine > 1er non virtuel. `parseEndpoints` conserve `name=''` quand `DeviceName` échoue (jamais de repli sur l'id — sinon le garde « nom non vide » de `chooseRestoreIds` était inopérant). Owner revérifié sur la même lecture que les ids (anti-TOCTOU guard/nouvelle instance). `SetDefaultEndpoint` journalise chaque rôle sur stderr.

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
- Clic = lecture **immédiate** vers la sortie « Discord » configurée (ex. `CABLE Input`) **et** vers l'écoute locale (casque) — un `AudioContext` par sortie, **partagé** quand câble et écoute pointent sur le même périphérique (réduit la surface du crash `-1/143`).
- **Limiteur** anti-saturation sur chaque sortie, volume maître global (0-100 %).
- Volume par son (0-300 %), badge si ≠ 100 %.
- **Normalisation** : par son (gain calculé sur la **loudness intégrée** EBU R128/BS.1770 — mesure **100 % JS** `SFUtils.loudnessFromPcm`, coefficients exacts validés contre ffmpeg ebur128 à ~0,05 LU ; aucune dépendance externe, l'app reste portable — cible `settings.normLufs` en LUFS, défaut -18, bornée -40–0) et « toute la bibliothèque » — non destructive, badge ⚖. **Plafond de pic** : `normGain` borne le gain pour ne pas dépasser -1 dBFS sur le pic échantillon (approximation par le bas du True Peak interpolé, ~1 dB de marge), plafond ×4 conservé. Fichiers < 400 ms : une seule zone d'énergie (comportement voulu pour les impacts). Bouton « Tester » : bruit rose de 1,2 s calé sur la cible LUFS, écoute locale uniquement. **Migration v1→v2** : les `s.norm` issues de l'ancienne normalisation par pic sont invalidées (×1) au chargement — volumes manuels, découpes, favoris, catégories et raccourcis préservés.
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
- **Timeline vide** (début+fin) → **audio complet** du média ; timeline renseignée → extraction de l'extrait. Règles : « fin sans début » et « début non nul sans fin » refusées avec message explicite ; « début=0 sans fin » = audio complet.
- **Si ffmpeg présent** : vrai MP3 de l'extrait (`--download-sections`) ; sinon — ou si la coupe sectionnée échoue — repli audio complet + trim non destructif. Bouton **Annuler** (`yt:cancel`) tue yt-dlp/ffmpeg et ferme la modale ; l'annulation n'est jamais relancée par le repli. `yt:cancel` couvre aussi `yt:info` (dump JSON long) et les phases ensure/update hors `yt:download` ; fermer la modale YouTube pendant un téléchargement déclenche la même annulation.
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
- **Jauge de niveau** en direct pendant la prise + **aperçu « Écouter » avant sauvegarde** (joue le buffer en mémoire sur l'écoute locale, suivi par le STOP global).
- **Rogner avant sauvegarde** : champs Début/Fin → décodage + ré-encodage **WAV 16 bits** sans perte ; vide = fichier complet dans son format d'origine.
- Durée affichée, préécoute de l'enregistrement, nom + catégorie, ajout direct à la bibliothèque (puis ouverture de l'éditeur pour découper).
- Fichiers enregistrés en webm/opus (ou m4a/ogg selon support) dans `<stockage>/recordings/`, noms uniques.

### 10. Bascule automatique du micro Windows
- Basculé au lancement **et** rejoué sur `devicechange` (si entrée requise disparue), à l'application des réglages et à l'import de config — jamais d'écrasement d'un choix manuel (placeholder « (choisir…) » si aucun micro configuré).
- Le périphérique d'origine (ex. G930) est mémorisé dans `audio-restore.json`.
- **Restauration** : automatiquement, uniquement si `audio-restore.json` existe (preuve d'une vraie bascule SoundFart) — à la fermeture propre, après crash/kill du process (`AudioEndpoint.exe guard <pid>` détaché, vérifie `owner` dans `audio-restore.json` + `StartTime` du process contre la réutilisation de PID), sur `uncaughtException`, et via le watchdog 30 s (suspendu si l'entrée change hors SoundFart — choix manuel respecté). **Exception** : l'action explicite utilisateur (`audio:restore` force=true — bouton « Restaurer mon micro Windows » ou proposition « coincé sur câble ») autorise une rebasculation bornée virtuel→non-virtuel même sans marqueur ; sans marqueur et sans `force`, SoundFart ne touche **jamais** au micro. `unhandledRejection` ne restaure pas (log seulement).
- **Watchdog** (réglage `watchdogMic`, défaut ON) : `execFile` async toutes les 30 s, anti-chevauchement ; si l'entrée est modifiée hors SoundFart, la surveillance est **suspendue pour la session** (impossible de distinguer l'utilisateur d'une app tierce comme Discord).
- Discord doit utiliser « Défaut » comme entrée pour suivre la bascule (documenté).

### 11. Stockage configurable
- **Deux dossiers distincts** : les **réglages/outils/logs** vivent dans `%APPDATA%\SoundFart` (userData Electron standard — migration unique depuis l'ancien `SoundFart-data` portable, implémentée dans `lib/migration.js` : **reprenable** — le marqueur `.migrated-from-portable` n'est écrit que si toutes les copies réussissent ; copie par fichier `.migtmp-<pid>`+rename sans jamais écraser l'existant ; dossiers fixes `tools/imports/recordings/cuts/default-sounds` + tout `storageDir` situé dans `SoundFart-data` ; chemins de config réécrits (formes `\\`, `\`, `/`), backups `.pre-migration-*`) ; les **fichiers créés par l'app** vivent dans le **dossier de sons choisi** (`settings.storageDir`).
- **Dossier de sons obligatoire** : bandeau de choix au premier lancement (skippable) + `ensureStorageDir()` bloquant à la première action créatrice de fichier (import, YouTube, enregistrement, extrait MP3). Sous-dossiers : `sons/` (sons ajoutés **copiés** via `files:import` — `lib/import.js` : dédoublonnage taille+échantillons 4 Kio tête/queue **confirmé par SHA-256** (`lib/file-sign.js`) pour qu'un faux positif n'écrase jamais un fichier ; imports **sérialisés par dossier** (`enqueueImport`, clé = chemin résolu minuscules) pour que deux imports concurrents de même nom ne s'écrasent pas au `rename` ; **borne 512 Mo** à l'import (limite de `file:read` — un fichier plus gros ne serait jamais lisible) ; copie `.part` à nom unique pid+séquence puis rename atomique), `imports/` (YouTube), `recordings/` (micro), `cuts/` (extraits MP3).
- YouTube propose le dossier de sons par défaut (modifiable par téléchargement) ; l'enregistreur demande le dossier après l'arrêt (premier choix = deviant `storageDir`).
- **5 sons par défaut** copiés dans `<userData>/default-sounds/` ; **re-seed** automatique si la bibliothèque redevient vide ou si des fichiers par défaut manquent/sont tronqués.
- **Migration** : les chemins de l'ancienne app Python `DiscordSoundboard` sont migrés automatiquement au premier lancement (`config.json` → `.bak` conservé).
- **Imports orphelins** : les fichiers présents dans `imports/` sans entrée en bibliothèque sont listés via `imports:list` — Paramètres → Bibliothèque → « fichiers non ajoutés » permet de les ajouter (nom, taille, date) sans toucher aux fichiers.
- **Mode** : exe portable unique, mais les **données sont standard Windows** — réglages/outils/logs dans `%APPDATA%\SoundFart`, sons créés dans le dossier choisi par l'utilisateur. `--test-profile` isole dans `%TEMP%\SoundFart-test`.
- **VB-CABLE** : jamais embarqué ni installé (licence VB-Audio). L'utilisateur l'installe depuis https://vb-audio.com/Cable/ ; sans câble, écran d'accueil « VB-CABLE requis » + bandeau permanent, flux câble et bascule micro auto désactivés — un autre périphérique de sortie virtuelle (ex. Voicemeeter) reste sélectionnable manuellement ; détection à chaud par `devicechange`.

### 12. Sauvegarde / export-import
- Export JSON de **toute** la config : catégories + ordre, sons (noms, chemins, volumes, favoris, raccourcis, trim/fondus, normalisation), réglages.
- Import avec confirmation (remplace la config ; fichiers audio non modifiés).
- Les sons originaux ne sont **jamais** copiés.

### 13. Menu application (F11)
- Menu natif Windows togglé par **F11** (le comportement Alt+F4 relève du menu Windows, pas de l'app).
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
- **Import YouTube** : nécessite réseau + yt-dlp (auto-mis à jour ~hebdo, versions vérifiées SHA-256, `--ignore-config` pour ne pas hériter des réglages yt-dlp de l'utilisateur) ; ffmpeg téléchargé au 1er usage (~100 Mo).
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
