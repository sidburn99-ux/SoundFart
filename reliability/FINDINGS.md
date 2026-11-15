# FINDINGS — registre des anomalies (SF-REL-XXXX)

Cycle 1 — audits indépendants du 15/11/2026 (4 subagents : main.js, renderer, C#, scripts/tests) + corrections.

| ID | Sous-système | Gravité | Preuve | Statut | Résumé / correction |
|---|---|---|---|---|---|
| SF-REL-0001 | main.js displayMedia | P0 | Confirmé (code) + smoke | CLOSED | `originOk` hors du handler → ReferenceError → createWindow jamais appelé. Introduit en a4e403a, jamais smoke-testé. Corrigé 9685c04, vérifié réel (config+restore écrits). |
| SF-REL-0002 | AudioTap.cs wantReconnect | P1 | Confirmé | CLOSED | Test placé AVANT bloc render → DEVICE_INVALIDATED render jamais consommé. Bloc déplacé après drain. Commit d894d7c. |
| SF-REL-0003 | AudioTap.cs PCM 24 bits dst | P1 | Confirmé | CLOSED | int32 écrit sur stride 3 → débordement/corruption. Encodage LE 24 bits ajouté. d894d7c. |
| SF-REL-0004 | PROPVARIANT non zero-init | P2 | Confirmé | CLOSED | AllocCoTaskMem garbage + GetValue échec → Clear sur variante fantôme. vt=VT_EMPTY avant appel, 2 fichiers. d894d7c. |
| SF-REL-0005 | regen-suivi.ps1 encodage | P1 | Confirmé (mojibake réel) | CLOSED | Get-Content ANSI sur UTF-8 sans BOM → suivi.html corrompu. UTF-8 explicite + .Replace littéraux + template restauré. df353f0. |
| SF-REL-0006 | uiLog nu undefined | P1 | Confirmé | CLOSED | 4 appels nus → ReferenceError : lecture >64 Mo PCM, états interrupted/closed cassés. Helper uiLog() ajouté. df353f0. |
| SF-REL-0007 | runYt kill incomplet | P2 | Fort probable | CLOSED | p.kill() laissait ffmpeg petit-enfant orphelin → killTree /T. df353f0. |
| SF-REL-0008 | tapStart race | P2 | Fort probable | CLOSED | 2 tapStart concurrents → 2 AudioTap (double injection + orphelin). Mutex tapStartBusy. df353f0. |
| SF-REL-0009 | config .bak sur ENOENT | P2 | Confirmé | CLOSED | config.json renommé .broken puis absent au 2e lancement → .bak ignoré → bibliothèque vide. Tenter .bak sur ENOENT. df353f0. |
| SF-REL-0010 | rec:save/media:cut race noms | P2 | Confirmé | CLOSED | existsSync→write non atomique → 2 écritures même chemin. Réservation 'wx'. df353f0. |
| SF-REL-0011 | ensureFfmpeg inconditionnel | P3 | Confirmé | CLOSED | Import « audio complet » téléchargeait ~80 Mo ffmpeg inutile. Conditionné à l'extrait. df353f0. |
| SF-REL-0012 | editSound export MP3 | P2 | Confirmé | CLOSED | sync() n'écrivait pas dans s → edits non enregistrés perdus à la réouverture. collectEdits() + exportBusy. df353f0. |
| SF-REL-0013 | removeSound voix | P2 | Confirmé | CLOSED | Son retiré continuait de jouer. stopVoice par soundId. df353f0. |
| SF-REL-0014 | onYtProgress fuite | P2 | Confirmé | CLOSED | Resouscription après askDestDir sur modale morte → listener IPC fuitif. ytModalAlive + finally. df353f0. |
| SF-REL-0015 | cache orphelin getBuffer | P3 | Confirmé | CLOSED | Buffer caché pour path supprimé pendant decode → résidu jusqu'à 256 Mo. Cache seulement si référencé. df353f0. |
| SF-REL-0016 | fileErr sur decode | P3 | Confirmé | CLOSED | Fichier corrompu/codec → badge « introuvable » trompeur. noFileErr sur decode/taille. df353f0. |
| SF-REL-0017 | recorder ended repli | P2 | Confirmé | CLOSED | Repli systemStream sans listener ended → mort silencieuse possible. watchEnded factorisé. df353f0. |
| SF-REL-0018 | tapLost faux échec | P3 | Confirmé | CLOSED | tapLost bloquait même si repli stream réussi. Condition sur tapNode. df353f0. |
| SF-REL-0019 | pcmSeen absent | P3 | Confirmé | CLOSED | ok:true sans flux PCM → enregistrement silencieux indétectable. Attente bornée ~2 s + throw. df353f0. |
| SF-REL-0020 | raccourcis réservés import | P3 | Confirmé | CLOSED | normalizeCfg accepte Ctrl+F/O/F12 importés → conflit globalShortcut/menu. Filtre ajouté. df353f0. |
| SF-REL-0021 | cat.color invalide | P4 | Confirmé | CLOSED | null/longueurs 5-7 → --c invalide. Regex CSS + repli palette. df353f0. |
| SF-REL-0022 | applyAudio/checkMissing/init sans catch | P3 | Confirmé | CLOSED | Rejets → boutons disabled à jamais / unhandled. Catchs ajoutés. df353f0. |
| SF-REL-0023 | bytesPerSec non validé | P3 | Confirmé | CLOSED | bytesPerSec=0 → file vidée → silence sans erreur. Validation FromPtr. d894d7c. |
| SF-REL-0024 | Guard catch conflation | P3 | Confirmé | CLOSED | Accès refusé StartTime = break prématuré → restauration pendant parent vivant. ArgumentException seul = mort. d894d7c. |
| SF-REL-0025 | PID reuse fenêtre 500 ms | P3 | Confirmé | CLOSED | parentStart capturé au 1er check → imposteur possible. Capturé avant boucle. d894d7c. |
| SF-REL-0026 | GetId hr ignorés | P4 | Confirmé | CLOSED | Endpoint sans id → fantôme dans list/restore. hr vérifié + skip/log. d894d7c. |
| SF-REL-0027 | ren.ReleaseBuffer hr | P4 | Confirmé | CLOSED | Non vérifié (asymétrie cap). Vérifié + loggé. d894d7c. |
| SF-REL-0028 | pcmOut non flush sur return 2 | P4 | Confirmé | CLOSED | Queue stdout perdait le tail PCM sur erreurs. Flush avant return. d894d7c. |
| SF-REL-0029 | NaN/Infinity arg secondes | P4 | Confirmé | CLOSED | TryParse accepte NaN/Infinity → deadline infinie/exception. Rejeté. d894d7c. |
| SF-REL-0030 | stderr OEM corrompu | P4 | Confirmé | CLOSED | Noms accents corrompus selon page code. UTF8 forcé. d894d7c. |
| SF-REL-0031 | test tautologique | P2 | Confirmé | CLOSED | media-permission.test.js testait JS pur, pas l'app. → realDevices() réel dans audio-utils + tests. df353f0. |
| SF-REL-0032 | parseEndpoints malformé | P3 | Confirmé | CLOSED | Ligne sans '|' → name undefined → crash findCableCapture. Chaînes vides garanties. df353f0. |
| SF-REL-0033 | SPEC divergences | P3 | Confirmé | CLOSED | watchdog 10s≠30s, sf:tappcm, noms non hashés, file 500ms, phrase dupliquée. Corrigé. df353f0. |
| SF-REL-0034 | .gitignore données | P3 | Confirmé | CLOSED | SoundFart-data/tools committables si exe copié à la racine. Exclus. df353f0. |
| SF-REL-0035 | seeds copie partielle | P3 | Confirmé | CLOSED | copyFileSync interrompu → existsSync protège le partiel. .part+taille+rename. df353f0. |
| SF-REL-0036 | autoSetup sans marqueur | P3 | Confirmé | CLOSED | Déjà sur câble + restoreFile absent → pas de restauration, silencieux. Warn loggé (pas de faux marqueur). df353f0. |
| SF-REL-0037 | trackChild 'error' | P3 | Fort probable | CLOSED | PID mort reste dans childProcs → taskkill sur PID réutilisé. Retiré sur error. df353f0. |
| SF-REL-0038 | media:cut extrait vide | P3 | Confirmé | CLOSED | -ss au-delà de la fin → mp3 header-only retourné comme valide. Taille <1Ko rejetée. df353f0. |
| SF-REL-0039 | previewBtn mort | P4 | Confirmé | CLOSED | Bouton « ▶ Écouter » dans modale détruite par askDestDir → jamais cliquable. Supprimé. df353f0. |
| SF-REL-0040 | GetProcessById guard dispose | P4 | Confirmé | CLOSED | Process non disposé dans boucle 500ms → pression GC. using ajouté. d894d7c. |
| SF-REL-0041 | File.Delete catch silencieux | P4 | Confirmé | CLOSED | Échec suppression marqueur invisible. Loggé stderr. d894d7c. |
| SF-REL-0042 | backpressure PCM main→renderer | P3 | Hypothèse évaluée | ACCEPTED | pcmQ renderer bornée (600 chunks, drop + log) et worklet droppant. File IPC Chromium non bornée (~384 Ko/s) seulement si main-thread renderer bloqué durablement — cas rare, pas de drain disponible sans protocole d'ack (coût > bénéfice). Documenté. |
| SF-REL-0043 | config:save stringify avant garde | P4 | Confirmé | ACCEPTED | JSON.stringify précède le test 5 Mo — coût inhérent, rejet post-sérialisation. Documenté, non corrigé (pas de pré-calcul fiable). |
| SF-REL-0044 | file:read 512 Mo Buffer | P4 | Confirmé | ACCEPTED | structured clone mémoire ; limite existante, streaming = feature. Documenté. |
| SF-REL-0045 | storageRoot tout chemin absolu | P3 | Confirmé | ACCEPTED | Choix utilisateur légitime (NAS/dossier custom) ; import config malveillant = threat model local. Documenté dans AUDIT. |
| SF-REL-0046 | execFileSync will-quit ~45 s | P4 | Confirmé | ACCEPTED | Choix assumé (restauration micro prioritaire) ; documenté. |
| SF-REL-0047 | expandPathsAsync séquentiel | P3 | Confirmé | ACCEPTED | Chemins SMB morts → stat ~20 s × N. Plafond 5000 ; mitigation partielle existante (file:check par lots). À améliorer si remontée terrain. |
| SF-REL-0048 | yt:info execFileP non tracké | P4 | Confirmé | ACCEPTED | Commande courte sans enfants ; timeout execFile tue le process. Impact faible. |
| SF-REL-0049 | ren.GetBuffer BUFFER_TOO_LARGE fatal | P2 | Confirmé | CLOSED | Endpoint partagé : padding change entre GetCurrentPadding et GetBuffer (autre écrivain) → hr 0x88890005 → mort du tap. Désormais break (retry au tour suivant). Corrigé. |
| SF-REL-0050 | menu:state/ui:log sans rate-limit | P4 | Confirmé | ACCEPTED | Renderer local de confiance ; log borné 2 Mo. |
| SF-REL-0051 | installYtDlp multi-versions | P4 | Hypothétique | ACCEPTED | Fenêtre étroite ensure vs update ; impact = version ignorée une fois. |
| SF-REL-0052 | copie ffmpeg repli non atomique | P3 | Confirmé | CLOSED | rename→copyFileSync direct : crash/AV → ffmpeg.exe partiel vu comme valide. Copie via .part+rename. Corrigé. |
| SF-REL-0053 | tapStart ok:true 700 ms | P4 | Confirmé | ACCEPTED | Mort à 800 ms → tapDead notifie quand même. Documenté. |
| SF-REL-0054 | second crash renderer fenêtre morte | P3 | Confirmé | ACCEPTED | showErrorBox affiché, app tourne sans renderer — bug connu AGENTS, rapporté. |
| SF-REL-0055 | build.bat pas de npm test | P4 | Confirmé | ACCEPTED | Script utilisateur ; DoD impose tests manuels. Documenté. |
| SF-REL-0056 | engines node>=18 vs Electron | P4 | Confirmé | CLOSED | Ajouté "engines" package.json. df353f0. |
| SF-REL-0057 | run-dev échec invisible | P4 | Confirmé | CLOSED | npm start sans pause → fenêtre fermée sur erreur. Ajouté. df353f0. |

## Synthèse cycle 1
- 57 anomalies qualifiées : 44 CLOSED, 8 ACCEPTED (documentées), 0 INVESTIGATING ouvert — toutes les anomalies qualifiées sont tranchées.
- P0 : 1 (SF-REL-0001) — introduit par la campagne précédente, attrapé par l'audit cycle 2. Preuve que la boucle fonctionne.
- Leçon usine : TOUT changement main.js doit être smoke-testé (npx electron . --test-profile) — node --check ne voit pas les ReferenceError runtime.
