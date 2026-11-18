# SoundFart — Guide d'installation et de configuration

> Rôle : guide utilisateur (installation, VB-CABLE, Discord, réglages, dépannage). Statut : **actuel**. À consulter : pour utiliser ou configurer l'application.

SoundFart est une soundboard pour Discord : elle joue tes sons dans un **micro virtuel** que Discord utilise comme entrée micro, pendant que tu les entends dans ton casque.

## 1. Installer SoundFart

### Version .exe (recommandé)
1. Télécharge `SoundFart.exe` et lance-le (fichier portable, **aucun install**, aucune désinstallation).
2. **Dossier de sons** : au premier lancement, SoundFart te propose de choisir un dossier (bandeau en haut) — c'est là qu'il rangera tout ce que tu ajoutes : sons **copiés** dans `sons/`, imports YouTube dans `imports/`, enregistrements dans `recordings/`, extraits MP3 dans `cuts/`. Le choix est **obligatoire** dès le premier ajout. Les **réglages** sont dans `%APPDATA%\SoundFart` (comme les autres applis Windows).
3. Au premier lancement sans VB-CABLE, un écran « VB-CABLE requis » s'affiche (voir section 2).

### Depuis les sources
1. Installe **Node.js** (version LTS) : https://nodejs.org
2. Double-clique sur `run-dev.bat` pour tester, ou `build.bat` pour reconstruire `dist\SoundFart.exe`.

Ta configuration est sauvegardée dans `%APPDATA%\SoundFart\config.json`. Les sons que tu ajoutes sont **copiés** dans ton dossier de sons (`sons/`) ; les autres fichiers audio ne sont jamais modifiés : SoundFart ne garde que leurs chemins d'accès.

### Linux (AppImage)

1. Récupère `SoundFart-<version>-x86_64.AppImage` (build GitHub Actions `build-linux`, ou `npm run dist:linux` sous Linux) et rends-le exécutable : `chmod +x SoundFart-*.AppImage`, puis lance-le. Si ton système n'a pas FUSE : `./SoundFart-*.AppImage --appimage-extract-and-run`.
2. **Prérequis audio** : `pactl` doit être disponible — installe `pulseaudio-utils` (Debian/Ubuntu) ou `pipewire-pulse` + `pulseaudio` (Fedora/Arch). Cible : **PipeWire avec compatibilité PulseAudio** (ou PulseAudio ≥ 15). Sans serveur PulseAudio/PipeWire, la création du câble et la bascule micro échouent avec un message explicite.
3. Au premier lancement, choisis ton **dossier de sons** comme sous Windows ; les réglages vivent dans le dossier utilisateur standard (`~/.config/SoundFart`).

## 2. Installer le câble virtuel

Pour que Discord entende les sons, il faut un périphérique audio virtuel qui fait le lien entre SoundFart et Discord. **SoundFart ne l'embarque ni ne l'installe** (licence VB-Audio) : tu l'installes toi-même, une seule fois.

1. Lance SoundFart : si VB-CABLE manque, un écran « VB-CABLE requis » s'affiche avec un **gros bouton de téléchargement** (ou va directement sur https://vb-audio.com/Cable/ — affiché en clair dans l'écran et les réglages).
2. Dézippe l'archive, **clic droit sur `VBCABLE_Setup_x64.exe` → « Exécuter en tant qu'administrateur »**, clique sur **Install**.
3. **Redémarre Windows** : les périphériques n'apparaissent qu'après le reboot.
4. De retour dans SoundFart, clique **« J'ai installé, vérifier »** (ou le bouton **Vérifier** des réglages) : l'écran se ferme tout seul dès que le câble est détecté, sans relancer l'app.
5. Dans Windows, tu verras apparaître **« CABLE Input »** (sortie) et **« CABLE Output »** (entrée).

> Sans VB-CABLE, SoundFart reste utilisable (sons, éditeur, préécoute, enregistreur) mais **la diffusion vers Discord et la bascule micro automatique sont désactivées** — un bandeau permanent le rappelle. Tu peux aussi utiliser un équivalent (Voicemeeter…) en choisissant sa sortie dans les réglages.

### Linux : le câble virtuel (null-sink PulseAudio)

Pas de pilote à installer : SoundFart crée lui-même un **périphérique virtuel PulseAudio/PipeWire** (`module-null-sink`, sink `soundfart_cable`, affiché « SoundFart-Cable »). VB-CABLE n'existe que sous Windows.

1. Dans SoundFart → ⚙ Paramètres → **Sortie audio**, clique **« Créer/vérifier le câble »** (⚠️ nécessite `pactl` et un serveur PulseAudio/PipeWire actif). L'état « pactl / serveur / câble » s'affiche sous le bouton.
2. Le sink est **conservé entre les lancements** — inutile de le recréer ; le bouton vérifie juste qu'il est là.
3. Dans Discord → Voix et vidéo : **Périphérique de sortie** = « SoundFart-Cable » (ou « SoundFart Cable »), **Périphérique d'entrée** = « Défaut » si tu utilises la bascule micro automatique (section 3).
4. **Bascule micro automatique (Linux)** : à l'ouverture, la **source par défaut** PulseAudio passe sur `soundfart_cable.monitor` — Discord capte alors tes sons **et** ta voix (mixés dans le sink). À la fermeture ou en cas de crash, la source d'origine est restaurée (marqueur + garde externe, comme sous Windows). Réglages : ⚙ → Micro & voix → « Bascule micro automatique », « Surveillance micro automatique », bouton « Restaurer ma source micro ».
5. **Limites** : les **raccourcis globaux** fonctionnent sous **X11** ; sous **Wayland** ils sont refusés par le système (contrainte du protocole — utilise les raccourcis dans la fenêtre ou X11/XWayland).

## 3. Configurer SoundFart

Ouvre **⚙ Paramètres** (barre latérale ou menu). Le panneau est organisé comme dans Discord : une **navigation latérale** à gauche (groupes Audio / Bibliothèque / Général) et des sections détaillées à droite — `Sortie audio` (sorties Discord et écoute locale), `Micro & voix` (micro, mixage, bascule automatique, traitement vocal), `Bibliothèque` (normalisation, durée max, imports non ajoutés), `Données & stockage` (dossier des fichiers) et `Général` (raccourci STOP, sauvegarde).

| Réglage | Quoi choisir |
|---|---|
| **Sortie vers Discord** | `CABLE Input` — c'est vers là que partent les sons. *(Linux : « SoundFart-Cable », créé via « Créer/vérifier le câble »)* |
| **Écoute locale** | Ton casque/enceintes — tu entends les sons sans que ta voix soit captée. |
| **Mon micro** | Ton vrai micro (casque, webcam…). |
| **Mixer mon micro** | ✅ si tu veux que tes potes entendent **ta voix + les sons** sur le même micro Discord. ❌ si tu préfères gérer ta voix autrement (ex. « Écouter ce périphérique » de Discord). ⚠️ Tant que « Bascule micro automatique » est activée, le mixage est **forcé** — décoche les deux pour une voix gérée ailleurs. |
| **Bascule micro automatique** | ✅ (recommandé) : à l'ouverture, l'entrée micro Windows passe sur **CABLE Output** ; à la fermeture, ton micro (ex. G930) est restauré automatiquement — uniquement si SoundFart a réellement basculé (ton choix manuel est toujours respecté). Un **garde externe** restaure même après un crash/kill du processus. Le bouton **« Restaurer mon micro Windows »** (section « Récupération micro ») force le retour en cas de blocage. *(Linux : la source par défaut passe sur `soundfart_cable.monitor`, restauration identique ; bouton « Restaurer ma source micro ».)* |
| **Surveillance micro automatique** | ✅ (recommandé) : vérifie périodiquement que l'entrée micro est toujours sur le câble ; si tu changes le micro toi-même (ou via une autre app), la surveillance se **met en pause pour la session** — impossible de distinguer un choix utilisateur d'un changement parasite. |
| **Dossier de stockage** | Où SoundFart range les fichiers qu'il crée (imports YouTube, enregistrements, extraits MP3). |
| **Niveaux audio** | **Cible loudness (LUFS)** : le volume perçu visé par la normalisation (-18 LUFS par défaut, réglable de -40 à 0). « Normaliser toute la bibliothèque » (ou « Normaliser ce son » dans l'éditeur) ramène la loudness de chaque son à cette cible **sans dépasser le plafond de pic** (-1 dBFS, avec ~1 dB de marge sous le pic interpolé réel) — les fichiers ne sont jamais modifiés. Plus haut = plus fort, plus bas = plus doux. Mesure 100 % interne en LUFS (aucun téléchargement, l'app reste portable). Le bouton **Tester** joue 1,2 s de bruit au niveau saisi sur ton écoute locale uniquement (rien n'est envoyé sur Discord). « Normaliser toute la bibliothèque » applique la cible saisie et affiche sa progression **dans le panneau**, qui reste ouvert — tu peux cliquer « Appliquer » ou ajuster d'autres réglages pendant ce temps. **« Remettre volume et normalisation à zéro »** (deux clics pour confirmer) remet chaque son à volume 100 % / ×1 — découpes, fondus, favoris, catégories et raccourcis ne sont pas touchés. |

Clique **Appliquer**. Le bandeau en bas de fenêtre affiche les routes actives (`Discord : … · Casque : …`).

> **Après la mise à jour « normalisation loudness »** : les anciens réglages de normalisation (calculés sur le pic) sont remis à ×1 — relance **« Normaliser toute la bibliothèque »** une fois pour recalculer en LUFS. Tes volumes manuels, découpes, favoris et catégories ne sont pas touchés.

## 4. Configurer Discord

1. Discord → **Paramètres utilisateur** (roue dentée en bas à gauche) → **Voix et vidéo**.
2. **Périphérique d'entrée** : choisis **« Défaut » / « Default »** si tu utilises la bascule micro automatique de SoundFart (elle basculera tout seul sur le câble — `CABLE Output` sous Windows, `soundfart_cable.monitor` sous Linux), ou le périphérique du câble directement sinon.
3. **Périphérique de sortie** : choisis ton casque (pas CABLE Input ni SoundFart-Cable, sinon tu risks une boucle).
4. Monte **le volume d'entrée** à ~100–150 % si les sons sont trop faibles (CABLE Output est numérique, tu peux pousser).
5. Dans un salon vocal, vérifie que le micro n'est **pas muet** et que « Tester le micro » capte bien le câble quand tu joues un son.

> **Écho / Larsen** : si tu entends les sons en double ou ta voix-delay, c'est que la sortie Discord et l'écoute locale pointent vers le même périphérique. Sépare-les dans les réglages SoundFart.

## 5. Utiliser SoundFart

- **Ajouter des sons** : glisse-dépose des fichiers **ou des dossiers** audio dans la fenêtre, ou bouton « Ajouter des sons ». Formats : mp3, wav, ogg, flac, m4a, aac, opus, webm, mp4, mkv, mov, m4v.
- **Jouer** : clic sur une carte → le son part sur Discord **et** dans ton casque.
- **STOP** : bouton rouge en bas, ou ton raccourci global STOP.
- **Raccourcis** : dans « Modifier » (✎), clique sur le champ raccourci et tape la combinaison (ex. `Ctrl+Alt+Q`). Fonctionne même fenêtre minimisée.
- **Catégories / favoris** : barre latérale ; ★ sur une carte pour les favoris.
- **Découper / fondus** : « Modifier » → onde avec repères roses + fondus d'entrée/sortie.
- **YouTube** : bouton « 📺 YouTube » → colle le lien. **Laisse début/fin vides** pour récupérer l'audio complet, ou précise une timeline (`02:15` ou secondes) pour un extrait. L'extrait est **physiquement découpé en MP3** quand ffmpeg est disponible (téléchargé une fois, ~115 Mo) ; sinon audio complet + découpe logicielle dans l'éditeur.
- **Couper un son en MP3** : « Modifier » (✎) → règle début/fin → « MP3 de l'extrait » → tu peux remplacer le fichier par le petit MP3.
- **Enregistreur** : « 🎙 Enregistreur » dans la barre latérale. Tu peux mixer plusieurs sources : **micro**, **audio du PC** (voix Discord, musique — capture système) et **câble SoundFart** (sons + micro mixé). Coche « Audio du PC » pour enregistrer une conversation Discord complète. Pendant la prise, une **jauge de niveau** montre le signal ; à l'arrêt tu peux **écouter la prise avant de sauvegarder** et **la rogner** (champs début/fin → WAV sans perte).
- **Traitement vocal** : ⚙ Paramètres → Micro & voix → « Traitement vocal » (réduction bruit/écho sur ta voix uniquement, sans toucher aux sons) avec intensité Léger / Normal / Fort / **Max** — si ta voix sonne étouffée, baisse l'intensité.
- **Sauvegarde** : ⚙ Paramètres → Général → « Exporter la configuration » (récupère tout sauf les fichiers audio ; pour changer de PC, replace les fichiers au même endroit ou utilise « Retrouver le fichier… » sur les cartes marquées).

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Pas de son dans Discord | CABLE Output pas sélectionné dans Discord, ou mauvaise sortie dans SoundFart | Vérifie les deux sens (sections 3 et 4) |
| « Fichier introuvable » sur une carte | Le fichier a été déplacé/supprimé | Clique le badge ou clic droit → « Retrouver le fichier… » |
| Fenêtre noire au démarrage | Fichiers `src/` manquants à côté de `main.js` | Vérifie que tous les `.js` de `src/` (`app.js`, `normalize.js`, `edit-sound.js`, `settings.js`, `recorder.js`, `youtube.js`, `tap-processor.js`, `voice-gate.js`) sont présents |
| « Micro inaccessible » | Permission Windows refusée | Paramètres Windows → Confidentialité → Micro |
| Un son en cours s'est arrêté quand le micro a décroché | Comportement voulu : la perte du micro déclenche une reconstruction complète du graphe audio, qui stoppe aussi les sons | Relance le son ; si le micro revient, tout repart normalement |
| Erreurs techniques | — | `%APPDATA%\SoundFart\soundfart.log` + F12 pour la console |
| Linux : « pactl introuvable » / « serveur injoignable » | `pactl` absent ou pas de serveur PulseAudio/PipeWire | Installe `pulseaudio-utils` (ou `pipewire-pulse`) et vérifie que le service audio tourne (`pactl info`) |
| Linux : « monitor du câble absent » | Le null-sink n'existe pas (jamais créé ou déchargé) | ⚙ → Sortie audio → « Créer/vérifier le câble » |
| Linux : raccourcis globaux inactifs | Session **Wayland** (X11 requis par `globalShortcut`) | Connecte-toi en X11, ou utilise les raccourcis dans la fenêtre ; sous XWayland ça peut fonctionner |
| Linux : micro « coincé » sur le câble après un crash | Restauration automatique échouée | ⚙ → Micro & voix → « Restaurer ma source micro » (ou `pactl set-default-source <ta source>`) |

## 7. Note légale YouTube

L'import YouTube télécharge l'audio via `yt-dlp` dans le respect des conditions de la plateforme. Tu es responsable de n'importer que des contenus que tu as le droit d'utiliser (tes propres vidéos, contenus libres de droits, extraits autorisés). Aucun DRM ni protection technique n'est contourné.
