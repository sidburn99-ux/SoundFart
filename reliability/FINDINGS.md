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

## Cycle 2 — passe contradictoire (subagent audits des diffs)

| ID | Sous-système | Gravité | Preuve | Statut | Résumé / correction |
|---|---|---|---|---|---|
| SF-REL-0058 | rec:save | P0 | Confirmé (code) | CLOSED | `i === 0 ? p : ...` — variable `p` indéfinie → ReferenceError à CHAQUE sauvegarde. Régression du fix wx (df353f0), invisible à node --check/npm test (handler main.js). **Correctif usine** : logique extraite dans `lib/audio-utils.writeRecording` (testée unitairement, 32/32) — main.js n'est plus qu'un wrapper. |
| SF-REL-0059 | yt:download taille | P3 | Hypothèse | ACCEPTED | Pas de plafond sur import « audio complet » ; choix utilisateur, disque = risque assumé. Documenté. |
| SF-REL-0060 | AudioTap flush PCM | P4 | Confirmé | CLOSED | Flush stdout à chaque itération ~4 ms → WriteFile ~250/s, seuil 128 Kio mort. Seuil 16 Kio (~40 ms) + flush palier. |
| SF-REL-0061 | tap-processor | P4 | Confirmé | CLOSED | `out[0]` absent → TypeError thread audio ; NaN/Inf PCM propagé. Garde + clamp Number.isFinite. |
| SF-REL-0062 | shortcuts:apply | P4 | Confirmé | CLOSED | Phrase française dans la liste d'accélérateurs → toast absurde. Marqueur '…'. |
| SF-REL-0063 | CSP object-src | P4 | Confirmé | CLOSED | `object-src 'none'` ajouté. |
| SF-REL-0064 | media:cut/yt:download destructure | P4 | Confirmé | CLOSED | Destructuration sans garde → TypeError brut sur null. Garde « options invalides ». |

## Cycle 3 — audits renderer + main.js restants (2 subagents)

### Renderer (src/app.js) — IDs renumerotes SF-REL-0100+ (collision agent)

| ID | Gravité | Statut | Résumé |
|---|---|---|---|
| SF-REL-0100 | P0 | CLOSED | previewBtn undefined dans recorderModal → ReferenceError, enregistreur inaccessible (régression SF-REL-0039). Supprimé de la modale ; préécoute déplacée dans la modale résultat YouTube. |
| SF-REL-0101 | P1 | CLOSED | settings.sort='__proto__' → sorts[__proto__] non callable → renderGrid crash (import/config éditée). Whitelist SORTS/CAT_SORTS + coercions favorite/categoryId. |
| SF-REL-0102 | P1 | CLOSED | askDestDir détruisait la modale YouTube → annulation = perte état, échec téléchargement invisible. pickDir natif + dossier affiché ; modale survit, progression visible. |
| SF-REL-0103 | P1 | CLOSED | Échec rec:save → status sur nœud détaché, prise perdue en silence. toast + uiLog. |
| SF-REL-0104 | P2 | CLOSED | Source « audio du PC » silencieuse si worklet ET repli systemStream échouent → pcConnected guard avant rec.start. |
| SF-REL-0105 | P2 | CLOSED | play() en vol après removeSound/relocateSound → vérif existence+path après getBuffer. |
| SF-REL-0106 | P2 | CLOSED | importConfig ne purgeait pas bufCache (256 Mo orphelins) → clear bufCache/bytes/longWarned/inflight. |
| SF-REL-0107 | P2 | CLOSED | Aucune borne sons/catégories ; file:check >5000 → checkMissing mort. Plafonds 5000/500 + import JSON ≤8 Mo. |
| SF-REL-0108 | P3 | CLOSED | Erreurs file:read (trop gros/EACCES/ext) badgeaient « introuvable » → classification ENOENT vs noFileErr. |
| SF-REL-0109 | P3 | CLOSED | Appliquer réglages avec énumération dégradée effaçait cableId/monId/micId → pickVal préserve si noEnum. |
| SF-REL-0110 | P3 | CLOSED | normalizeAll écrasait s.norm=1 en cas d'échec → conserve le réglage. |
| SF-REL-0111 | P3 | ACCEPTED | Cache bufCache jamais invalidé si fichier remplacé à chemin identique — nécessite stat IPC (mtime+size) ; documenté. |
| SF-REL-0112 | P3 | CLOSED | loadWave O(échantillons) gelait l'UI sur fichiers très longs → stride interne ≤2000/bucket. |
| SF-REL-0113 | P4 | CLOSED | F11/Ctrl+Shift+I absents des raccourcis réservés → ajoutés (normalizeCfg + findShortcutOwner). |
| SF-REL-0114 | P4 | CLOSED | Overlay drag&drop figé sur drag annulé → reset dragend/blur. |
| SF-REL-0115 | P4 | CLOSED | #addBtn pickFiles sans catch → try/catch + logErr. |
| SF-REL-0116 | P4 | ACCEPTED | stopVoice : si onended ne tire pas (contexte suspendu), voix zombie jusqu'au watchdog dur+15 s — fenêtre acceptable, documenté. |

### main.js / C# — IDs renumerotes SF-REL-0120+ (collision agent)

| ID | Gravité | Statut | Résumé |
|---|---|---|---|
| SF-REL-0120 | P1 | CLOSED | Marqueur audio-restore.json avec owner=pid mort + micro déjà sur câble → pas de guard pour la nouvelle session → kill suivant = micro coincé. Adoption du marqueur (owner→pid courant) + respawn guard. |
| SF-REL-0121 | P1 | CLOSED | Race will-quit vs bascule micro : set capture en vol après restoreMicNow → micro coincé sans marqueur. Flag `quitting` testé avant set et spawn guard. |
| SF-REL-0122 | P2 | CLOSED | tapStop pendant tapStart (compile/spawn) → AudioTap orphelin. Epoch tapEpoch vérifié à 2 points. |
| SF-REL-0123 | P2 | CLOSED | N guards AudioEndpoint accumulés (un par bascule). Guard sort si marqueur absent ou owner ≠ pid pendant l'attente. |
| SF-REL-0124 | P2 | CLOSED | audio:restore/watchdog/autoSetup sans mutex commun → audio:restore passe par autoSetupChain ; fallback « non virtuel » exige name non vide (aussi dans chooseRestoreIds). |
| SF-REL-0125 | P2 | CLOSED | audio-restore.json écrit non atomiquement → JSON tronqué irrécupérable. writeRestoreMarker .tmp+rename. |
| SF-REL-0126 | P3 | ACCEPTED | Restauration synchrone will-quit ~15 s/étape — choix assumé (restauration prioritaire), documenté. |
| SF-REL-0127 | P2 | CLOSED | yt:info via execFileP non tracké → execFileTracked (tué au will-quit). |
| SF-REL-0128 | P3 | CLOSED | existsSync approuvait les binaires tronqués. toolSane() (seuils : C# 4 Ko, yt-dlp 1 Mo, ffmpeg 10 Mo) + discardCorruptTool → recompile/reinstall. Sonde --version non retenue : les .cs sont recompilés au hash, yt-dlp/ffmpeg re-téléchargés SHA-256 — la taille suffit à détecter le tronqué. |
| SF-REL-0129 | P3 | ACCEPTED | storageRoot accepte UNC/chemins absolus (choix utilisateur, NAS) — documenté. |
| SF-REL-0130 | P2 | CLOSED | rec:save : wx protège le nom mais pas le contenu → .part + hardlink atomique (repli wx sur FS sans liens). |
| SF-REL-0131 | P3 | CLOSED | media:cut : échec ffmpeg → placeholder 0 octet conservé → unlink en catch. |
| SF-REL-0132 | P3 | CLOSED | .bak lu sans borne de taille → statSync ≤16 Mo aux 2 endroits. (Rotation .bak unique reste ACCEPTED.) |
| SF-REL-0133 | P3 | CLOSED | watchdog relisait config.json sans borne → statSync ≤16 Mo. |
| SF-REL-0134 | P3 | CLOSED | downloadVerified lisait les sommes sans borne → ≤256 Ko. |
| SF-REL-0135 | P3 | CLOSED | yt:download « plus récent » pouvait prendre un .part/artefact → filtre extensions audio + exclusion .part/.ytdl + taille>0. |
| SF-REL-0136 | P4 | ACCEPTED | Artefacts orphelins (.part yt-dlp, arbre ffmpeg, .tmp, .broken-*) non purgés — disque seulement, documenté. |
| SF-REL-0137 | P4 | ACCEPTED | Doublon de SF-REL-0042 (backpressure PCM) — même conclusion. |
| SF-REL-0138 | P4 | CLOSED | ui:log acceptait 
 → injection de lignes de log → strip caractères de contrôle. |
| SF-REL-0139 | P4 | ACCEPTED | file:read suit les symlinks, pas de realpath — renderer local de confiance, documenté. |
| SF-REL-0140 | P3 | CLOSED | Fallback restauration : endpoint sans nom traité « non virtuel » → name requis (main.js + lib). |

## Enquête forensique — crash AudioContext (-1/143)

Observations smoke (test-profile, vraie machine) :
- Crash intermittent : 3 occurrences (11:18, 11:35, 11:38) sur ~6 runs ; runs 12:00 et 12:05 ont survécu >60 s.
- Pattern : ~10 s après création des 2 AudioContext de sortie (cable + mon), les DEUX passent 'suspended' avec « The AudioContext encountered an error from the audio device or the WebAudio renderer » — quasi simultanément. Le crash suit parfois, parfois non.
- deviceIds journalisés : cable=dc79ff…, mon=default. Les contextes sont créés à l'init (applyAudio), pas à la lecture.
- Hypothèse : hoquet du service audio Windows / endpoint suspendu (économie d'énergie, driver Realtek/G930) qui fait tomber le renderer Chromium — niveau en dessous de JS, non corrigeable dans app.js.
- Mitigations en place : statechange → toast + retry applyAudio borné (3×) ; render-process-gone → 1 reload puis dialog ; crashReporter.start ajouté (minidumps locaux dans userData/Crashpad, sans télémétrie) ; uiLog du deviceId dans makeOutput.
- Reste : corréler un .dmp Crashpad avec la prochaine occurrence ; si récurrent, tester désactivation de l'économie d'énergie des endpoints USB/audio ou flag Chromium.


## SF-REL-0141 — writeRecording : .part partage entre ecritures concurrentes (P1, CORRIGE)

**Symptome** : deux `writeRecording` concurrents dans le meme process (double
`rec:save`, ou futur appel parallele) ecrivaient le MEME fichier
`cand.pid.part` : le `unlink` de l'un faisait echouer `link()` de l'autre
(ENOENT) ou corrompait le contenu. Detecte par le test de concurrence ajoute
au cycle 5 (fuzz/proprietes sur lib/audio-utils).
**Cause racine** : le nom du temporaire n'incluait que le PID, pas un
identifiant d'ecriture.
**Fix** : compteur `partSeq` par appel — chaque `.part` est unique.
**Preuve** : test `writeRecording : N ecritures concurrentes` (20 appels
paralleles -> 20 fichiers distincts, 0 `.part` residuel). 37/37 tests verts.

## Synthèse cycle 1
- 57 anomalies qualifiées : 44 CLOSED, 8 ACCEPTED (documentées), 0 INVESTIGATING ouvert — toutes les anomalies qualifiées sont tranchées.
- P0 : 1 (SF-REL-0001) — introduit par la campagne précédente, attrapé par l'audit cycle 2. Preuve que la boucle fonctionne.
- Leçon usine : TOUT changement main.js doit être smoke-testé (npx electron . --test-profile) — node --check ne voit pas les ReferenceError runtime.
