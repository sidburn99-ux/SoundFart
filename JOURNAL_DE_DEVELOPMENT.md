# Journal de développement — SoundFart

> Rôle : journal de bord détaillé du développement (décisions, tests, incidents). Statut : **historique** — ne pas lire par défaut ; `JOURNAL.md` pour la synthèse par version.

Journal de bord du développement. Règle : ne jamais marquer une fonctionnalité comme « testée » si elle ne l'a pas réellement été.

## État actuel : v1.4

### v1.4 — portable only, VB-CABLE manuel, robustesse audio, tests

#### Fait dans cette version
- [x] **Portable uniquement** : cible NSIS supprimée, plus d'installeur ni de désinstalleur. Un seul `SoundFart.exe` (electron-builder `portable`, compression `store` : ~375 Mo, démarrage ~2 s contre ~6,6 s en normal/110 Mo).
- [x] **Mode portable complet** : `userData` = `SoundFart-data/` à côté de l'exe (`PORTABLE_EXECUTABLE_DIR`), repli `%APPDATA%` ; `--test-profile` isole les tests.
- [x] **VB-CABLE jamais embarqué ni installé** (licence VB-Audio : redistribution interdite sans accord — le readme l'interdit explicitement). Écran d'accueil « VB-CABLE requis » + bandeau permanent sans câble ; bouton de téléchargement (IPC `cable:openPage`, URL fixe côté main) ; « J'ai installé, vérifier » ; fermeture auto via `devicechange` ; câblage à chaud (diffusion + bascule micro démarrent sans relancer). `ensureCableDriver`/PnP/snooze/RunOnce supprimés.
- [x] **Instance unique stricte** : la 2e instance `app.exit(0)` sans `will-quit` ni restauration micro (testé : `audio-restore.json` intact).
- [x] **AudioTap durci + PCM** : check parent par temps (500 ms, `TickCount` + start-time anti-PIID-reuse), erreurs fatales → exit≠0 + stderr, refus source=câble (anti-boucle), downmix >2 canaux (central 0,707), mode `pcm` float32 stéréo 48 kHz sur stdout → IPC → **AudioWorklet** pour l'enregistreur « Audio du PC » **sans passer par le câble** (anti-écho Discord par construction). Mesuré : flux réel peak=179205.
- [x] **Restauration micro blindée** : mode `guard <pid>` détaché (restauration à la mort du parent même après kill/crash), `uncaughtException`/`unhandledRejection` → log + restauration, watchdog async (`execFile`, anti-chevauchement, suspension session si micro modifié hors SoundFart), bouton manuel « Restaurer mon micro Windows » + filet de secours.
- [x] **Robustesse** : téléchargements HTTPS-only + SHA-256 + versions épinglées (yt-dlp 2026.10.26, ffmpeg 9.0.2), outils C# hashés (`AudioEndpoint-<hash8>.exe`), cache audio borné en octets (256 Mo LRU), validation IPC `senderFrame` + types/bornes, config `.bak`/`.broken-<ts>`, CSP durcie.
- [x] **Qualité** : `lib/audio-utils.js` (UMD, fonctions pures partagées main/renderer) + **14 tests `node:test`** (`npm test`) ; logs à niveaux info/warn/error + id de session ; `npm audit` = 6 moderates dans `minimatch` via electron-builder (build-only, non embarqué).

#### Vérifications effectuées (v1.4)
- `node --check` sur tous les JS ; `npm test` 14/14 ; build portable OK.
- Lancement réel sans VB-CABLE : écran « VB-CABLE requis » affiché (log ui), bandeau, aucune bascule micro (pas de `audio-restore.json` créé), arrêt propre.
- AudioTap PCM : flux mesuré non nul (peak=179205 pendant lecture) ; mort du parent ≤2 s ; guard : restauration + suppression du fichier d'état.
- Instance unique : 2e lancement → un seul arbre de processus, état de restauration intact.
- NON testé : tout le flux avec VB-CABLE installé (écran→téléchargement→vérifier→diffusion→bascule→restauration), appel Discord réel (écho), `npm audit` corrigé, UI cliquée.

### v1.3 — coupe physique, dossier de stockage, vignettes, bascule micro auto

#### Fait dans cette version
- [x] **Coupe physique des extraits** : `ffmpeg.exe` est téléchargé automatiquement au premier besoin (~80 Mo, build essentials de gyan.dev, extraction via `tar.exe`) dans `%APPDATA%\SoundFart\tools\ffmpeg\`.
  - YouTube : `yt-dlp --download-sections` + `--ffmpeg-location` → **vrai MP3 de l'extrait** (plus besoin de trim). Repli sur audio complet + trim si ffmpeg indisponible.
  - Éditeur : bouton « MP3 de l'extrait » → `ffmpeg -ss/-to` vers `%STOCKAGE%\cuts\` ; option de remplacer le fichier du son par le MP3 (découpe/fondus réinitialisés, onde rechargée).
- [x] **Dossier de stockage configurable** : réglages → « Dossier de stockage » (imports YouTube, enregistrements, extraits MP3). Sous-dossiers `imports/`, `recordings/`, `cuts/`. Défaut = `%APPDATA%\SoundFart`.
- [x] **Vignettes des cartes** : emoji + dégradé déterministe (hash nom + catégorie), teinte `hsl` variable CSS. Corrigé : `setAttribute('style')` bloqué par la CSP → passage par `style.setProperty` dans `el()`.
- [x] **Bascule micro automatique** : nouvel outil `AudioEndpoint.exe` (C#, compilé au 1er usage via `csc.exe` du .NET Framework dans `tools/`) — `list`/`get`/`set` sur les endpoints Windows (Core Audio `IMMDeviceEnumerator` + `IPolicyConfig.SetDefaultEndpoint`, rôles console + communications).
  - Au lancement : si activé (réglages, défaut ON), l'entrée micro Windows passe sur « CABLE Output » ; le périphérique précédent est mémorisé dans `audio-restore.json`.
  - À la fermeture propre (`beforeunload` + `will-quit`) **ou au prochain lancement après crash** : restauration du micro d'origine.
  - **Testé de bout en bout sur cette machine** : lancement → bascule G930→CABLE Output ; fermeture → retour G930 ; fichier d'état supprimé. Discord doit être sur « Défaut » pour suivre (documenté dans GUIDE.md).
- [x] `AudioEndpoint.cs` ajouté au projet + `package.json files`.

#### Vérifications effectuées (v1.3)
- `AudioEndpoint.exe` compilé et testé : `list` (endpoints réels listés), `get`, `set` (bascule + restauration OK).
- **Bascule micro auto testée de bout en bout** : lancement → G930→CABLE Output ; fermeture propre → retour G930 ; `audio-restore.json` supprimé.
- **Pipeline ffmpeg validé en conditions réelles** : téléchargement gyan.dev (114,8 Mo), extraction `tar -xf ... '*ffmpeg.exe'`, binaire `--enable-static` autonome (aucune DLL requise), coupe `-ss 1 -to 3` sur WAV 5 s → MP3 de 2,00 s exact.
- Bug corrigé : `AudioEndpoint.cs` dans `app.asar` illisible par `csc.exe` externe → source extraite vers `tools/` avant compilation (critique pour l'exe packagé).
- CSP : `setAttribute('style')` bloqué → `el()` utilise désormais `style.setProperty` (CSSOM autorisé). Aucune violation au prochain lancement.
- Syntaxe `node --check` sur les 3 JS : OK. Exe v1.3 rebuildé.
- Non testé : import YouTube réel (nécessite yt-dlp + réseau), rendu visuel des vignettes à l'écran, diffusion audio réelle vers Discord.

### v1.3.1 — enregistreur multi-sources (correctif remonté utilisateur)

- **Problème** : l'enregistreur ne capturait qu'**une** entrée audio. Les voix Discord arrivent sur la *sortie* (casque), pas sur une entrée → enregistrement = voix du user (très forte, micro en brut) sans les autres participants.
- **Correctif** : l'enregistreur mixe désormais jusqu'à 3 sources cochables :
  - **Micro** (sélecteur de périphérique, exclut `default` — voir ci-dessous),
  - **Audio du PC** : capture système via `getDisplayMedia` + `audio:'loopback'` (handler `setDisplayMediaRequestHandler` + `desktopCapturer` dans main.js) → voix Discord, musique, jeu,
  - **Câble SoundFart** : captation de « CABLE Output » → sons de la soundboard + micro mixé.
  - Les sources sont mixées via `AudioContext` → `DynamicsCompressor` (anti-écrêtage) → `MediaRecorder`.
- **Correctif lié (micMix)** : avec `autoSwitchMic`, le périphérique `default` devient CABLE Output → le mixage micro capturait la soundboard elle-même (boucle). Désormais un périphérique concret non virtuel est choisi quand `micId` vaut `default`/vide.
- L'option `default` est exclue de la liste des sources de l'enregistreur pour la même raison.
- Non testé : capture loopback réelle en session (à valider avec un appel Discord).

### v1.3.2 — correctifs audio PC + version + echo cancellation vocale

- **« Permission denied » sur « Audio du PC »** : le permission check ne laissait passer que `media` → ajout de `display-capture` ; handler `setDisplayMediaRequestHandler` robuste (log dans `soundfart.log`, `getSources` sans thumbnailSize, contrainte `audio: true` côté renderer).
- **Version invisible** : le span `#appVersion` avait un texte vide en attendant l'IPC → fallback en dur `v1.3.0` dans le HTML (toujours écrasé par `app:getVersion()`).
- **Echo cancellation vocale** : `echoCancellation`/`noiseSuppression`/`autoGainControl` activés sur les pistes **micro uniquement** (mixage micro + enregistreur). Les sons joués via Web Audio API ne transitent pas par `getUserMedia` → non traités, qualité inchangée.
- Exe rebuildé.

### v1.3.3 — regroupement par catégorie + menu F11

- **Regroupement par catégorie** : case « Par catégorie » dans la topbar (persistée, `settings.groupByCat`, défaut ON). Vues « Tous les sons » et « Favoris » affichent des en-têtes de groupe (couleur + nom + nombre) dans l'ordre des catégories ; « Sans catégorie » en dernier. `#grid` passe en `grid-auto-rows: auto` + `.card { height: 152px }`.
- **Menu application F11** : menu natif Windows (`Menu.buildFromTemplate`, `autoHideMenuBar` + `setMenuBarVisibility` togglé par F11 ; Alt fonctionne aussi).
  - Fichier : Ajouter (Ctrl+O), YouTube, Enregistreur, Exporter/Importer config, Quitter.
  - Édition : Rechercher (Ctrl+F).
  - Audio : Stopper tous les sons (accélérateur = raccourci STOP configuré), Réglages audio.
  - Affichage : sous-menu Vue (radio, toutes les catégories synchronisées) + case « Regrouper par catégorie ».
  - Aide : Outils de développement (F12), À propos (version via IPC).
  - État synchronisé renderer→main via `menu:state` à chaque `renderAll()` ; actions main→renderer via `sf:menu`.
  - Export/import de config extraits en fonctions réutilisables (`exportConfig`/`importConfig`).
- Non testé : affichage réel du menu F11 et des actions (à valider à l'écran).

### v1.3.4 — « Audio du PC » via AudioTap.exe (contournement capture système)

- **Problème** : `getDisplayMedia` + loopback Chromium → `NotReadableError: Could not start audio source` ; `chromeMediaSource` → silence. Bug connu Electron/Windows (capture bureau audio cassée, possiblement aggravé par les drivers Logitech — voir electron#42765).
- **Solution** : nouvel outil **`AudioTap.cs`** (~400 lignes d'interop COM) compilé au 1er usage comme AudioEndpoint :
  - Capture le **loopback WASAPI** du périphérique de sortie par défaut (`IAudioClient` + `AUDCLNT_STREAMFLAGS_LOOPBACK`, format mix explicite obligatoire — `pFormat=NULL` et `AUTOCONVERTPCM` → `E_NOTIMPL`).
  - Réinjecte l'audio dans **`CABLE Input`** en temps réel (client rendu partagé, buffer 200 ms, file d'attente 500 ms).
  - **Conversion automatique** si formats différents (ex. G930 = 8ch float → câble 2ch float : downmix + rééchantillonnage linéaire).
- L'enregistreur utilise alors la source **« CÂBLE Output »** (getUserMedia fiable) : l'audio système arrive par le câble. Tu continues d'entendre normalement (le tap copie, ne redirige pas).
- Repli : si AudioTap échoue → ancienne chaîne `systemStream` (getDisplayMedia) conservée.
- IPC : `audio:tapStart`/`audio:tapStop` ; tué à la fermeture et au will-quit.
- **Testé de bout en bout en ligne de commande** : tone.wav joué sur le casque → CABLE Output capté via ffmpeg dshow → mean -40 dB / max -32 dB (audio réel présent). Stats internes : ~200 paquets/s, écriture realtime, padding ~0.
- Non testé : capture via l'UI de l'app elle-même (à valider), comportement avec sources multiples simultanées.

### v1.3.5 — VB-CABLE bundlé + installation silencieuse

- **Objectif** : un seul exe, aucune install manuelle de pilote tiers.
- Réalité Windows : un périphérique audio virtuel exige un **driver noyau** — pas de version « portable » possible. Le plus proche : l'installateur officiel `VBCABLE_Setup_x64.exe` (VB-Audio, freeware, ~923 Ko) est **embarqué dans l'exe** (`vendor/`).
- `ensureCableDriver()` (main.js) : au démarrage et en fallback de `audio:autoSetup`, scanne les endpoints ; si aucun virtuel → extrait le setup vers `%APPDATA%\SoundFart\tools\` → `Start-Process -Verb RunAs -Wait` avec `/S` (UAC auto, aucune fenêtre d'install) → re-scan jusqu'à 30 s → événement `sf:cableReady` → le renderer recharge les périphériques et relance la bascule micro.
- Si l'utilisateur refuse l'UAC ou si l'install échoue : log `[cable]` dans soundfart.log, l'app continue (préécoute/édition/recording OK, diffusion Discord impossible sans câble).
- Non testé : l'installation réelle sur une machine sans VB-CABLE (UAC + apparition du périphérique à valider).

### v1.3.6 — sons par défaut + restauration micro généralisée

- **5 sons bundled** (`assets/sounds/`, ~50 Ko) : Pet Sec, Discord Notification, Ultra Kill, Homer Ta gueule, Quelle Indignité — extraits de la bibliothèque de l'utilisateur. Au premier lancement (bibliothèque vide), `sounds:seed` les copie dans `%APPDATA%\SoundFart\default-sounds\` et les enregistre. N'affecte pas les installs existantes.
- **Restauration micro généralisée** : `AudioEndpoint.exe get` expose maintenant le rôle `multi` (Multimedia). `restoreMicNow` choisit par priorité : (1) périphérique par défaut Windows du rôle multimedia s'il n'est pas virtuel, (2) périphérique d'origine sauvegardé, (3) premier capture non virtuel. Plus de dépendance à un modèle de micro précis — suit le défaut Windows de n'importe quel utilisateur.

### v1.2 — favorites, raccourcis, enregistreur, YouTube, normalisation, sauvegarde

#### Fait dans cette version
- [x] **Favoris** : étoile ★/☆ sur chaque carte (visible au survol, ★ fixe si favori), case « Favori » dans l'éditeur, entrée « ★ Favoris » dans la barre latérale, persistée dans `config.json`. Le glisser-déposer vers « Favoris » est désactivé (ce n'est pas une catégorie).
- [x] **Tête de lecture sur la forme d'onde** : pendant la préécoute dans l'éditeur, une barre blanche avance en temps réel ; clic sur l'onde = chercher dans l'extrait (limité au début/fin). Affichage `écoulé / total`.
- [x] **Retrouver un fichier manquant** : le badge « Fichier introuvable » est cliquable + entrée dans le menu contextuel → sélecteur de fichier, le chemin est mis à jour.
- [x] **Raccourcis clavier globaux** : `globalShortcut` dans `main.js`. Par son via l'éditeur (« cliquer pour définir », Échap = annuler), raccourci STOP global dans les réglages (défaut `CommandOrControl+Alt+S`). Détection des conflits (sons entre eux + STOP), badge ⌨ sur les cartes, résiliation auto à la fermeture. Exige un modifieur ou une touche F.
- [x] **Normalisation** : gain par son `norm` (×1 à ×4, pic cible ~89 %, limiteur en aval). Bouton « Normaliser ce son » dans l'éditeur + « Normaliser toute la bibliothèque » dans les réglages (progression affichée). Badge ⚖ sur les cartes.
- [x] **Enregistreur** : source micro/périphérique au choix, enregistrement webm/opus (ou m4a), préécoute casque, nom + catégorie, ajout direct à la bibliothèque puis ouverture de l'éditeur pour découper. Fichiers dans `%APPDATA%\SoundFart\recordings\`, jamais d'écrasement.
- [x] **Export/Import de configuration** : export JSON (références uniquement) depuis les réglages ; import avec confirmation, ré-applique audio + raccourcis.
- [x] **Import YouTube** : collage de lien → analyse (titre/durée via `yt-dlp`) → début/fin en secondes ou hh:mm:ss → téléchargement avec barre de progression → préécoute → nom/catégorie → ajout. `yt-dlp.exe` est téléchargé automatiquement au premier usage dans `%APPDATA%\SoundFart\tools\`. Si `ffmpeg` est présent : extrait MP3 exact (`--download-sections`) ; sinon audio complet + découpe non destructive (même mécanisme que l'éditeur). Imports dans `%APPDATA%\SoundFart\imports\`.
- [x] **Formats étendus** : `.webm`, `.mp4`, `.mkv`, `.mov`, `.m4v` ajoutés (enregistrements, vidéos locales, YouTube).
- [x] **Journal** : ce fichier + `JOURNAL.md` conservé pour l'historique.

#### Vérifications effectuées
- `node --check` sur `main.js`, `preload.js`, `src/app.js` : OK.
- Lancement `npm start` sous Electron 45 : l'application démarre, `init()` s'exécute, `config.json` est réécrit, **aucune erreur** dans `soundfart.log`. (Les erreurs « disk cache / Accès refusé » de Chromium sont sans rapport et non bloquantes.)
- Non testé : lecture audio réelle, raccourcis globaux en conditions réelles, MediaRecorder, yt-dlp (téléchargement réel), reconstruction de l'exe.

#### Problèmes rencontrés / limites connues
- `ELECTRON_RUN_AS_NODE=1` est défini dans l'environnement de l'IDE : `npm start` plante sous Node tant que la variable n'est pas effacée. Contournement : `$env:ELECTRON_RUN_AS_NODE=''` avant `npm start`. À documenter pour les scripts .bat (ajouter `set ELECTRON_RUN_AS_NODE=` dans run-dev.bat).
- YouTube sans ffmpeg → fichier complet + trim (non destructif). Pour un vrai MP3 il faut installer ffmpeg ou laisser l'app le proposer plus tard.
- Le premier usage YouTube télécharge yt-dlp (~15 Mo) — nécessite internet.

### Historique v1.0 → v1.1 (voir JOURNAL.md pour le détail)
- v1.0 : réécriture Electron complète (thème sombre, catégories, volume par son, trim, migration config Python).
- v1.0.1 : correctif écran noir (structure `src/`), journal d'erreurs, F12, Electron 45 + electron-builder 26.
- v1.1 : tri des catégories, éditeur de découpe avec onde et fondus.

## À faire / idées restantes
- [ ] Tester sous Windows : diffusion CABLE Input, micro, latence, tous les nouveaux modules en conditions réelles (voir TESTS_VM.md).
- [ ] Son aléatoire / plusieurs sons sur un même raccourci, boucle, mode « maintenir pour jouer ».
- [ ] Lancement auto Windows, réduction dans la barre des tâches.
- [x] Icône de l'application — fait (`assets/icon.ico`, v1.4).
- [x] Tests unitaires — `test/audio-utils.test.js` (node:test, fonctions pures partagées).
- [x] Téléchargement ffmpeg automatique — fait (`tools\ffmpeg\ffmpeg.exe`, ~115 Mo, SHA-256 vérifié).
