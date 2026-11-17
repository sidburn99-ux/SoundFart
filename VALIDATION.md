# VALIDATION.md — Procédure de validation matérielle SoundFart

> Rôle : checklist de validation réelle (audio, Discord, VB-CABLE, Windows).
> Statut : **en cours** — mise à jour après la campagne du 17/11/2026 (feature dossier de sons + audits settings/app.js/worklets).
> Légende : **[U]** = validé par l'utilisateur sur matériel réel · **[A]** = validé par l'agent (CDP/logs, pas d'oreille) · case vide = non testé.
> Quand consulter : avant toute bêta ou release.

## Prérequis

- `dist\SoundFart.exe` buildé depuis la branche testée (portable ; réglages/outils dans `%APPDATA%\SoundFart`, sons créés dans le dossier choisi).
- VB-CABLE installé manuellement depuis https://vb-audio.com/Cable/ (SoundFart ne l'installe jamais).
- Discord configuré : entrée = « Défaut / OS default », sortie = casque ou CABLE Input selon le test.
- Micro physique (USB ou analogique), casque USB, ideally un 2e PC ou un pair Discord pour vérifier le signal reçu.
- `soundfart.log` visible dans `%APPDATA%\SoundFart\` pendant les tests.

## A. Lecture et moteur audio

- [x] Jouer plusieurs sons + bouger le master → volume suit, master 0 % = silence total. **[U] 16/11** : master 50/100 %, master 0 silence, pas de distorsion à 100 %.
- [x] Jouer 5 sons en superposition → pas de clic, pas de coupure, volume cohérent. **[A] 17/11** : 5 `play()` → 5 voix actives, `stopAll` propre.
- [x] STOP global (raccourci) pendant 3 lectures → silence immédiat, cartes « playing » retirées. **[A] 17/11** : 3 voix → `stopAll(true)` → 0 voix.
- [x] Rejouer le même son 10× rapidement (clics rapides) → pas de voix zombie, pas de crash. **[A] 17/11** : 10 `play()` à 60 ms → 10 ok / 0 err, voix bornées.
- [x] Supprimer un son de la bibliothèque pendant sa lecture → pas d'erreur, voix terminée proprement. **[A] 17/11** : `play()` + `removeSound` → voix arrêtée, aucune erreur ; revérifié : voix 1→0 à la suppression, son retiré de `cfg`.
- [x] Importer des fichiers audio (MP3/WAV, noms accents/espaces) → apparaissent en bibliothèque. **[U] 16/11**.
- [ ] Importer un WAV 5 min puis un MP3 3 min → lecture OK, heap log stable (`heap=` dans soundfart.log). **[A] 15/11 partiel** : WAV 5 min décodé + joué, heap stable ; MP3 3 min non testé (même chemin).
- [x] Fichier > 150 Mo → refus propre avec message, pas de crash. **[A] 15/11** : WAV 172,8 Mo refusé proprement. **[U] 16/11** : message « fichier trop long » affiché (toast corrigé ensuite pour les noms à emojis).
- [ ] **Limite de durée** `maxSoundDur` (défaut 45 s, 0 = illimité) → lecture bornée + toast une fois. **[U] 16/11 : reporté — non testé.** *(non coché : reporté par l'utilisateur)*
- [ ] Champ « Durée max » vidé puis Appliquer → la valeur affichée revient à la cible (plus de `0` silencieux = illimité). **[A] 17/11** : garde `''`→NaN ajoutée.
- [x] Champ « Cible loudness (LUFS) » vidé puis « Normaliser toute la bibliothèque » → la normalisation utilise l'ancienne cible, **pas** 0 LUFS. **[A] 17/11** : `+''===0` corrigé (`lufsField`) **+ vérifié runtime CDP** : champ vidé → `normLufs` reste -18, affichage restauré.
- [x] Remplacer un fichier audio à **chemin constant** (ré-export/écrasement dans `sons/`) → `checkMissing` détecte le changement `size:mtime` et le prochain clic joue la **nouvelle** version. **[A] 17/11** : `file:check` retourne `sigs` **+ vérifié runtime CDP E2E** : fichier copié modifié → `checkMissing` → `bufCache` évincé (`cacheApres:false`), pas de badge missing.
- [x] >32 clics rapides sur des sons non cachés → le plafond de voix tient après décodage (plus de pic >32). **[A] 17/11** : re-check post-`await` **+ vérifié runtime CDP** : 45 `play()` concurrents → pic exactement 32 voix, 0 après STOP.
- [ ] Fichier audio corrompu/pathologique → `decodeAudioData` timeout 30 s → toast « Décodage trop long », lectures suivantes OK. **[A] 17/11 partiel** : MP3 aléatoires (200 Ko + faux en-tête ID3) → rejet en ~5 ms avec `noFileErr` correct (fichier présent mais indécodable, pas « introuvable »), décodage suivant OK (sémaphore libéré). Le **timeout 30 s** (fichier qui pend) reste non reproduit — difficile à provoquer.
- [ ] Aperçu YouTube « Écouter » cliqué 3× sur le même fichier → 2ᵉ/3ᵉ clic quasi instantané (cache aperçu). **[A] 17/11** : `allowCache` pour `preview`.

## B. Périphériques

- [x] Débrancher/rebrancher le **micro USB** pendant le mixage → voix revient seule, sans larsen. **[U] 16/11 ×2 builds** : « reprend seul, propre ».
- [ ] Débrancher/rebrancher le casque USB pendant une lecture → `devicechange` → applyAudio → lecture reprend ou toast clair, pas de crash.
- [x] Connecter/déconnecter une sortie (casque/BT) pendant la lecture → l'app continue. **[U] 16/11** : « le son s'arrête quand le micro est débranché (rebuild normal), l'app continue à fonctionner » — la coupure des voix à la reconstruction micro est connue (amélioration possible : refresh micro sans teardown complet).
- [ ] Désactiver/réactiver VB-CABLE dans le Gestionnaire de périphériques → détection + toast, pas de boucle.
- [ ] Brancher VB-CABLE **à chaud** pendant que des sons jouent → un seul rebuild audio (plus de double `applyAudio`), pas de toast micro parasite. **[A] 17/11** : flag `rebuilt`.
- [ ] Perte micro (BT déco/USB) pendant une lecture → sons stoppés (voulu, documenté GUIDE) puis micro reconnecté → voix repart sans restart. **[U] 16/11 partiel** (coupure sons confirmée) ; reconnexion micro **à retester**.
- [ ] Changer le périphérique de sortie par défaut Windows → sortie Discord suit ou message clair.
- [ ] BT : connecter/couper un casque Bluetooth → flap contenu, pas de tempête de toasts.

## C. Enregistrement

- [x] Micro seul → fichier non silencieux. **[U] 16/11** : sources micro/audio-PC validées à l'oreille.
- [x] « Audio du PC » seul → musique système captée, non silencieuse (aussi à master 0 % — le master agit sur l'écoute, pas sur le flux capté). **[U] 16/11** ; **revérifié [A] 17/11** : source PC seule pendant `play()`×3 → webm 9 s peak 0,047 / RMS 0,005 (non nul).
- [x] Câble seul → sons soundboard captés. **[A] 15/11** : RMS 0,0158 / peak 0,15 ; **revérifié [A] 17/11** : prise 7,4 s pendant lecture de 2 sons → webm décodé peak 0,151 / RMS 0,019, ajouté à la bibliothèque (32 sons).
- [x] Micro + PC + câble simultanés → les 3 sources présentes. **[A] 15/11** : RMS 0,0216 / peak 0,26 ; **revérifié [A] 17/11** : 3 sources ON + `play()`×3 → webm 11,2 s peak 0,18 / RMS 0,018 (mix + limiteur OK).
- [x] **Jauge de niveau** visible et active pendant la prise. **[U] 16/11** (bug `startMeter`/`stopMeter` corrigé en route).
- [x] **Écouter avant sauvegarde** : bouton « Écouter » dans le choix du dossier → joue la prise en mémoire sur l'écoute locale. **[U] 16/11**.
- [x] **Rogner avant sauvegarde** (champs Début/Fin → WAV 16 bits). **[A] 17/11** : prise câble rogée Début=1/Fin=4 → `*.wav` RIFF stéréo 16 bits 48 kHz, durée **exactement 3,0 s**, taille cohérente (576 044 o). Pic 0 sur l'extrait = segment pré-lecture silencieux (les sons jouaient après 5 s) — cohérent, pas un défaut.
- [ ] `MediaRecorder.onerror` avec état `inactive` → la prise partielle est sauvegardée + UI nettoyée (plus d'« Enregistrement… » figé). **[A] 17/11** : `onstop` manuel — **non reproduit**.
- [x] Arrêter → dossier → « Enregistrement terminé » → « Ajouter à la bibliothèque » → son jouable. **[U] 16/11** (flux validé ; **[A] 15/11** via `cdp-recflow.js` ; **revérifié [A] 17/11** : sauvegarde `sf-dest\recordings\*.webm` + ajout réel, sons 31→32).
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
- [ ] **Micro coincé sur CABLE Output sans marqueur** (état historique 16/11 soir) → modale « Réparer » au lancement + bouton « Restaurer mon micro » fonctionnel (`force`). **[A] 17/11** : code en place — **reproduire l'état réel non fait**.
- [ ] **Qualité voix stéréo** : `voice-gate` gain synchronisé sur les 2 canaux (commit `[AUDIO] 28232d3`) → pas de décalage/click aux transitions du gate, voix toujours centrée. **À valider à l'oreille — non testé.**
- [x] Le micro physique arrive bien à Discord. **[U] 16/11** (validé en appel réel).

## E. Import YouTube / ffmpeg

- [x] URL valide → Analyser → infos correctes → téléchargement → « Ajouter à la bibliothèque » → son jouable. **[U] 16/11**, y compris une vidéo de **19 min** *(import/ajout validé ; la lecture est bornée à `maxSoundDur` = 45 s par défaut — non testée)*.
- [x] **Annuler le téléchargement** → modale fermée proprement, pas de pseudo-erreur, pas de second yt-dlp (bug « repli audio complet » corrigé 16/11). **[U] 16/11**.
- [x] Erreurs YouTube en français (privée, indisponible, réseau). **[U] 16/11**.
- [x] Extrait avec timeline → MP3 de la bonne durée. **[U] 16/11** (extraits validés ; **[A]** chemin `media:cut`).
- [x] Couper un extrait (`media:cut`) → MP3 créé, **original intact**. **[U] 16/11** ; **revérifié [A] 17/11** : coupe 1-5 s d'un enregistrement câble → `cuts\*_extrait.mp3` ID3, durée exactement 4,00 s, **peak 0,145 / RMS 0,018** (audio réel), routé sous `sf-dest\cuts\`.
- [x] Sans timeline → audio complet + trim dans l'éditeur. **[A] 17/11 — parcours UI complet validé** : modale → URL → « Analyser » (titre + durée 0:19 réels) → « Télécharger l'extrait » → « Ajouter à la bibliothèque » → son « Me at the zoo » dans la bibliothèque (33 sons), fichier `sf-dest\imports\*.webm` 252 Ko décodé 19 s / peak 0,32. (L'API directe `yt:download`/full avait aussi été validée.)
- [ ] Débrancher le réseau pendant le téléchargement → erreur propre, pas de `.part` géant.
- [ ] **Imports YouTube concurrents** : deux téléchargages lancés ensemble → `.part` uniques, pas de fichier mixte. **[A] 17/11** : noms `pid+seq` — **non reproduit**.
- [ ] **Modale YouTube/éditeur fermée pendant le download/export** → pas de modale résultat rouverte sans demande (toast à la place). **[A] 17/11** — **non reproduit**.
- [ ] `yt-dlp` auto-update (hash vérifié) → version bump réel loggé, pas de downgrade.

## F. Robustesse / résilience

- [x] Fermer pendant un téléchargement yt-dlp → plus de processus orphelins (taskkill /T synchrone à will-quit depuis le 16/11). **[A] 15/11** : 0 processus résiduel après kill brutal.
- [x] Importer 200 sons d'un coup → UI fluide. **[A] 15/11** : 29→229 sons, heap stable.
- [x] **Runtime CDP complet** (`cdp-drive.js`, 17/11, `--test-profile`) : 12/12 PASS — contexte page, AudioContexts running, `file:check` contrat `{missing,sigs}`, `rec:save` + rejet contrat, lecture réelle + stopAll, `yt:info` erreur, config roundtrip, `applyAudio` re-run, teardown/rebuild complet. + sonde ad-hoc : plafond voix 32 prouvé, panneau réglages OK, champ LUFS vide rejeté, bannière storageDir OK.
- [x] **Soak 5 min** (`cdp-soak.js`, 17/11, `--test-profile`) : 15 rounds de `play()`×3 + `stopAll` + `checkMissing` + `renderGrid` toutes les 20 s → heap **figé à 10 Mo** du début à la fin (`performance.memory` + `heap=` log), `bufCache` stable à 5 Mo, contextes `running`, aucun `[crash]`/`[child-gone]` pendant la session. Pas de fuite sur les chemins exercés.
- [ ] Session 2-4 h : sons en boucle + enregistrements → heap stable dans soundfart.log, pas de croissance continue. (Le soak 5 min est vert ; la durée longue reste à faire — `cdp-soak.js <secondes>` accepte une durée plus grande.)
- [x] Corrompre `config.json` → `.broken-*` créé, `.bak` chargé. **[A] 15/11**.
- [x] Copier un `config.json` > 16 Mo → refus propre. **[A] 15/11**.
- [x] **Veille/réveil** PC avec l'app ouverte → audio reconstruit, sons jouent. **[U] 16/11** sur le build corrigé (`closed` → rebuild borné ; `deadRetries` reset après rebuild réussi — correctif anti-régression du 16/11).
- [x] **Raccourcis clavier** : `Ctrl+1` (AZERTY) déclenche le son. **[U] 16/11** — bug layout corrigé (`e.code` au lieu de `e.key`) ; touche seule = refus voulu (global Windows exige modifieur/F).
- [x] **Paramètres style Discord** : nav latérale + sections, icônes, lignes séparées. **[U] 16/11** « OK, comme Discord » + **[A]** CDP (5 sections, apply, orphelins).
- [x] **Imports orphelins** : liste `imports/` non ajoutés → cocher → ajouter → jouables. **[U] 16/11** (4 fichiers trouvés et ajoutés).
- [x] **Normalisation** : « Tester » + « Normaliser toute la bibliothèque » après refonte Paramètres. **[U] 16/11** + **[A] 17/11 runtime CDP** : `normalizeAll` sur 30 sons → 31 norms calculées (échantillon 2.5/1.38/0.89/0.45/2.12), aucune erreur.
- [x] **Éditeur** : ouverture « Modifier le son » + onde chargée + fermeture Échap propre. **[A] 17/11 runtime CDP** ; **édition complète [A] 17/11** : nom + volume (175 %) modifiés → « Enregistrer » → persisté dans `cfg` + modale fermée propre.
- [x] **Enregistreur** : modale s'ouvre (Enregistrer/Arrêter/Fermer/Ajouter), fermeture Échap sans prise → aucune ressource restante. **[A] 17/11 runtime CDP** (prisen réelle non testée — voir section C).
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

## H. Stockage & premier lancement (feature 17/11 — NON testée terrain)

- [ ] Premier lancement sans `storageDir` → bannière « Choisis ton dossier de sons » visible, skippable. **[A] 17/11 partiel** : profil test sans storageDir → bannière visible (`hidden=false`) ; `updateStorageUi` bascule correctement dans les 2 sens (vérifié CDP). Reste : parcours complet choisir→persister→restart.
- [x] Glisser-déposer un MP3 → **copié** dans `<dossier>/sons/` (copie atomique), carte pointe sur la copie. **[A] 17/11 runtime CDP** : `addPaths` → fichier physique dans `sf-dest\sons\`, son ajouté (30→31).
- [x] Réimporter le même fichier → réutilise la copie existante (nom+taille+échantillons), **pas de doublon** disque. **[A] 17/11 runtime CDP** : 2ᵉ import → 31 sons, 1 seul fichier dans `sons/`.
- [x] Importer sans dossier choisi → blocage + proposition de choisir (bannière/re-modale), pas d'écriture dans AppData. **[A] 17/11 runtime CDP** : `confirmBox` « Choisir un dossier » affichée, « Annuler » annule proprement (aucun modal résiduel, aucun fichier créé).
- [x] YouTube → `imports/`, enregistreur → `recordings/`, extrait MP3 → `cuts/` sous le dossier choisi. **[A] 17/11** : les trois dossiers respectent `storageDir` — `sf-dest\imports\` (YouTube), `sf-dest\recordings\` (prises), `sf-dest\cuts\` (extrait MP3).
- [x] Retirer un son de la bibliothèque → le fichier copié **reste** dans `sons/`. **[A] 17/11** : suppression d'un son `recordings\*.webm` → retiré de `cfg`, `readFile` confirme le fichier toujours présent.
- [ ] Paramètres → « Choisir… »/« Réinitialiser » le dossier → **persisté immédiatement** (visible après restart), bannière mise à jour.
- [ ] Export/import `config.json` → bannière storageDir reflète la config importée ; « Annuler » l'import depuis les réglages **rouvre le panneau**.
- [ ] Champ LUFS/durée max invalides dans la config importée → `normalizeCfg` retombe sur les défauts (pas de NaN).
- [ ] Migration `SoundFart-data` → `%APPDATA%` : déjà vérifiée en réel le 17/11 (config 36 sons reprise, backups créés) — **retester sur profil vierge** si possible.

## I. Réglages & cycles de vie (audits 17/11 — NON testés terrain)

- [ ] Import config pendant un décodage en vol → pas de double décodage (`bufInflight` garde d'identité).
- [ ] `stopFallback` sur contexte suspendu → nodes déconnectés après 1,5 s (plus de gain zombie).
- [ ] Toast « micro muet » en rafale BT → un seul toast / 10 s.
- [ ] `devicechange` avec cable + deviceId changés ensemble → un seul `applyAudio` (log `[devicechange]` unique).
- [ ] `init()` avec `applyAudio` en échec → raccourcis quand même enregistrés (log `[shortcuts]`).
- [ ] « Restaurer mon micro » avec marqueur absent → no-op propre ; avec état coincé → `force` rebasculé vers non-virtuel.

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
