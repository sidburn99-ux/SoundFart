# VALIDATION.md — Procédure de validation matérielle SoundFart

> Rôle : checklist de validation réelle (audio, Discord, VB-CABLE, Windows).
> Statut : **à exécuter** — rien ici n'est testé tant que la case n'est pas cochée.
> Quand consulter : avant toute bêta ou release.

## Prérequis

- `dist\SoundFart.exe` buildé depuis la branche testée (portable, `SoundFart-data` à côté).
- VB-CABLE installé manuellement depuis https://vb-audio.com/Cable/ (SoundFart ne l'installe jamais).
- Discord configuré : entrée = « Défaut / OS default », sortie = casque ou CABLE Input selon le test.
- Micro physique (USB ou analogique), casque USB, ideally un 2e PC ou un pair Discord pour vérifier le signal reçu.
- `soundfart.log` visible dans `SoundFart-data\` pendant les tests.

## A. Lecture et moteur audio

- [ ] Jouer 5 sons en superposition → pas de clic, pas de coupure, volume cohérent.
- [ ] STOP global (raccourci) pendant 3 lectures → silence immédiat, cartes « playing » retirées.
- [ ] Rejouer le même son 10× rapidement (clics rapides) → pas de voix zombie, pas de crash.
- [x] Supprimer un son de la bibliothèque pendant sa lecture → pas d'erreur, voix terminée proprement. **Validé agent 15/11** : `play()` + `removeSound` + confirm → son retiré de `cfg.sounds`, voix arrêtée (`voices:0`), aucune erreur.
- [ ] Importer un WAV 5 min puis un MP3 3 min → lecture OK, heap log stable (`heap=` dans soundfart.log).
- [x] Fichier > 150 Mo → refus propre avec message, pas de crash. **Validé agent 15/11** : WAV 172,8 Mo généré → `play()` refusé (`voice:false`), heap stable 10 Mo, aucune voix zombie, pas de crash.

## B. Périphériques

- [ ] Débrancher/rebrancher le casque USB pendant une lecture → `devicechange` → applyAudio → lecture reprend ou toast clair, pas de crash.
- [ ] Débrancher le micro USB pendant une bascule → micro restauré ou erreur explicite, LED micro éteinte.
- [ ] Désactiver/réactiver VB-CABLE dans le Gestionnaire de périphériques → détection + toast, pas de boucle.
- [ ] Changer le périphérique de sortie par défaut Windows → sortie Discord suit ou message clair.
- [ ] BT : connecter/couper un casque Bluetooth → flap contenu, pas de tempête de toasts.

## C. Enregistrement

- [ ] Micro seul → fichier non silencieux (vérifier niveau, pas juste existence).
- [ ] « Audio du PC » seul → musique système captée, non silencieuse.
- [ ] Câble seul → sons soundboard captés.
- [ ] Micro + PC + câble simultanés → les 3 sources présentes, limiteur anti-saturation OK.
- [ ] **Régression V2** : Arrêter → choisir dossier → « Enregistrement terminé » → « Ajouter à la bibliothèque » → son présent et jouable.
- [ ] Fermer la modale pendant l'enregistrement → fichiers partiels non ajoutés, micro éteint (LED).
- [ ] Débrancher le micro pendant l'enregistrement → arrêt propre + message, pas de fichier silencieux présenté comme réussi.
- [ ] Arrêter/démarrer Windows Audio (`net stop audiosrv` admin) pendant « Audio du PC » → comportement observé : soit reconnexion AudioTap (log « reconnecte »), soit tapDead + message — **pas de silence invisible**.

## D. Routage micro → Discord

- [ ] `autoSwitchMic` ON → lancer SoundFart → entrée Windows bascule sur CABLE Output → Discord entend micro + sons.
- [ ] Quitter proprement → micro restauré sur l'ancien périphérique (vérifier dans Paramètres Windows).
- [ ] Tuer SoundFart (Gestionnaire des tâches) pendant la bascule → guard restaure le micro en < ~2 s.
- [ ] Relancer SoundFart < 500 ms après le kill → pas de micro coincé sur CABLE (test TOCTOU).
- [ ] Changer l'entrée micro manuellement pendant la bascule → watchdog suspend la surveillance (log « surveillance suspendue »), pas de re-bascule forcée.
- [ ] Vérifier que le micro physique arrive bien à Discord (pair ou 2e PC) — **un test local ne prouve rien**.

## E. Import YouTube / ffmpeg

- [ ] URL valide → Analyser → infos correctes → progression 0→100 % cohérente (régression : plus de « -100 % » ni « 1 % = 100 % »).
- [ ] Extrait avec timeline → MP3 de la bonne durée.
- [ ] Sans timeline → audio complet + trim dans l'éditeur.
- [ ] **Régression V2** : après « Télécharger », modale « Téléchargement terminé » → « Ajouter à la bibliothèque » → son jouable.
- [ ] Couper un extrait (`media:cut`) → MP3 créé, original intact.
- [ ] Débrancher le réseau pendant le téléchargement → erreur propre, pas de `.part` géant.

## F. Robustesse / résilience

- [ ] Fermer pendant un téléchargement yt-dlp → plus de processus `yt-dlp.exe`/`ffmpeg.exe` orphelins (vérifier Gestionnaire des tâches).
- [ ] Importer 200 sons d'un coup → UI fluide, pas de freeze.
- [ ] Session 2-4 h : sons en boucle + enregistrements → heap stable dans soundfart.log, pas de croissance continue.
- [x] Corrompre `config.json` (texte invalide) → redémarrage → `.broken-*` créé, `.bak` chargé, bibliothèque préservée. **Validé agent 15/11** : config corrompue → `config.json.broken-<ts>` créé, 31 sons rechargés depuis `.bak`, config.json réécrit saine au démarrage.
- [x] Copier un `config.json` > 16 Mo → refus propre, pas de freeze. **Validé agent 15/11** : config 17 Mo → rejet taille, `.broken-*` créé, `.bak` chargé (31 sons), pas de freeze.

## G. Matrice matériel minimale

| Config | Statut |
|---|---|
| Windows 11 + VB-CABLE + micro USB + casque jack | |
| Windows 11 + casque Bluetooth | |
| Windows 10 (si supporté) | |
| Sortie 44,1 kHz / 48 kHz / 96 kHz | |
| Micro analogique (jack) | |

## Crash renderer (-1/143) — protocole forensique

Si le renderer crash : noter l'heure, les actions faites, puis chercher dans `soundfart.log` :
- `heap=NNN/MMM Mo` juste avant → si proche de la limite → **OOM** (decode trop lourd).
- `decode lourd : NNN Mo PCM` → corréler avec le fichier joué.
- `[crash] {...}` → details Electron (reason, exitCode).
- `sortie audio suspended/interrupted` → piste driver/session Windows.

Ne JAMAIS déclarer la cause racine sans cette corrélation — les hypothèses non prouvées restent des hypothèses.
