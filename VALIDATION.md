# VALIDATION.md — Procédure de validation matérielle SoundFart

> Rôle : checklist de validation réelle (audio, Discord, VB-CABLE, Windows).
> Statut : **en cours** — mise à jour après la campagne terrain du 16/11/2026.
> Légende : **[U]** = validé par l'utilisateur sur matériel réel · **[A]** = validé par l'agent (CDP/logs, pas d'oreille) · case vide = non testé.
> Quand consulter : avant toute bêta ou release.

## Prérequis

- `dist\SoundFart.exe` buildé depuis la branche testée (portable, `SoundFart-data` à côté).
- VB-CABLE installé manuellement depuis https://vb-audio.com/Cable/ (SoundFart ne l'installe jamais).
- Discord configuré : entrée = « Défaut / OS default », sortie = casque ou CABLE Input selon le test.
- Micro physique (USB ou analogique), casque USB, ideally un 2e PC ou un pair Discord pour vérifier le signal reçu.
- `soundfart.log` visible dans `SoundFart-data\` pendant les tests.

## A. Lecture et moteur audio

- [x] Jouer plusieurs sons + bouger le master → volume suit, master 0 % = silence total. **[U] 16/11** : master 50/100 %, master 0 silence, pas de distorsion à 100 %.
- [ ] Jouer 5 sons en superposition → pas de clic, pas de coupure, volume cohérent.
- [ ] STOP global (raccourci) pendant 3 lectures → silence immédiat, cartes « playing » retirées.
- [ ] Rejouer le même son 10× rapidement (clics rapides) → pas de voix zombie, pas de crash.
- [ ] Supprimer un son de la bibliothèque pendant sa lecture → pas d'erreur, voix terminée proprement. **[A] 15/11** : `play()` + `removeSound` → voix arrêtée, aucune erreur.
- [x] Importer des fichiers audio (MP3/WAV, noms accents/espaces) → apparaissent en bibliothèque. **[U] 16/11**.
- [ ] Importer un WAV 5 min puis un MP3 3 min → lecture OK, heap log stable (`heap=` dans soundfart.log). **[A] 15/11 partiel** : WAV 5 min décodé + joué, heap stable ; MP3 3 min non testé (même chemin).
- [x] Fichier > 150 Mo → refus propre avec message, pas de crash. **[A] 15/11** : WAV 172,8 Mo refusé proprement. **[U] 16/11** : message « fichier trop long » affiché (toast corrigé ensuite pour les noms à emojis).
- [x] **Limite de durée** `maxSoundDur` (défaut 45 s, 0 = illimité) → lecture bornée + toast une fois. **[U] 16/11 : reporté — non testé.**

## B. Périphériques

- [x] Débrancher/rebrancher le **micro USB** pendant le mixage → voix revient seule, sans larsen. **[U] 16/11 ×2 builds** : « reprend seul, propre ».
- [ ] Débrancher/rebrancher le casque USB pendant une lecture → `devicechange` → applyAudio → lecture reprend ou toast clair, pas de crash.
- [x] Connecter/déconnecter une sortie (casque/BT) pendant la lecture → l'app continue. **[U] 16/11** : « le son s'arrête quand le micro est débranché (rebuild normal), l'app continue à fonctionner » — la coupure des voix à la reconstruction micro est connue (amélioration possible : refresh micro sans teardown complet).
- [ ] Désactiver/réactiver VB-CABLE dans le Gestionnaire de périphériques → détection + toast, pas de boucle.
- [ ] Changer le périphérique de sortie par défaut Windows → sortie Discord suit ou message clair.
- [ ] BT : connecter/couper un casque Bluetooth → flap contenu, pas de tempête de toasts.

## C. Enregistrement

- [x] Micro seul → fichier non silencieux. **[U] 16/11** : sources micro/audio-PC validées à l'oreille.
- [x] « Audio du PC » seul → musique système captée, non silencieuse (aussi à master 0 % — le master agit sur l'écoute, pas sur le flux capté). **[U] 16/11**.
- [x] Câble seul → sons soundboard captés. **[A] 15/11** : RMS 0,0158 / peak 0,15.
- [x] Micro + PC + câble simultanés → les 3 sources présentes. **[A] 15/11** : RMS 0,0216 / peak 0,26.
- [x] **Jauge de niveau** visible et active pendant la prise. **[U] 16/11** (bug `startMeter`/`stopMeter` corrigé en route).
- [x] **Écouter avant sauvegarde** : bouton « Écouter » dans le choix du dossier → joue la prise en mémoire sur l'écoute locale. **[U] 16/11**.
- [ ] **Rogner avant sauvegarde** (champs Début/Fin → WAV 16 bits). **Implémenté 16/11 — non testé.**
- [x] Arrêter → dossier → « Enregistrement terminé » → « Ajouter à la bibliothèque » → son jouable. **[U] 16/11** (flux validé ; **[A] 15/11** via `cdp-recflow.js`).
- [x] Fermer la modale pendant l'enregistrement → arrêt propre, pas de fichier orphelin ajouté. **[U] 16/11** + **[A] 15/11** (`cdp-recclose.js`).
- [ ] Débrancher le micro pendant l'enregistrement → arrêt propre + message, pas de fichier silencieux présenté comme réussi.
- [ ] Arrêter/démarrer Windows Audio (`net stop audiosrv` admin) pendant « Audio du PC » → reconnexion AudioTap ou tapDead + message — pas de silence invisible.

## D. Routage micro → Discord

- [x] `autoSwitchMic` ON → entrée Windows bascule sur CABLE Output au lancement. **[U] 16/11**.
- [x] Quitter proprement → micro restauré sur l'ancien périphérique. **[U] 16/11** : « revenu sur mon micro » ; logs `[mic] will-quit … restauration micro OK`.
- [ ] Tuer SoundFart (Gestionnaire des tâches) pendant la bascule → guard restaure le micro en < ~2 s.
- [ ] Relancer SoundFart < 500 ms après le kill → pas de micro coincé sur CABLE (test TOCTOU).
- [ ] Changer l'entrée micro manuellement pendant la bascule → watchdog suspend la surveillance (log « surveillance suspendue »), pas de re-bascule forcée.
- [x] **Voix indépendante du master soundboard** : micro → limiteur direct, master 0 % + parole = voix OK sur Discord. **[U] 16/11** (décision produit explicite).
- [x] Le micro physique arrive bien à Discord. **[U] 16/11** (validé en appel réel).

## E. Import YouTube / ffmpeg

- [x] URL valide → Analyser → infos correctes → téléchargement → « Ajouter à la bibliothèque » → son jouable. **[U] 16/11**, y compris une vidéo de **19 min**.
- [x] **Annuler le téléchargement** → modale fermée proprement, pas de pseudo-erreur, pas de second yt-dlp (bug « repli audio complet » corrigé 16/11). **[U] 16/11**.
- [x] Erreurs YouTube en français (privée, indisponible, réseau). **[U] 16/11**.
- [x] Extrait avec timeline → MP3 de la bonne durée. **[U] 16/11** (extraits validés ; **[A]** chemin `media:cut`).
- [x] Couper un extrait (`media:cut`) → MP3 créé, **original intact**. **[U] 16/11**.
- [ ] Sans timeline → audio complet + trim dans l'éditeur (partiellement couvert par les imports OK).
- [ ] Débrancher le réseau pendant le téléchargement → erreur propre, pas de `.part` géant.

## F. Robustesse / résilience

- [x] Fermer pendant un téléchargement yt-dlp → plus de processus orphelins (taskkill /T synchrone à will-quit depuis le 16/11). **[A] 15/11** : 0 processus résiduel après kill brutal.
- [x] Importer 200 sons d'un coup → UI fluide. **[A] 15/11** : 29→229 sons, heap stable.
- [ ] Session 2-4 h : sons en boucle + enregistrements → heap stable dans soundfart.log, pas de croissance continue.
- [x] Corrompre `config.json` → `.broken-*` créé, `.bak` chargé. **[A] 15/11**.
- [x] Copier un `config.json` > 16 Mo → refus propre. **[A] 15/11**.
- [x] **Veille/réveil** PC avec l'app ouverte → audio reconstruit, sons jouent. **[U] 16/11** sur le build corrigé (`closed` → rebuild borné ; `deadRetries` reset après rebuild réussi — correctif anti-régression du 16/11).
- [x] **Raccourcis clavier** : `Ctrl+1` (AZERTY) déclenche le son. **[U] 16/11** — bug layout corrigé (`e.code` au lieu de `e.key`) ; touche seule = refus voulu (global Windows exige modifieur/F).
- [x] **Paramètres style Discord** : nav latérale + sections, icônes, lignes séparées. **[U] 16/11** « OK, comme Discord » + **[A]** CDP (5 sections, apply, orphelins).
- [x] **Imports orphelins** : liste `imports/` non ajoutés → cocher → ajouter → jouables. **[U] 16/11** (4 fichiers trouvés et ajoutés).
- [x] **Normalisation** : « Tester » + « Normaliser toute la bibliothèque » après refonte Paramètres. **[U] 16/11**.
- [x] Persistance des réglages après fermeture/réouverture. **[U] 16/11**.
- [ ] **Traitement vocal** (voix seule) : « Normal »/« Fort » réduisent le bruit ; **« Max » (niveau 4, ajouté 16/11) non testé** — clavier encore audible en Fort, retest en attente.
- [ ] Limite 45 s sur fichier long : lecture tronquée + toast — **reporté**.
- [ ] Toast « fichier trop long » sans caractères parasites (nom nettoyé 16/11) — non retesté.

## G. Matrice matériel minimale

| Config | Statut |
|---|---|
| Windows 11 + VB-CABLE + micro USB + casque | **[U] 16/11** — usage quotidien validé (Discord, veille, replug) |
| Windows 11 + casque Bluetooth | partiel — devicechange testé, flap BT non mesuré |
| Windows 10 (si supporté) | non testé |
| Sortie 44,1 kHz / 48 kHz / 96 kHz | non testé |
| Micro analogique (jack) | non testé |

## Crash renderer (-1/143) — protocole forensique

Instrumentation en place depuis le 16/11 : `[child-gone]` (services Chromium avec exitCode), `[devicechange]`, `[mic]`, `[shortcuts]`, `sortie audio closed/interrupted`, `decode lourd`, `heap=`.

**Preuve acquise 16/11** : le smoke test kill a capturé la signature complète — `Audio Service`, `Video Capture`, `Network Service`, `GPU` → `exitCode 143` + erreur `AudioContext…audio device`. Sur un crash réel, le log dira si le fautif est le service audio Chromium.

Si le renderer crash : noter l'heure, les actions faites, puis chercher dans `soundfart.log` :
- `heap=NNN/MMM Mo` juste avant → si proche de la limite → **OOM** (decode trop lourd).
- `decode lourd : NNN Mo PCM` → corréler avec le fichier joué.
- `[crash] {...}` → details Electron (reason, exitCode).
- `[child-gone] {...}` → service Chromium fautif + exitCode.
- `sortie audio suspended/interrupted/closed` → piste driver/session Windows.

Ne JAMAIS déclarer la cause racine sans cette corrélation — les hypothèses non prouvées restent des hypothèses.
