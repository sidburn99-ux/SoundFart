# SoundFart 💨

> Rôle : présentation du projet (ce que c'est, fonctionnalités, installation rapide). Statut : **actuel**. À consulter : en premier, pour une vue d'ensemble ; détails dans `GUIDE.md` et `SPECIFICATION.md`.

Soundboard pour Discord : joue des sons dans tes appels, enregistre ta voix et le son du PC, importe depuis YouTube. **Application portable** — un seul exécutable, aucune installation.

- **Windows** : `SoundFart.exe` (actuellement la distribution la plus aboutie)
- **Linux x86_64** : `SoundFart-<version>-x86_64.AppImage` (voir « Linux » ci-dessous)

## Fonctionnalités

- **Bibliothèque de sons** : catégories, favoris, miniatures, recherche, tri, volume par son
- **Édition non destructive** : découpe début/fin, fondus d'entrée/sortie, normalisation — l'original n'est jamais modifié
- **Raccourcis clavier** par son + raccourci global **STOP** (interrompt tout, même fenêtre minimisée)
- **Enregistreur intégré** : micro, audio du PC et sortie SoundFart→Discord
- **Import YouTube** : extrait MP3 par timeline ou fichier audio complet, avec progression
- **Routage Discord (Windows)** : sortie vers `CABLE Input`, micro Windows basculé automatiquement sur `CABLE Output` à la lancement et restauré à la fermeture (même après crash)
- **Paramètres** : sortie Discord, écoute locale casque, mixage micro, surveillance automatique du micro
- **Sauvegarde** : export/import de la configuration (références, catégories, découpes, raccourcis)
- **Multilingue** : français, anglais, allemand, espagnol
- **Rapports d'erreurs opt-in** : diagnostics anonymisés envoyés uniquement avec ton consentement explicite

## Prérequis

- **Windows 10/11 64 bits** ou **Linux x86_64** (AppImage, FUSE ou `--appimage-extract-and-run`)
- **[VB-CABLE](https://vb-audio.com/Cable/)** (gratuit, **Windows uniquement**) — requis pour envoyer les sons dans Discord. **À installer toi-même** depuis la page officielle (SoundFart ne l'embarque pas, licence VB-Audio). L'app affiche un écran d'invitation s'il est absent.
- Discord : en voix, choisis **« Défaut »** comme périphérique d'entrée pour suivre la bascule automatique du micro.

## Linux (AppImage)

```
npm install
npm run dist:linux   # -> dist\SoundFart-<version>-x86_64.AppImage (sous Linux)
```

- Le build AppImage **doit tourner sous Linux** (electron-builder exige des outils Linux : `mksquashfs`, etc.). Sur une machine Windows sans WSL, le build peut être produit par le workflow GitHub Actions `build-linux` (artifact `soundfart-appimage`).
- Au premier usage d'une fonction qui en a besoin, l'app télécharge ses outils **vérifiés SHA-256** : `yt-dlp_linux` (release yt-dlp officielle) et un build statique `ffmpeg` linux64 (BtbN FFmpeg-Builds, tag épinglé) — jamais de binaire Windows.
- **Câble virtuel Linux** : `main/linux-cable.js` crée un *null-sink* PulseAudio/PipeWire (`soundfart_cable`, description `SoundFart-Cable`) via `pactl` — équivalent fonctionnel de VB-CABLE. Le bouton « Créer/vérifier le câble » des réglages le crée à la demande ; l'état pactl/serveur/câble s'affiche en direct.
- **Routage Discord** : les sons (et le micro mixé) partent vers le sink `soundfart_cable` ; dans Discord, choisis « SoundFart Cable » (monitor) comme **sortie** et « Défaut » comme **entrée**. La **bascule micro automatique** est implémentée : la source par défaut PulseAudio passe sur `soundfart_cable.monitor` au lancement (`pactl set-default-source`), avec marqueur `linux-mic-restore.json`, guard shell détaché pour restauration après crash, watchdog 30 s et bouton « Restaurer ma source micro » — même sémantique que Windows.
- **Capture « audio du PC »** : sous Linux, l'enregistreur utilise `parec` sur `soundfart_cable.monitor` (PCM float32 stéréo 48 kHz → IPC → AudioWorklet), car Chromium n'expose pas les sources `.monitor` à `getUserMedia`.
- **Indisponible sous Linux** (spécifique Windows, désactivé proprement sans bloquer le démarrage) : VB-CABLE et son écran d'invitation, les outils C#/WASAPI (AudioEndpoint/AudioTap). **Raccourcis globaux** : fonctionnels sous X11, **limités sous Wayland** (contrainte du protocole, pas de contournement propre).
- **Prérequis audio** : `pactl` (pacman `pulseaudio`/`pipewire-pulse`, Debian `pulseaudio-utils`/`pipewire-pulse`) — cible : PipeWire + pipewire-pulse ou PulseAudio ≥ 15 ; ALSA-only hors périmètre.
- **Disponible sous Linux** : interface multilingue, bibliothèque, lecture/édition des sons, favoris, enregistreur (micro + audio PC + câble), import YouTube, coupe MP3, rapports d'erreurs opt-in.

## Utilisation

1. Lance `SoundFart.exe` (Windows) ou `./SoundFart-*.AppImage` (Linux) — au premier démarrage, choisis ton **dossier de sons** (les fichiers ajoutés y sont copiés ; les réglages restent dans le dossier utilisateur de la plateforme)
2. Sous Windows, si VB-CABLE est absent, l'écran d'accueil t'invite à le télécharger ; installe-le, redémarre Windows si besoin, puis « J'ai installé, vérifier »
3. Paramètres → Sortie audio : choisis **« CABLE Input »** (surligné ★) comme sortie Discord et ton casque comme écoute locale *(Windows)* ; sous Linux, clique d'abord **« Créer/vérifier le câble »** puis choisis **« SoundFart Cable »** comme sortie Discord *(Linux)*
4. Clique un son (ou son raccourci) pour le jouer

> ⚠️ L'exe/AppImage n'est **pas signé** → Windows SmartScreen / les dépendances FUSE peuvent afficher un avertissement au 1er lancement.

## Développement

```
npm install
npm start          # lance en dev
npm test           # tests unitaires (node:test)
npm run dist       # build Windows portable -> dist\SoundFart.exe
npm run dist:linux # build Linux AppImage -> dist\SoundFart-<version>-x86_64.AppImage (sous Linux)
```

- Stack : Electron 45, JS vanilla, C# compilé à la volée (`csc.exe`), yt-dlp + ffmpeg téléchargés et vérifiés (SHA-256)
- `AGENTS.md` : règles de dev · `GUIDE.md` : guide utilisateur · `SPECIFICATION.md` : spec technique · `JOURNAL.md` : historique · `suivi.tsv` : journal technique · `reliability/FINDINGS.md` : registre des anomalies · `VALIDATION.md` / `TESTS_VM.md` : plans de test

## Licence

Voir `THIRD-PARTY-NOTICES`. VB-CABLE est © VB-Audio et n'est pas redistribué.
