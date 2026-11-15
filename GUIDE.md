# SoundFart — Guide d'installation et de configuration

> Rôle : guide utilisateur (installation, VB-CABLE, Discord, réglages, dépannage). Statut : **actuel**. À consulter : pour utiliser ou configurer l'application.

SoundFart est une soundboard pour Discord : elle joue tes sons dans un **micro virtuel** que Discord utilise comme entrée micro, pendant que tu les entends dans ton casque.

## 1. Installer SoundFart

### Version .exe (recommandé)
1. Télécharge `SoundFart.exe` et lance-le (fichier portable, **aucun install**, aucune désinstallation).
2. **Important** : toutes les données (config, sons importés, enregistrements, outils, logs) sont rangées dans le dossier **`SoundFart-data` à côté de l'exe** — si tu déplaces l'exe, déplace aussi ce dossier pour garder ta bibliothèque.
3. Au premier lancement sans VB-CABLE, un écran « VB-CABLE requis » s'affiche (voir section 2).

### Depuis les sources
1. Installe **Node.js** (version LTS) : https://nodejs.org
2. Double-clique sur `run-dev.bat` pour tester, ou `build.bat` pour reconstruire `dist\SoundFart.exe`.

Ta configuration est sauvegardée dans `SoundFart-data\config.json` (à côté de l'exe ; `%APPDATA%\SoundFart\` en repli). Les fichiers audio ne sont **jamais copiés ni modifiés** : SoundFart ne garde que leurs chemins d'accès.

## 2. Installer le câble virtuel (VB-CABLE)

Pour que Discord entende les sons, il faut un périphérique audio virtuel qui fait le lien entre SoundFart et Discord. **SoundFart ne l'embarque ni ne l'installe** (licence VB-Audio) : tu l'installes toi-même, une seule fois.

1. Lance SoundFart : si VB-CABLE manque, un écran « VB-CABLE requis » s'affiche avec un **gros bouton de téléchargement** (ou va directement sur https://vb-audio.com/Cable/ — affiché en clair dans l'écran et les réglages).
2. Dézippe l'archive, **clic droit sur `VBCABLE_Setup_x64.exe` → « Exécuter en tant qu'administrateur »**, clique sur **Install**.
3. **Redémarre Windows** : les périphériques n'apparaissent qu'après le reboot.
4. De retour dans SoundFart, clique **« J'ai installé, vérifier »** (ou le bouton **Vérifier** des réglages) : l'écran se ferme tout seul dès que le câble est détecté, sans relancer l'app.
5. Dans Windows, tu verras apparaître **« CABLE Input »** (sortie) et **« CABLE Output »** (entrée).

> Sans VB-CABLE, SoundFart reste utilisable (sons, éditeur, préécoute, enregistreur) mais **la diffusion vers Discord et la bascule micro automatique sont désactivées** — un bandeau permanent le rappelle. Tu peux aussi utiliser un équivalent (Voicemeeter…) en choisissant sa sortie dans les réglages.

## 3. Configurer SoundFart

Ouvre **⚙ Réglages audio** (barre latérale) :

| Réglage | Quoi choisir |
|---|---|
| **Sortie vers Discord** | `CABLE Input` — c'est vers là que partent les sons. |
| **Écoute locale** | Ton casque/enceintes — tu entends les sons sans que ta voix soit captée. |
| **Mon micro** | Ton vrai micro (casque, webcam…). |
| **Mixer mon micro** | ✅ si tu veux que tes potes entendent **ta voix + les sons** sur le même micro Discord. ❌ si tu préfères gérer ta voix autrement (ex. « Écouter ce périphérique » de Discord). ⚠️ Tant que « Bascule micro automatique » est activée, le mixage est **forcé** — décoche les deux pour une voix gérée ailleurs. |
| **Bascule micro automatique** | ✅ (recommandé) : à l'ouverture, l'entrée micro Windows passe sur **CABLE Output** ; à la fermeture, ton micro (ex. G930) est restauré automatiquement — uniquement si SoundFart a réellement basculé (ton choix manuel est toujours respecté). Un **garde externe** restaure même après un crash/kill du processus. Le bouton **« Restaurer mon micro Windows »** (section « Récupération micro ») force le retour en cas de blocage. |
| **Surveillance micro automatique** | ✅ (recommandé) : vérifie périodiquement que l'entrée micro est toujours sur le câble ; si tu changes le micro toi-même (ou via une autre app), la surveillance se **met en pause pour la session** — impossible de distinguer un choix utilisateur d'un changement parasite. |
| **Dossier de stockage** | Où SoundFart range les fichiers qu'il crée (imports YouTube, enregistrements, extraits MP3). |
| **Niveaux audio** | **Cible de pic** (%) : le niveau de crête visé par la normalisation (89 % ≈ -1 dBFS, défaut). « Normaliser toute la bibliothèque » (ou « Normaliser ce son » dans l'éditeur) ramène le pic de chaque son à cette cible — les fichiers ne sont jamais modifiés. Plus haut = sons plus forts, plus bas = plus doux. |

Clique **Appliquer**. Le bandeau en bas de fenêtre affiche les routes actives (`Discord : … · Casque : …`).

## 4. Configurer Discord

1. Discord → **Paramètres utilisateur** (roue dentée en bas à gauche) → **Voix et vidéo**.
2. **Périphérique d'entrée** : choisis **« Défaut » / « Default »** si tu utilises la bascule micro automatique de SoundFart (il basculera tout seul sur CABLE Output), ou **CABLE Output** directement sinon.
3. **Périphérique de sortie** : choisis ton casque (pas CABLE Input, sinon tu risks une boucle).
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
- **Enregistreur** : « 🎙 Enregistreur » dans la barre latérale. Tu peux mixer plusieurs sources : **micro**, **audio du PC** (voix Discord, musique — capture système) et **câble SoundFart** (sons + micro mixé). Coche « Audio du PC » pour enregistrer une conversation Discord complète.
- **Sauvegarde** : ⚙ Réglages → « Exporter la configuration » (récupère tout sauf les fichiers audio ; pour changer de PC, replace les fichiers au même endroit ou utilise « Retrouver le fichier… » sur les cartes marquées).

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Pas de son dans Discord | CABLE Output pas sélectionné dans Discord, ou mauvaise sortie dans SoundFart | Vérifie les deux sens (sections 3 et 4) |
| « Fichier introuvable » sur une carte | Le fichier a été déplacé/supprimé | Clique le badge ou clic droit → « Retrouver le fichier… » |
| Fenêtre noire au démarrage | Fichiers `src/` manquants à côté de `main.js` | Vérifie que `index.html`, `style.css`, `app.js` sont dans `src/` |
| « Micro inaccessible » | Permission Windows refusée | Paramètres Windows → Confidentialité → Micro |
| Erreurs techniques | — | `SoundFart-data\soundfart.log` (`%APPDATA%\SoundFart\soundfart.log` en repli) + F12 pour la console |

## 7. Note légale YouTube

L'import YouTube télécharge l'audio via `yt-dlp` dans le respect des conditions de la plateforme. Tu es responsable de n'importer que des contenus que tu as le droit d'utiliser (tes propres vidéos, contenus libres de droits, extraits autorisés). Aucun DRM ni protection technique n'est contourné.
