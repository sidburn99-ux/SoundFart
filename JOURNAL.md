# Journal de code - SoundFart

> Rôle : journal des versions (historique des changements par version). Statut : **historique** — ne pas lire par défaut ; consulter uniquement pour retracer une version passée (détail dans `JOURNAL_DE_DEVELOPMENT.md`).

## Etat actuel : v1.4

### v1.4 - portable only, VB-CABLE manuel, robustesse audio, tests
- [x] Portable uniquement (SoundFart.exe, compression store ~375 Mo, demarrage ~2 s) + SoundFart-data a cote de l'exe (config/outils/logs)
- [x] VB-CABLE jamais embarque (licence) : ecran d'accueil + bandeau + lien officiel vb-audio.com/Cable + detection a chaud devicechange ; ensureCableDriver/NSIS/snooze supprimes
- [x] Instance unique stricte (app.exit(0), pas de restauration parasite) ; AudioTap PCM float32->IPC->AudioWorklet (anti-echo Discord) + gardes parent/erreurs/downmix ; guard <pid> + watchdog async + bouton « Restaurer mon micro »
- [x] Telechargements verifies SHA-256 + versions epinglees ; outils C# hashés ; cache 256 Mo ; IPC valide ; CSP durcie ; lib/audio-utils.js + 14 tests node:test ; logs a niveaux + session
- Detail : JOURNAL_DE_DEVELOPMENT.md — NON teste : flux complet avec VB-CABLE installe, appel Discord reel

### v1.3 - coupe physique MP3, dossier de stockage, vignettes, bascule micro auto
- [x] ffmpeg telecharge auto (~80 Mo) : extraits YouTube en vrai MP3 + bouton "MP3 de l'extrait" dans l'editeur
- [x] Dossier de stockage configurable (imports/, recordings/, cuts/)
- [x] Vignettes emoji+degrade par carte (hash nom+categorie)
- [x] Bascule auto de l'entree micro Windows sur CABLE Output au lancement + restauration a la fermeture (AudioEndpoint.exe C# compile via csc.exe ; TESTE : bascule G930->CABLE OK, restauration OK)
- Detail : JOURNAL_DE_DEVELOPMENT.md

### v1.2 - favoris, raccourcis globaux, enregistreur, YouTube, normalisation, sauvegarde
- [x] Favoris (etoile sur carte, categorie ★ Favoris, persistance)
- [x] Tete de lecture temps reel sur la forme d'onde + clic pour chercher pendant l'ecoute
- [x] Retrouver l'emplacement d'un fichier manquant (badge cliquable + menu contextuel)
- [x] Raccourcis clavier globaux par son + raccourci STOP global (globalShortcut, detection de conflits, badge ⌨ sur les cartes)
- [x] Normalisation du volume (par son + bibliotheque entiere, gain ×1-×4, limiteur conserve)
- [x] Enregistreur integre (micro/périph. au choix, webm/opus, preview, ajout direct)
- [x] Import YouTube (yt-dlp telecharge au 1er usage, segment debut/fin, MP3 si ffmpeg present sinon extrait non destructif)
- [x] Export/import de la configuration JSON
- [x] Formats ajoutes : webm, mp4, mkv, mov, m4v
- [x] JOURNAL_DE_DEVELOPMENT.md + GUIDE.md (installation, VB-CABLE, Discord)
- Non teste en conditions reelles : audio, raccourcis, MediaRecorder, yt-dlp, rebuild exe
- Detail complet : JOURNAL_DE_DEVELOPMENT.md

### v1.1 - tri des categories + editeur de decoupe
- [x] **Tri des categories** (menu sous "Categories") : ordre perso avec fleches ▲▼ au survol, A→Z, Z→A, plus de sons
- [x] **Editeur de decoupe** dans la fenetre "Modifier" : onde sonore, reperes debut/fin glissables ou saisie en secondes, fondu d'entree et de sortie (ms), bouton "Ecouter (casque)" et "Tout reinitialiser"
- [x] Decoupe NON destructive : on memorise debut/fin/fondus par son, le fichier d'origine n'est jamais modifie ni copie. Badge "✂ coupe" sur la carte
- [x] Lecture : `start(offset, duree)` + automation du gain pour les fondus ; STOP utilise cancelAndHoldAtTime (pas de saut de volume)
- Teste (Electron 45, sans carte son) : tris, fleches, onde dessinee, enregistrement des reperes, lecture decoupee/stop. Non teste : rendu a l'oreille, comportement avec de tres longs fichiers

### Options candidates (recherche faite sur Soundpad, Voicemod/Tuna, JN Soundboard, EXP, Sound Monster, SmoredBoard)
1. Raccourcis clavier globaux par son + raccourci STOP global
2. Bouton "son aleatoire" (global ou par categorie) / plusieurs sons sur un meme raccourci
3. Boucle (loop) + mode "maintenir pour jouer" ; option chevauchement oui/non des sons
4. Favoris (categorie speciale en haut)
5. Normalisation automatique du volume
6. Sauvegarde / import-export de la bibliotheque
7. Reduire dans la barre des taches, lancement avec Windows
8. Enregistreur (capturer micro ou son du PC) puis decouper
9. Push-to-talk automatique (simulation de touche, plus delicat)

## v1.0.1

### v1.0.1 - ecran noir + securite
- Probleme signale : fenetre noire avec seulement le titre. Cause probable : fichiers livres a plat, sans le dossier `src` (index.html, style.css, app.js)
- main.js accepte maintenant aussi la structure a plat, et affiche un message d'erreur clair si l'interface est introuvable
- Journal d'erreurs : %APPDATA%\SoundFart\soundfart.log ; F12 (ou Ctrl+Maj+I) ouvre les outils de developpement
- Livraison d'un SoundFart.zip qui conserve l'arborescence
- Vulnerabilites npm : venaient d'Electron 33 (obsolete) et d'electron-builder 25 (18 alertes dont 1 critique). Passage a Electron 45 et electron-builder 26 : 0 alerte sur ce qui est embarque dans l'application, 6 alertes moderes restantes dans electron-builder (outil de fabrication uniquement, pas dans le .exe)
- Re-teste sous Electron 45 : demarrage OK, structure normale et a plat

## v1.0 (reecriture Electron)

### Fait en v1.0
- [x] Renomme en **SoundFart**
- [x] Reecriture complete : Electron + HTML + CSS + JS, theme sombre inspire de Voicemod (barre laterale, cartes colorees, degrade violet/rose)
- [x] Sons = references (chemin d'origine), jamais copies ni deplaces ; glisser-deposer de fichiers OU de dossiers entiers ; bouton "Ajouter des sons"
- [x] Formats : mp3, wav, ogg, flac (m4a, aac, opus ajoutes, a tester)
- [x] Clic sur une carte = lecture vers Discord (CABLE Input) + casque (ecoute locale)
- [x] **Volume par son** (0 a 300 %, non destructif, limiteur anti-saturation) + pre-ecoute casque seulement
- [x] **Tri** : plus recents / plus anciens / A-Z / Z-A / plus utilises / volume
- [x] **Categories** : creer, renommer, changer la couleur, supprimer ; deplacer un son par glisser-deposer sur la categorie ou via la fenetre "Modifier" ; recherche par nom
- [x] Renommer un son (fenetre "Modifier" ou bouton crayon sur la carte), retirer un son (bouton X ou clic droit)
- [x] Reglages audio : sortie Discord, ecoute locale, micro, option "mixer mon micro" (uniquement si la sortie est un cable virtuel -> jamais d'echo dans le casque)
- [x] STOP, volume general, indicateur de fichier introuvable
- [x] Reprise automatique des sons de l'ancienne version Python (chemins seulement) au premier lancement
- [x] Config dans %APPDATA%\SoundFart\config.json
- [x] build.bat -> dist\SoundFart.exe (portable, un seul fichier) ; run-dev.bat pour tester sans fabriquer l'exe

### Verifications faites (environnement Linux, sans carte son)
- Application demarre sans erreur ; ajout/dedoublonnage/filtre des fichiers non audio, categories, tri, recherche, decodage audio 48 kHz, fenetre Modifier : OK
- NON verifie : sortie reelle vers CABLE Input / casque, mixage micro, latence, build Windows (a tester par Benoit)

### Decisions techniques
- Web Audio : un AudioContext par sortie, route avec setSinkId ; micro via getUserMedia (sans echo-cancel / bruit / gain auto)
- Un fichier est decode une fois (cache de 16 sons) puis lu dans les deux sorties
- Electron : contextIsolation + sandbox, seul l'acces "media" est autorise, lecture limitee aux extensions audio
- Portable electron-builder : demarrage un peu plus lent (decompression temporaire a chaque lancement)

## Historique (version Python / Tkinter, dossier DiscordSoundboard)
- v0.1 premier jet ; v0.2 plus de sortie par defaut + micro mixe seulement vers un cable virtuel (correctif "je m'entends")
- v0.3 bouton Supprimer ; v0.4 renommer les sons

## A faire / idees
- [ ] Tester sous Windows (sortie, micro, latence, build) — voir TESTS_VM.md
- [x] Raccourcis clavier globaux par son — fait (globalShortcut Electron)
- [ ] Lancement auto au demarrage de Windows, reduit dans la barre des taches
- [x] Icone de l'application, favoris, rognage (debut/fin) d'un son, normalisation automatique — faits
- [ ] Créer un raccourci de lancement automatique Windows / icône de la barre des tâches (non fait volontairement : portée portable)
