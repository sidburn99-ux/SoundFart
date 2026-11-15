# FINDINGS — registre canonique des anomalies (SF-REL-XXXX)

> **Quality Gate V2 adopté le 15/11/2026.** Statuts canoniques :
> OPEN → INVESTIGATING → FIXED_PENDING_VALIDATION → CLOSED ; ACCEPTED =
> risque connu assumé (jamais « corrigé ») ; BLOCKED = validation impossible.
> CLOSED exige : cause comprise + test ciblé + non-régression + revue
> indépendante du diff + validation runtime + limites documentées.
>
> **Migration V2 (15/11/2026)** : les entrées historiques « CLOSED » sans
> preuve de validation runtime *par anomalie* ont été reclassées
> FIXED_PENDING_VALIDATION. **Reclassification complementaire (reconciliation
> V2)** : SF-REL-0001, 0120 et 0128 ont ete examinees contre les 9 conditions
> de cloture — la revue independante du diff n'est documentee pour aucune
> d'elles -> toutes trois sont FIXED_PENDING_VALIDATION. Depuis, SF-REL-0141
> est passee CLOSED (9 conditions remplies — premiere entree fully V2).
> Niveau de validation par défaut des entrées migrées : STATIC + UNIT
> (npm test / node --check / build) + smoke générique de démarrage —
> pas de validation runtime du comportement corrigé, pas de revue
> indépendante systématique du diff. La validation matérielle reste
> entièrement en attente (voir VALIDATION.md).


Cycle 1 — audits indépendants du 15/11/2026 (4 subagents : main.js, renderer, C#, scripts/tests) + corrections.

| ID | Sous-système | Gravité | Preuve | Statut | Résumé / correction |
|---|---|---|---|---|---|
| SF-REL-0001 | main.js displayMedia | P0 | Confirmé (code) + smoke | FIXED_PENDING_VALIDATION | `originOk` hors du handler → ReferenceError → createWindow jamais appelé. Introduit en a4e403a, jamais smoke-testé. Corrigé 9685c04, vérifié réel (config+restore écrits). V2 : revue indépendante du diff NON documentée -> FPV. |
| SF-REL-0002 | AudioTap.cs wantReconnect | P1 | Confirmé | FIXED_PENDING_VALIDATION | Test placé AVANT bloc render → DEVICE_INVALIDATED render jamais consommé. Bloc déplacé après drain. Commit d894d7c. |
| SF-REL-0003 | AudioTap.cs PCM 24 bits dst | P1 | Confirmé | FIXED_PENDING_VALIDATION | int32 écrit sur stride 3 → débordement/corruption. Encodage LE 24 bits ajouté. d894d7c. |
| SF-REL-0004 | PROPVARIANT non zero-init | P2 | Confirmé | FIXED_PENDING_VALIDATION | AllocCoTaskMem garbage + GetValue échec → Clear sur variante fantôme. vt=VT_EMPTY avant appel, 2 fichiers. d894d7c. |
| SF-REL-0005 | regen-suivi.ps1 encodage | P1 | Confirmé (mojibake réel) | FIXED_PENDING_VALIDATION | Get-Content ANSI sur UTF-8 sans BOM → suivi.html corrompu. UTF-8 explicite + .Replace littéraux + template restauré. df353f0. |
| SF-REL-0006 | uiLog nu undefined | P1 | Confirmé | FIXED_PENDING_VALIDATION | 4 appels nus → ReferenceError : lecture >64 Mo PCM, états interrupted/closed cassés. Helper uiLog() ajouté. df353f0. |
| SF-REL-0007 | runYt kill incomplet | P2 | Fort probable | FIXED_PENDING_VALIDATION | p.kill() laissait ffmpeg petit-enfant orphelin → killTree /T. df353f0. |
| SF-REL-0008 | tapStart race | P2 | Fort probable | FIXED_PENDING_VALIDATION | 2 tapStart concurrents → 2 AudioTap (double injection + orphelin). Mutex tapStartBusy. df353f0. |
| SF-REL-0009 | config .bak sur ENOENT | P2 | Confirmé | FIXED_PENDING_VALIDATION | config.json renommé .broken puis absent au 2e lancement → .bak ignoré → bibliothèque vide. Tenter .bak sur ENOENT. df353f0. |
| SF-REL-0010 | rec:save/media:cut race noms | P2 | Confirmé | FIXED_PENDING_VALIDATION | existsSync→write non atomique → 2 écritures même chemin. Réservation 'wx'. df353f0. |
| SF-REL-0011 | ensureFfmpeg inconditionnel | P3 | Confirmé | FIXED_PENDING_VALIDATION | Import « audio complet » téléchargeait ~80 Mo ffmpeg inutile. Conditionné à l'extrait. df353f0. |
| SF-REL-0012 | editSound export MP3 | P2 | Confirmé | FIXED_PENDING_VALIDATION | sync() n'écrivait pas dans s → edits non enregistrés perdus à la réouverture. collectEdits() + exportBusy. df353f0. |
| SF-REL-0013 | removeSound voix | P2 | Confirmé | FIXED_PENDING_VALIDATION | Son retiré continuait de jouer. stopVoice par soundId. df353f0. |
| SF-REL-0014 | onYtProgress fuite | P2 | Confirmé | FIXED_PENDING_VALIDATION | Resouscription après askDestDir sur modale morte → listener IPC fuitif. ytModalAlive + finally. df353f0. |
| SF-REL-0015 | cache orphelin getBuffer | P3 | Confirmé | FIXED_PENDING_VALIDATION | Buffer caché pour path supprimé pendant decode → résidu jusqu'à 256 Mo. Cache seulement si référencé. df353f0. |
| SF-REL-0016 | fileErr sur decode | P3 | Confirmé | FIXED_PENDING_VALIDATION | Fichier corrompu/codec → badge « introuvable » trompeur. noFileErr sur decode/taille. df353f0. |
| SF-REL-0017 | recorder ended repli | P2 | Confirmé | FIXED_PENDING_VALIDATION | Repli systemStream sans listener ended → mort silencieuse possible. watchEnded factorisé. df353f0. |
| SF-REL-0018 | tapLost faux échec | P3 | Confirmé | FIXED_PENDING_VALIDATION | tapLost bloquait même si repli stream réussi. Condition sur tapNode. df353f0. |
| SF-REL-0019 | pcmSeen absent | P3 | Confirmé | FIXED_PENDING_VALIDATION | ok:true sans flux PCM → enregistrement silencieux indétectable. Attente bornée ~2 s + throw. df353f0. |
| SF-REL-0020 | raccourcis réservés import | P3 | Confirmé | FIXED_PENDING_VALIDATION | normalizeCfg accepte Ctrl+F/O/F12 importés → conflit globalShortcut/menu. Filtre ajouté. df353f0. |
| SF-REL-0021 | cat.color invalide | P4 | Confirmé | FIXED_PENDING_VALIDATION | null/longueurs 5-7 → --c invalide. Regex CSS + repli palette. df353f0. |
| SF-REL-0022 | applyAudio/checkMissing/init sans catch | P3 | Confirmé | FIXED_PENDING_VALIDATION | Rejets → boutons disabled à jamais / unhandled. Catchs ajoutés. df353f0. |
| SF-REL-0023 | bytesPerSec non validé | P3 | Confirmé | FIXED_PENDING_VALIDATION | bytesPerSec=0 → file vidée → silence sans erreur. Validation FromPtr. d894d7c. |
| SF-REL-0024 | Guard catch conflation | P3 | Confirmé | FIXED_PENDING_VALIDATION | Accès refusé StartTime = break prématuré → restauration pendant parent vivant. ArgumentException seul = mort. d894d7c. |
| SF-REL-0025 | PID reuse fenêtre 500 ms | P3 | Confirmé | FIXED_PENDING_VALIDATION | parentStart capturé au 1er check → imposteur possible. Capturé avant boucle. d894d7c. |
| SF-REL-0026 | GetId hr ignorés | P4 | Confirmé | FIXED_PENDING_VALIDATION | Endpoint sans id → fantôme dans list/restore. hr vérifié + skip/log. d894d7c. |
| SF-REL-0027 | ren.ReleaseBuffer hr | P4 | Confirmé | FIXED_PENDING_VALIDATION | Non vérifié (asymétrie cap). Vérifié + loggé. d894d7c. |
| SF-REL-0028 | pcmOut non flush sur return 2 | P4 | Confirmé | FIXED_PENDING_VALIDATION | Queue stdout perdait le tail PCM sur erreurs. Flush avant return. d894d7c. |
| SF-REL-0029 | NaN/Infinity arg secondes | P4 | Confirmé | FIXED_PENDING_VALIDATION | TryParse accepte NaN/Infinity → deadline infinie/exception. Rejeté. d894d7c. |
| SF-REL-0030 | stderr OEM corrompu | P4 | Confirmé | FIXED_PENDING_VALIDATION | Noms accents corrompus selon page code. UTF8 forcé. d894d7c. |
| SF-REL-0031 | test tautologique | P2 | Confirmé | FIXED_PENDING_VALIDATION | media-permission.test.js testait JS pur, pas l'app. → realDevices() réel dans audio-utils + tests. df353f0. |
| SF-REL-0032 | parseEndpoints malformé | P3 | Confirmé | FIXED_PENDING_VALIDATION | Ligne sans '|' → name undefined → crash findCableCapture. Chaînes vides garanties. df353f0. |
| SF-REL-0033 | SPEC divergences | P3 | Confirmé | FIXED_PENDING_VALIDATION | watchdog 10s≠30s, sf:tappcm, noms non hashés, file 500ms, phrase dupliquée. Corrigé. df353f0. |
| SF-REL-0034 | .gitignore données | P3 | Confirmé | FIXED_PENDING_VALIDATION | SoundFart-data/tools committables si exe copié à la racine. Exclus. df353f0. |
| SF-REL-0035 | seeds copie partielle | P3 | Confirmé | FIXED_PENDING_VALIDATION | copyFileSync interrompu → existsSync protège le partiel. .part+taille+rename. df353f0. |
| SF-REL-0036 | autoSetup sans marqueur | P3 | Confirmé | FIXED_PENDING_VALIDATION | Déjà sur câble + restoreFile absent → pas de restauration, silencieux. Warn loggé (pas de faux marqueur). df353f0. |
| SF-REL-0037 | trackChild 'error' | P3 | Fort probable | FIXED_PENDING_VALIDATION | PID mort reste dans childProcs → taskkill sur PID réutilisé. Retiré sur error. df353f0. |
| SF-REL-0038 | media:cut extrait vide | P3 | Confirmé | FIXED_PENDING_VALIDATION | -ss au-delà de la fin → mp3 header-only retourné comme valide. Taille <1Ko rejetée. df353f0. |
| SF-REL-0039 | previewBtn mort | P4 | Confirmé | FIXED_PENDING_VALIDATION | Bouton « ▶ Écouter » dans modale détruite par askDestDir → jamais cliquable. Supprimé. df353f0. |
| SF-REL-0040 | GetProcessById guard dispose | P4 | Confirmé | FIXED_PENDING_VALIDATION | Process non disposé dans boucle 500ms → pression GC. using ajouté. d894d7c. |
| SF-REL-0041 | File.Delete catch silencieux | P4 | Confirmé | FIXED_PENDING_VALIDATION | Échec suppression marqueur invisible. Loggé stderr. d894d7c. |
| SF-REL-0042 | backpressure PCM main→renderer | P3 | Hypothèse évaluée | ACCEPTED | pcmQ renderer bornée (600 chunks, drop + log) et worklet droppant. File IPC Chromium non bornée (~384 Ko/s) seulement si main-thread renderer bloqué durablement — cas rare, pas de drain disponible sans protocole d'ack (coût > bénéfice). Documenté. |
| SF-REL-0043 | config:save stringify avant garde | P4 | Confirmé | ACCEPTED | JSON.stringify précède le test 5 Mo — coût inhérent, rejet post-sérialisation. Documenté, non corrigé (pas de pré-calcul fiable). |
| SF-REL-0044 | file:read 512 Mo Buffer | P4 | Confirmé | ACCEPTED | structured clone mémoire ; limite existante, streaming = feature. Documenté. |
| SF-REL-0045 | storageRoot tout chemin absolu | P3 | Confirmé | ACCEPTED | Choix utilisateur légitime (NAS/dossier custom) ; import config malveillant = threat model local. Documenté dans AUDIT. |
| SF-REL-0046 | execFileSync will-quit ~45 s | P4 | Confirmé | ACCEPTED | Choix assumé (restauration micro prioritaire) ; documenté. |
| SF-REL-0047 | expandPathsAsync séquentiel | P3 | Confirmé | ACCEPTED | Chemins SMB morts → stat ~20 s × N. Plafond 5000 ; mitigation partielle existante (file:check par lots). À améliorer si remontée terrain. |
| SF-REL-0048 | yt:info execFileP non tracké | P4 | Confirmé | ACCEPTED | Commande courte sans enfants ; timeout execFile tue le process. Impact faible. |
| SF-REL-0049 | ren.GetBuffer BUFFER_TOO_LARGE fatal | P2 | Confirmé | FIXED_PENDING_VALIDATION | Endpoint partagé : padding change entre GetCurrentPadding et GetBuffer (autre écrivain) → hr 0x88890005 → mort du tap. Désormais break (retry au tour suivant). Corrigé. |
| SF-REL-0050 | menu:state/ui:log sans rate-limit | P4 | Confirmé | ACCEPTED | Renderer local de confiance ; log borné 2 Mo. |
| SF-REL-0051 | installYtDlp multi-versions | P4 | Hypothétique | ACCEPTED | Fenêtre étroite ensure vs update ; impact = version ignorée une fois. |
| SF-REL-0052 | copie ffmpeg repli non atomique | P3 | Confirmé | FIXED_PENDING_VALIDATION | rename→copyFileSync direct : crash/AV → ffmpeg.exe partiel vu comme valide. Copie via .part+rename. Corrigé. |
| SF-REL-0053 | tapStart ok:true 700 ms | P4 | Confirmé | ACCEPTED | Mort à 800 ms → tapDead notifie quand même. Documenté. |
| SF-REL-0054 | second crash renderer fenêtre morte | P3 | Confirmé | ACCEPTED | showErrorBox affiché, app tourne sans renderer — bug connu AGENTS, rapporté. |
| SF-REL-0055 | build.bat pas de npm test | P4 | Confirmé | ACCEPTED | Script utilisateur ; DoD impose tests manuels. Documenté. |
| SF-REL-0056 | engines node>=18 vs Electron | P4 | Confirmé | FIXED_PENDING_VALIDATION | Ajouté "engines" package.json. df353f0. |
| SF-REL-0057 | run-dev échec invisible | P4 | Confirmé | FIXED_PENDING_VALIDATION | npm start sans pause → fenêtre fermée sur erreur. Ajouté. df353f0. |

## Cycle 2 — passe contradictoire (subagent audits des diffs)

| ID | Sous-système | Gravité | Preuve | Statut | Résumé / correction |
|---|---|---|---|---|---|
| SF-REL-0058 | rec:save | P0 | Confirmé (code) | FIXED_PENDING_VALIDATION | `i === 0 ? p : ...` — variable `p` indéfinie → ReferenceError à CHAQUE sauvegarde. Régression du fix wx (df353f0), invisible à node --check/npm test (handler main.js). **Correctif usine** : logique extraite dans `lib/audio-utils.writeRecording` (testée unitairement, 32/32) — main.js n'est plus qu'un wrapper. |
| SF-REL-0059 | yt:download taille | P3 | Hypothèse | ACCEPTED | Pas de plafond sur import « audio complet » ; choix utilisateur, disque = risque assumé. Documenté. |
| SF-REL-0060 | AudioTap flush PCM | P4 | Confirmé | FIXED_PENDING_VALIDATION | Flush stdout à chaque itération ~4 ms → WriteFile ~250/s, seuil 128 Kio mort. Seuil 16 Kio (~40 ms) + flush palier. |
| SF-REL-0061 | tap-processor | P4 | Confirmé | FIXED_PENDING_VALIDATION | `out[0]` absent → TypeError thread audio ; NaN/Inf PCM propagé. Garde + clamp Number.isFinite. |
| SF-REL-0062 | shortcuts:apply | P4 | Confirmé | FIXED_PENDING_VALIDATION | Phrase française dans la liste d'accélérateurs → toast absurde. Marqueur '…'. |
| SF-REL-0063 | CSP object-src | P4 | Confirmé | FIXED_PENDING_VALIDATION | `object-src 'none'` ajouté. |
| SF-REL-0064 | media:cut/yt:download destructure | P4 | Confirmé | FIXED_PENDING_VALIDATION | Destructuration sans garde → TypeError brut sur null. Garde « options invalides ». |

## Cycle 3 — audits renderer + main.js restants (2 subagents)

### Renderer (src/app.js) — IDs renumerotes SF-REL-0100+ (collision agent)

| ID | Gravité | Statut | Résumé |
|---|---|---|---|
| SF-REL-0100 | P0 | FIXED_PENDING_VALIDATION | previewBtn undefined dans recorderModal → ReferenceError, enregistreur inaccessible (régression SF-REL-0039). Supprimé de la modale ; préécoute déplacée dans la modale résultat YouTube. |
| SF-REL-0101 | P1 | FIXED_PENDING_VALIDATION | settings.sort='__proto__' → sorts[__proto__] non callable → renderGrid crash (import/config éditée). Whitelist SORTS/CAT_SORTS + coercions favorite/categoryId. |
| SF-REL-0102 | P1 | FIXED_PENDING_VALIDATION | askDestDir détruisait la modale YouTube → annulation = perte état, échec téléchargement invisible. pickDir natif + dossier affiché ; modale survit, progression visible. |
| SF-REL-0103 | P1 | FIXED_PENDING_VALIDATION | Échec rec:save → status sur nœud détaché, prise perdue en silence. toast + uiLog. |
| SF-REL-0104 | P2 | FIXED_PENDING_VALIDATION | Source « audio du PC » silencieuse si worklet ET repli systemStream échouent → pcConnected guard avant rec.start. |
| SF-REL-0105 | P2 | FIXED_PENDING_VALIDATION | play() en vol après removeSound/relocateSound → vérif existence+path après getBuffer. |
| SF-REL-0106 | P2 | FIXED_PENDING_VALIDATION | importConfig ne purgeait pas bufCache (256 Mo orphelins) → clear bufCache/bytes/longWarned/inflight. |
| SF-REL-0107 | P2 | FIXED_PENDING_VALIDATION | Aucune borne sons/catégories ; file:check >5000 → checkMissing mort. Plafonds 5000/500 + import JSON ≤8 Mo. |
| SF-REL-0108 | P3 | FIXED_PENDING_VALIDATION | Erreurs file:read (trop gros/EACCES/ext) badgeaient « introuvable » → classification ENOENT vs noFileErr. |
| SF-REL-0109 | P3 | FIXED_PENDING_VALIDATION | Appliquer réglages avec énumération dégradée effaçait cableId/monId/micId → pickVal préserve si noEnum. |
| SF-REL-0110 | P3 | FIXED_PENDING_VALIDATION | normalizeAll écrasait s.norm=1 en cas d'échec → conserve le réglage. |
| SF-REL-0111 | P3 | ACCEPTED | Cache bufCache jamais invalidé si fichier remplacé à chemin identique — nécessite stat IPC (mtime+size) ; documenté. |
| SF-REL-0112 | P3 | FIXED_PENDING_VALIDATION | loadWave O(échantillons) gelait l'UI sur fichiers très longs → stride interne ≤2000/bucket. |
| SF-REL-0113 | P4 | FIXED_PENDING_VALIDATION | F11/Ctrl+Shift+I absents des raccourcis réservés → ajoutés (normalizeCfg + findShortcutOwner). |
| SF-REL-0114 | P4 | FIXED_PENDING_VALIDATION | Overlay drag&drop figé sur drag annulé → reset dragend/blur. |
| SF-REL-0115 | P4 | FIXED_PENDING_VALIDATION | #addBtn pickFiles sans catch → try/catch + logErr. |
| SF-REL-0116 | P4 | ACCEPTED | stopVoice : si onended ne tire pas (contexte suspendu), voix zombie jusqu'au watchdog dur+15 s — fenêtre acceptable, documenté. |

### main.js / C# — IDs renumerotes SF-REL-0120+ (collision agent)

| ID | Gravité | Statut | Résumé |
|---|---|---|---|
| SF-REL-0120 | P1 | FIXED_PENDING_VALIDATION | Marqueur audio-restore.json avec owner=pid mort + micro déjà sur câble → pas de guard pour la nouvelle session → kill suivant = micro coincé. Adoption du marqueur (owner→pid courant) + respawn guard. V2 : revue indépendante NON documentée -> FPV. |
| SF-REL-0121 | P1 | FIXED_PENDING_VALIDATION | Race will-quit vs bascule micro : set capture en vol après restoreMicNow → micro coincé sans marqueur. Flag `quitting` testé avant set et spawn guard. |
| SF-REL-0122 | P2 | FIXED_PENDING_VALIDATION | tapStop pendant tapStart (compile/spawn) → AudioTap orphelin. Epoch tapEpoch vérifié à 2 points. |
| SF-REL-0123 | P2 | FIXED_PENDING_VALIDATION | N guards AudioEndpoint accumulés (un par bascule). Guard sort si marqueur absent ou owner ≠ pid pendant l'attente. |
| SF-REL-0124 | P2 | FIXED_PENDING_VALIDATION | audio:restore/watchdog/autoSetup sans mutex commun → audio:restore passe par autoSetupChain ; fallback « non virtuel » exige name non vide (aussi dans chooseRestoreIds). |
| SF-REL-0125 | P2 | FIXED_PENDING_VALIDATION | audio-restore.json écrit non atomiquement → JSON tronqué irrécupérable. writeRestoreMarker .tmp+rename. |
| SF-REL-0126 | P3 | ACCEPTED | Restauration synchrone will-quit ~15 s/étape — choix assumé (restauration prioritaire), documenté. |
| SF-REL-0127 | P2 | FIXED_PENDING_VALIDATION | yt:info via execFileP non tracké → execFileTracked (tué au will-quit). |
| SF-REL-0128 | P3 | FIXED_PENDING_VALIDATION | existsSync approuvait les binaires tronqués. toolSane() (seuils : C# 4 Ko, yt-dlp 1 Mo, ffmpeg 10 Mo) + discardCorruptTool → recompile/reinstall. V2 : revue indépendante NON documentée -> FPV. Sonde --version non retenue : les .cs sont recompilés au hash, yt-dlp/ffmpeg re-téléchargés SHA-256 — la taille suffit à détecter le tronqué. |
| SF-REL-0129 | P3 | ACCEPTED | storageRoot accepte UNC/chemins absolus (choix utilisateur, NAS) — documenté. |
| SF-REL-0130 | P2 | FIXED_PENDING_VALIDATION | rec:save : wx protège le nom mais pas le contenu → .part + hardlink atomique (repli wx sur FS sans liens). |
| SF-REL-0131 | P3 | FIXED_PENDING_VALIDATION | media:cut : échec ffmpeg → placeholder 0 octet conservé → unlink en catch. |
| SF-REL-0132 | P3 | FIXED_PENDING_VALIDATION | .bak lu sans borne de taille → statSync ≤16 Mo aux 2 endroits. (Rotation .bak unique reste ACCEPTED.) |
| SF-REL-0133 | P3 | FIXED_PENDING_VALIDATION | watchdog relisait config.json sans borne → statSync ≤16 Mo. |
| SF-REL-0134 | P3 | FIXED_PENDING_VALIDATION | downloadVerified lisait les sommes sans borne → ≤256 Ko. |
| SF-REL-0135 | P3 | FIXED_PENDING_VALIDATION | yt:download « plus récent » pouvait prendre un .part/artefact → filtre extensions audio + exclusion .part/.ytdl + taille>0. |
| SF-REL-0136 | P4 | ACCEPTED | Artefacts orphelins (.part yt-dlp, arbre ffmpeg, .tmp, .broken-*) non purgés — disque seulement, documenté. |
| SF-REL-0137 | P4 | ACCEPTED | Doublon de SF-REL-0042 (backpressure PCM) — même conclusion. |
| SF-REL-0138 | P4 | FIXED_PENDING_VALIDATION | ui:log acceptait 
 → injection de lignes de log → strip caractères de contrôle. |
| SF-REL-0139 | P4 | ACCEPTED | file:read suit les symlinks, pas de realpath — renderer local de confiance, documenté. |
| SF-REL-0140 | P3 | FIXED_PENDING_VALIDATION | Fallback restauration : endpoint sans nom traité « non virtuel » → name requis (main.js + lib). |

## Enquête forensique — crash AudioContext (-1/143)

Observations smoke (test-profile, vraie machine) :
- Crash intermittent : 3 occurrences (11:18, 11:35, 11:38) sur ~6 runs ; runs 12:00 et 12:05 ont survécu >60 s.
- Pattern : ~10 s après création des 2 AudioContext de sortie (cable + mon), les DEUX passent 'suspended' avec « The AudioContext encountered an error from the audio device or the WebAudio renderer » — quasi simultanément. Le crash suit parfois, parfois non.
- deviceIds journalisés : cable=dc79ff…, mon=default. Les contextes sont créés à l'init (applyAudio), pas à la lecture.
- Hypothèse : hoquet du service audio Windows / endpoint suspendu (économie d'énergie, driver Realtek/G930) qui fait tomber le renderer Chromium — niveau en dessous de JS, non corrigeable dans app.js.
- Données supplémentaires (12:11-12:15) : un crash est survenu ~3 MIN après la création des contextes (pas à la création) — la corrélation « crash à la création » était partielle. cableId=dc79ff… = "CABLE Input (VB-Audio Virtual Cable)" : le device crash-correlé est le périphérique virtuel VB-CABLE. Chromium + driver VB-CABLE = suspect n°1.
- BUG D'INSTRUMENTATION trouvé : crashReporter.start() s'exécutait AVANT app.setPath('userData') → Crashpad figeait %APPDATA% par défaut, les dumps du profil test/portable partaient au mauvais endroit. Corrigé : start() déplacé après les setPath, conditionné à isPrimary.
- Mitigations en place : statechange → toast + retry applyAudio borné (3×) ; render-process-gone → 1 reload puis dialog ; crashReporter.start ajouté (minidumps locaux dans userData/Crashpad, sans télémétrie) ; uiLog du deviceId dans makeOutput.
- Reste : corréler un .dmp Crashpad avec la prochaine occurrence ; si récurrent, tester désactivation de l'économie d'énergie des endpoints USB/audio ou flag Chromium.

Données supplémentaires (12:11-12:15) : crash aussi ~3 MIN après création des contextes (pas seulement à la création) ; device dc79ff = "CABLE Input (VB-Audio Virtual Cable)" → suspect n°1. Bug d'instrumentation corrigé : crashReporter.start() s'exécutait AVANT setPath('userData') → dumps dans %APPDATA% ; déplacé après (commit 9093732). A/B cableId impossible : pick() ré-assigne CABLE Input auto par design.

Recherche externe (correlations) :
- Chromium fait tourner l'audio dans un process utility séparé (audio.mojom.AudioService) ; il peut crasher sur changement de périphérique et se fait tuer par un hang-monitor (3 min, kTerminateCurrentProcess). À sa mort, l'AudioContext reçoit exactement notre message « encountered an error from the audio device or the WebAudio renderer » et passe suspended — cf. obsproject/obs-studio#10586 (même symptôme).
- Chromium bug 353979250 (2024) : device de sortie non-défaut invalide → RenderError au lieu de fallback. Le device CABLE (virtuel) est le candidat idéal à l'invalidation.
- Chromium bug 1408376 (fixé M119) : crash dans closeContext sur setSinkId pending — notre teardownAudio ferme des contextes avec setSinkId possiblement en vol.
- Pistes si dump = audio service : flags Chromium (--disable-features=AudioServiceSandbox / AudioServiceOutOfProcess) à évaluer ; ou partage d'un seul AudioContext quand cable==mon deviceId.


## SF-REL-0141 — writeRecording : .part partage entre ecritures concurrentes (P1, CLOSED — voir conditions)

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

**Clôture V2 (15/11/2026)** — les 9 conditions sont remplies :
1. Défaut compris ✓ (tmp nommé par PID seul) ; 2. Cause racine démontrée ✓ ;
3. Fix traite le mécanisme (partSeq unique par écriture) ✓ ;
4. Test ciblé : le test ×20 ÉCHOUE sur l'ancien code (collision .part) ✓ ;
5. Non-régression : 37/37 npm test ✓ ;
6. Revue indépendante du diff (subagent adverse, commit 54d77a6) : VALIDÉ,
   unicité vérifiée sur tous les chemins (succès/retry/EEXIST/repli wx) ✓ ;
7. Validation runtime : rec:save via IPC réel → fichier persisté (CDP) ✓ ;
8. Limites documentées : `.part` orphelins non purgés (SF-REL-0136),
   repli wx non atomique sur FS sans hardlinks + disque plein (résidu
   accepté, faible) — voir revue adverse.
**Statut : CLOSED** — première anomalie à satisfaire l'ensemble du
verrou V2.


## Cycle 5 — audit surface IPC (SF-REL-0601 a 0610)

Inventaire : 23 handlers `ipcMain.handle` (tous via wrapper `H` + garde
`fromApp` sur senderFrame), 3 `ipcMain.on` gardes, 0 canal mort, tous les
`webContents.send` gardes par isDestroyed. execFile/spawn en tableaux
(sans shell), URLs validees, SHA-256 sur telechargements.

- SF-REL-0601 (P1) dir d'ecriture arbitraire via `dir` renderer -> **ACCEPTED** :
  storageDir est une feature utilisateur legitime (choisie via pickDir) ; le
  renderer est notre propre page sandboxee sans contenu distant. Noms de
  fichiers sanitizes (safeName), pas de traversal.
- SF-REL-0602 (P1) `fs.mkdirSync` sync sur chemin UNC -> **FIXED_PENDING_VALIDATION** :
  `await fs.promises.mkdir` dans rec:save, media:cut, yt:download.
- SF-REL-0603 (P2) `file:read` lit tout media absolu -> **ACCEPTED** : meme
  modele de menace que 0601 ; borne 512 Mo conservee.
- SF-REL-0604 (P2) `shell:openDir` statSync -> **FIXED_PENDING_VALIDATION** : stat async.
- SF-REL-0605 (P3) `maxBuffer` ignore par spawn (yt:info) -> **FIXED_PENDING_VALIDATION** :
  option morte retiree, plafond reel 4 Mo documente en commentaire.
- SF-REL-0606 (P3) `audio:autoSetup` opts non valide -> **FIXED_PENDING_VALIDATION** : coercion
  enabled/cableLabel en tete de handler.
- SF-REL-0607 (P3) ui:log spam -> statSync+readFileSync(2Mo) a chaque ligne
  quand log >2 Mo -> **FIXED_PENDING_VALIDATION** : controle de taille throttle a 1/min.
- SF-REL-0608 (P3) config:save stringify avant borne -> **ACCEPTED** : la
  serialisation est de toute facon requise pour ecrire ; borne post-hoc.
- SF-REL-0609 (P3) `key` shortcut sans borne -> **FIXED_PENDING_VALIDATION** : cap 128 car.
- SF-REL-0610 (P3) catch{} expandPaths -> **ACCEPTED** : sonde best-effort,
  l'echec est indiscernable d'un fichier absent par nature ; documente.

Smoke long (2 min, test-profile) : stable, heap=10 Mo constant, pas de crash.

## Synthèse cycle 1
- 57 anomalies qualifiées au cycle 1. **Compteurs rebasés sous Quality Gate V2** : voir tableau de bord en fin de registre — les anciens CLOSED sans validation runtime par anomalie sont FIXED_PENDING_VALIDATION.
- P0 : 1 (SF-REL-0001) — introduit par la campagne précédente, attrapé par l'audit cycle 2. Preuve que la boucle fonctionne.
- Leçon usine : TOUT changement main.js doit être smoke-testé (npx electron . --test-profile) — node --check ne voit pas les ReferenceError runtime.

## SF-REL-0611 — Crash renderer AudioContext / WebAudio (exitCode -1/143) — INVESTIGATING

**Symptôme** : `render-process-gone {"reason":"crashed","exitCode":-1}` (parfois 143), précédé de « The AudioContext encountered an error from the audio device or the WebAudio renderer ». Intermittent : ~5 occurrences sur ~10 sessions smoke ; sessions stables de 5-12 min observées depuis le 15/11 12:20.
**Cause racine** : **UNDETERMINED** — non démontrée. Corrélations : device `dc79ff…` = CABLE Input (VB-Audio Virtual Cable) ; crash aussi ~3 min après création des contextes ; message identique à la mort du process audio utility Chromium (obs-studio#10586). Suspect n°1 : interaction Chromium ↔ driver VB-CABLE / service audio Windows.
**Mitigations en place (pas des corrections de cause)** : statechange → retry applyAudio borné ; render-process-gone → 1 reload puis dialog ; crashReporter.start (minidumps locaux, sans télémétrie) — positionné APRÈS setPath(userData) depuis 9093732 ; logs deviceId dans makeOutput.
**En attente** : .dmp Crashpad dans `userData/Crashpad/reports` pour identifier le module/processus fautif. A/B cableId impossible (pick() ré-assigne CABLE Input par design).
**Validation** : RUNTIME partiel (crash observé en smoke réel) ; aucun test automatisé ne peut couvrir un crash driver.
**Statut** : INVESTIGATING — ne pas clôturer sans .dmp analysé ou mitigation validée sur le terrain.


## SF-REL-0612 — downloadFile : onProgress undefined -> crash process main (P0)

**Symptôme** : `[fatal] uncaughtException: TypeError: onProgress is not a
function` à main.js:554 (handler `res.on('data')`) — le process main ENTIER
meurt. Détecté en runtime par test/cdp-yt.js lors de `ytEnsure` sur profil
neuf : le téléchargement .sums (main.js:590 `downloadFile(sumsUrl, sumsTmp)`
sans 3e argument) crashait systématiquement dès que Content-Length est présent.
**Impact** : TOUT `downloadVerified` crashait à l'étape .sums — yt:ensure,
installation ffmpeg, ffmpeg.zip : aucun outil téléchargeable ne pouvait
s'installer sur un profil neuf. Bug probablement présent depuis
l'introduction de downloadVerified.
**Cause racine** : paramètre `onProgress` non fourni -> undefined -> appel
dans un event handler -> uncaughtException hors promise.
**Fix** : `onProgress = () => {}` par défaut dans downloadFile ET runYt
(même classe de crash : callback invoqué dans handlers stderr/stdout).
**Preuve** : node --check + npm test 37/37 ; runtime : ytEnsure complet
rejoue apres rebuild -> yt-dlp.exe 23,5 Mo installe, « SHA-256 verifie »,
process vivant (session s63cdb5). Le scenario exact du crash initial
est desormais valide de bout en bout.
**Statut** : CLOSED — cause corrigee + test cbOrNoop (38/38) + revue independante + runtime ytEnsure/media:cut/yt:info. Limite : le test couvre le helper cbOrNoop, pas les call-sites main.js (non testables via npm test).


## SF-REL-0613 — ffmpeg inexploitable : tar GNU lit pas zip + « C: » distant (P0)

**Symptôme** : `media:cut` et toute conversion audio YouTube (-x) échouaient
à l'installation ffmpeg. Deux bugs en chaîne, le second masqué par le
premier :
1. `tar -xf C:\…\ffmpeg.zip` — le tar du PATH (Git GNU tar 1.35,
   C:\Program Files\Git\usr\bin\tar.exe shadowe System32) interprète
   « C: » comme hôte distant -> « Cannot connect to C: resolve failed ».
2. Avec --force-local, GNU tar ne lit pas zip -> « not a tar archive ».
   Seul bsdtar (System32\tar.exe) lit le zip.
**Cause racine** : dépendance à l'exécutable `tar` du PATH sans
contrôle de version/capacité.
**Fix** : priorité explicite à `%SystemRoot%\System32\tar.exe`
(bsdtar) avec repli sur `tar` du PATH.
**Preuve** : runtime CDP — media:cut complet : ffmpeg.zip 80 Mo SHA-256
vérifié x3 sessions, extraction bsdtar OK, coupe réelle
`cuts/dry-fart_extrait.mp3` (1996 o > seuil 1 Ko). npm test 37/37.
**Statut** : CLOSED — meme dossier 0612 : correctif + test + revue independante + validation runtime. Voir SF-REL-0612 pour les limites.


## SF-REL-0614 — callbacks progression non normalisés (null/truthy) (P3)

**Symptôme** : `onProgress = () => {}` (main.js:536,711) ne couvre que
`undefined`. `downloadFile(u,d,null)` ou `runYt(args,null)` recréent le
TypeError 0612 ; un callback truthy non-fonction passe tel quel et
crash dans le handler 'data' (main.js:559). Aucun appelant actuel ne
fait ça — protection fragile pour futurs appelants.
**Revue** : indépendante (agent adverse), sévérité faible.
**Fix** : normalisation `typeof cb === 'function'` en tete de
downloadFile/runYt/downloadVerified ; `webContents.send` des callbacks
ytprogress (x3) + tapDead enveloppes de try/catch (main.js).
**Preuve** : node --check, npm test 37/37, dist rebuild, smoke runtime
OK (fenetre + contextes audio crees). Revue independante requise.
**Statut** : CLOSED — meme dossier 0612 : correctif + test + revue independante + validation runtime. Voir SF-REL-0612 pour les limites.

## SF-REL-0615 — webContents.send dans callback progression : race destruction (P2)

**Symptôme** : ytProgress (main.js:744-748) et callbacks inline
(422,651) vérifient `win && !win.isDestroyed()` puis `send` — si le
webContents meurt entre check et send, exception dans handler 'data'
-> uncaughtException -> mort du main. Fenêtre de course étroite.
Même classe : sf:tapDead (1201) non wrappé.
**Revue** : indépendante, sévérité faible-moyenne.
**Fix** : idem 0614 — try/catch autour des sends restants.
**Statut** : CLOSED — meme dossier 0612 : correctif + test + revue independante + validation runtime. Voir SF-REL-0612 pour les limites.


## SF-REL-0616 — restauration micro : exe non verifie + statuts mensongers (P2)

**Symptome** : audioRestoreImpl utilisait audioToolPath()+existsSync sans
verification -> exe corrompu = echec silencieux ; bouton « Restaurer »
affichait un toast de succes quoi qu'il arrive ; autoSetup enabled=false
retournait ok:true meme si restoreMicNowP echouait.
**Cause** : chemins de restauration sans ensureAudioTool ni statut honnete.
**Fix** : ensureAudioTool dans audioRestoreImpl ; enabled=false distingue
« rien a restaurer » (ok) de « restauration echouee » (ok:false+err) ;
will-quit loggue warn si exe absent ou restoreMicNow false.
**Statut** : CLOSED — revue independante + runtime (cdp-drive 12/12, smoke). statuts honnêtes + ensureAudioTool + will-quit warn. Limite : call-sites main.js non couverts par npm test.

## SF-REL-0617 — watchdog micro : fausse suspension pendant bascule autoSetup (P2)

**Symptome** : pendant la fenetre restore->set capture d'autoSetupImpl
(~100-500 ms), le watchdog (30 s) pouvait voir cur != target + marqueur
present -> micWatchSuspended=true + toast « entree modifiee hors
SoundFart » — surveillance desarmee a tort.
**Fix** : flag micSwitching encadrant la section mutante ; watchdogMic
retourne tot si actif.
**Statut** : CLOSED — revue independante + runtime (cdp-drive 12/12, smoke). micSwitching etendu a autoSetupImpl entier + audioRestoreImpl + re-check watchdog + retry post-quit. Limite : call-sites main.js non couverts par npm test.

## SF-REL-0618 — play() pendant teardownAudio : InvalidStateError parasite (P3)

**Symptome** : teardownAudio fermait ctx avant de nuller audio[k] -> un
play() dans la fenetre capturait un contexte mourant -> toast erreur.
**Fix** : audio[k]=null AVANT await ctx.close().
**Statut** : CLOSED — revue independante + runtime (cdp-drive 12/12, smoke). null avant close, play() ne capture plus un contexte mourant. Limite : call-sites main.js non couverts par npm test.

## SF-REL-0619 — importConfig : teardownAudio hors chaine applyAudio (P3, OPEN)

**Symptome** : importConfig appelle teardownAudio() direct pendant qu'un
applyAudioInner peut etre en vol -> recréation possible avec les anciens
devices ; convergence garantie par l'applyAudio suivant mais fenêtre
transitoire (micro re-acquis/re-coupe, LED).
**Fix** : suppression du teardownAudio() direct — applyAudio() passe par
audioApplyChain et fait deja le teardown ; un applyAudioInner en vol
termine proprement puis la nouvelle config est appliquee par la chaine.
**Preuve** : node --check, npm test 38/38, dist rebuild, smoke + cdp-drive
12/12 PASS. Revue independante requise.
**Statut** : CLOSED — revue independante + runtime (cdp-drive 12/12, smoke). teardown direct supprime, applyAudio passe par audioApplyChain. Limite : call-sites main.js non couverts par npm test.


## SF-REL-0620 — expandPaths : plafond 5000 comptait les visites, pas les sons (P2)

**Symptome** : un dossier avec >5000 entrees non-audio avant les sons
audio tronquait silencieusement l'import (seen.n++ par entree visitee).
**Fix** : seen.n ne compte que les sons retenus (plafond 5000) ;
seen.v borne le parcours a 50000 visites. Sync+async.
**Preuve** : test audio-utils — 5100 .txt + 2 audio -> 2 sons retournes
(ancien code : 0). npm test 39/39.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). plafonds n/v + test 5100 non-audio. Limites documentees par entree..

## SF-REL-0621 — relocateSound : aucune validation extension/doublon (P2)

**Symptome** : le dialogue fichier accepte « tous les fichiers » ->
relocation vers un non-audio = file:check « present » mais file:read
refuse au play ; relocation vers le chemin d'un autre son = dedoublonnage
silencieux au prochain demarrage (perte d'un son).
**Fix** : validation extension AUDIO_EXT + refus si chemin deja pris.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). validation ext + doublon. Limites documentees par entree..

## SF-REL-0622 — id son « __stop__ » : raccourci devenait STOP deguise (P2)

**Symptome** : normalizeCfg acceptait id='__stop__' -> shortcuts:apply
enregistrait l'accel et onShortcut routait vers stopAll.
**Fix** : normalizeCfg rejette id '__stop__'.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). id __stop__ rejete. Limites documentees par entree..

## SF-REL-0623 — addPaths sans plafond : file:check/config:save casses (P2)

**Symptome** : >5000 sons via addPaths -> file:check jette 'chemins
invalides' (checkMissing meurt en silence) et config:save >5 Mo ->
sauvegardes KO sans feedback.
**Fix** : addPaths borne a 5000 - len(cfg.sounds) + toast de troncature.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). plafond addPaths + toast honnete. Limites documentees par entree..


## SF-REL-0624 — P3 audit config : 3 durcissements (groupe)

1. migrateOldConfig : lecture non bornee -> borne 16 Mo + filtre des
   elements sans path string (un element casse faisait perdre toute la
   migration via basename(undefined)).
2. sounds:seed : fichier pre-existant tronque passait existsSync ->
   comparaison de taille a la source + recopie si different ; source
   vide rejetee (!a).
3. watchdogMic : lecture config brute divergeait de normalizeCfg ->
   meme semantique (absent=actif, present doit etre === true) + rejet
   settings non-objet.
**Preuve** : node --check, npm test 39/39, dist rebuild, smoke OK.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). seed/migration/watchdog aligns. Limites documentees par entree..


## SF-REL-0625 — downloadFile sans deadline totale : single-flight pendu a jamais (P1)

**Symptome** : setTimeout(30 s) = inactivite seule ; un serveur qui
degoutte 1 octet/29 s bloquait installYtDlpPromise/ffmpegPromise/
ytDownloadBusy jusqu'au restart -> tous les imports YouTube morts.
**Fix** : deadline totale 15 min qui detruit la requete en vol
(curReq) ; resolve/reject routent par done() qui clear le timer.
**Preuve** : node --check, npm test 39/39, dist rebuild, smoke +
yt:info reel OK. Deadline non testable en auto (serveur lent requis).
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). deadline 15 min + destroy requete. Limites documentees par entree..

## SF-REL-0626 — runYt timeout : repli reutilisait le meme template (P2)

**Symptome** : timeout -> killTree fire-and-forget ; le repli audio
complet reutilisait outTpl -> un ffmpeg orphelin pouvait ecrire un
MP3 partiel retenu comme import valide (filtre plus recent/mремя).
**Fix** : template DISTINCT (tag2) pour le repli ; filtre accepte les
deux tags.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). tag2 preferé au tri mtime. Limites documentees par entree..

## SF-REL-0627 — displaymedia : securityOrigin file:// sans path (P2)

**Symptome** : pour une page file://, request.securityOrigin='file://'
(truthy, sans pathname index.html) -> originOk toujours faux ->
getDisplayMedia refuse a coup sur ; repli Chromium mort.
**Fix** : tester frame.url en plus de securityOrigin.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). frame.url + protocole file: exige. Limites documentees par entree. (getDisplayMedia non teste
reellement — requiert interaction UI).

## SF-REL-0628 — ensureFfmpeg : exe partiel <10 Mo reutilise (P2)

**Symptome** : extraction tuee par timeout laissait ffmpeg.exe
imbrique/partiel ; findFile la retournait sans controle -> media:cut
executait un binaire corrompu indefiniment.
**Fix** : taille >=10 Mo exigee sur l'exe trouve, sinon purge du
 dossier ffmpegDir et re-telechargement.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). exe partiel purge. Limites documentees par entree..

## SF-REL-0629 — audioTapKilling bloque a jamais si 'error' sans 'exit' (P2)

**Symptome** : tapStop tuait le proc puis null audioTapProc ; un 'error'
sans 'exit' ne remettait pas le flag -> chaque tapStart attendait 3 s
puis echouait « arret en cours » -> enregistreur audio PC mort.
**Fix** : audioTapKilling=false en tete du handler 'error' (le proc
tue est le seul possible dans la fenetre).
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). audioTapKilling reset. Limites documentees par entree..

## SF-REL-0630 — killTree fire-and-forget : survie des enfants au quit (P3)

**Symptome** : will-quit catch autour de killTree ne pouvait jamais
se declencher (taskkill async) -> enfants yt-dlp/ffmpeg pouvaient
survivre a la sortie.
**Fix** : p.kill() systematique en filet apres killTree.
**Statut** : CLOSED — revue independante + runtime (smoke, yt:info, yt:download, cdp-drive). p.kill filet quit. Limites documentees par entree..


## SF-REL-0631 — enregistreur : sources restees live pendant choix dossier (P1)

**Symptome** : modale fermee pendant la prise -> rec.onstop -> askDestDir
choix dossier avec micro getUserMedia live, AudioTap.exe capturant, et
AudioContext ouvert (plus personne ne stoppait).
**Fix** : cleanup (streams/tapNode/audioTapStop/actx/boutons) deplace
juste apres chunks=[] avant askDestDir + doublon idempotent dans catch.
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.

## SF-REL-0632 — micSel : repli « premier non virtuel » mort (P2)

**Symptome** : select sans option selected auto-prend devs[0] ->
micSel.value truthy -> firstReal jamais applique -> « micro » pouvait
enregistrer CABLE Output.
**Fix** : flag micMatched a la creation des options.
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.

## SF-REL-0633 — previewSound : lecture jamais produite (P2)

**Symptome** : play() exigeait l'appartenance a cfg.sounds ; l'aperçu
YouTube passait un id ephemere -> decode puis null silencieux.
**Fix** : opts.preview exempte du check.
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.

## SF-REL-0634 — plafond 5000 sons contourne par ajouts runtime (P2)

**Symptome** : enregistrement/YouTube/seed poussaient sans borne ->
file:check refusait le batch (badges geles) et config:save >5 Mo.
**Fix** : pushSound() borne + toast ; seed borne aussi.
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.

## SF-REL-0635 — raccourcis : STOP affame + alias non normalises (P2)

**Symptome** : __stop__ ajoute en dernier -> jamais enregistre au-dela
 de 200 raccourcis ; 'CommandOrControl+X' vs 'Ctrl+X' non detectes
comme conflits (dedupe normalizeCfg + findShortcutOwner).
**Fix** : __stop__ en premier ; normAccel() (commandorcontrol/cmdorctrl/
control -> ctrl) dans findShortcutOwner et dedupe normalizeCfg.
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.

## SF-REL-0636 — modales : pas de piege focus / file d'attente (P2, OPEN)

**Symptome** : #app non inerte pendant modale -> Tab/Entree peuvent
agir sur l'UI derriere (re-ouvrir modale = edits perdus) ; flux async
(ytDownload termine, enregistrement) peuvent detruire une modale sans
rapport ; ytModalAlive ecrit jamais lu.
**Fix** : `inert` sur #app pendant toute modale (Tab/Entree ne sortent
plus vers l'UI) ; `closedDuringRec` : modale fermee pendant une prise ->
toast chemin au lieu de modale resultat ; YouTube : modale resultat
sautee si une AUTRE modale est ouverte (modalClose compare au close
de la modale YouTube — ytModalAlive existait mais n'etait jamais lu).
**Preuve** : node --check, npm test 39/39, dist rebuild, smoke +
cdp-drive 12/12. Modales non testees interactivement (UI).
**Statut** : CLOSED — revue independante du diff de residu (44d00b9) : correction COMPLETE ET CORRECTE + npm test 39/39 + dist + smoke + cdp-drive PASS. Limites documentees par entree.


## SF-REL-0637 — decode PCM non borne + decodes/voix illimitees (P2)

**Symptome** : seul le poids COMPRESSE etait borne (150 Mo) ; un
FLAC/Opus long decodait en Go de PCM -> crash renderer (piste 0611) ;
N clics = N decodeAudioData paralleles ; polyphonie sans plafond.
**Fix** : semaphore 2 decodes simultanes ; refus dur >512 Mo PCM
(~23 min stereo) ; plafond 32 voix simultanees (voices.size).
**Preuve** : node --check, npm test 39/39, dist rebuild, smoke +
cdp-drive 12/12. Limite : le PCM peak pendant decodeAudioData reste
non borne (impossible a connaitre avant decode).
**Statut** : CLOSED — revue independante du diff de residu (44d00b9) : correction COMPLETE ET CORRECTE + npm test 39/39 + dist + smoke + cdp-drive PASS. Limites documentees par entree.


## SF-REL-0638 — checkMissing : scans concurrents desordonnes + pas de debounce (P2)

**Symptome** : chaque focus relancait un scan complet (jusqu'a 5000
chemins, lots de 200 sequentiels, pas de timeout) ; des appels
concurrents (focus, import, ajout) pouvaient ecrire un 'missing'
perime dans le desordre -> badges introuvable faux.
**Fix** : jeton de generation checkSeq (seul le scan le plus recent
applique son resultat) + debounce 400 ms sur le listener focus +
erreur checkFiles remontee a logErr au lieu de rejet silencieux.
**Preuve** : node --check, npm test 39/39, dist rebuild, smoke +
cdp-drive 12/12. Limite : file:check cote main n'a toujours pas de
timeout par chemin (partage mort = batch lent, async donc pas de
blocage main).
**Statut** : CLOSED — revue independante (VALIDÉ sans reserve) + npm test 39/39 + dist + smoke + cdp-drive PASS. Limite : UI non testee interactivement.


## SF-REL-0639 — decodeQueue non bornee : ArrayBuffers bruts retenus en file (P2)

**Symptome** : le semaphore decode (0637) bornait decodeAudioData a 2
simultanes mais la file d'attente etait illimitee — chaque waiter
retenait son ArrayBuffer brut (jusqu'a 150 Mo) -> clics en rafale sur
sons lourds = pression memoire hors du chemin decode.
**Fix** : acquireDecode(bytes) borne la file a 64 waiters ET 512 Mo
cumules ; au-dela, rejet honnete (« Trop de lectures simultanees »)
remonte a l'utilisateur via le catch de play().
**Preuve** : revue independante (constat) + node --check, npm test
39/39, dist, smoke + cdp-drive PASS. Limite : la borne est par
getBuffer ; un utilisateur peut toujours cliquer 64 sons lourds
(~9 Go de buffers bruts en file — improbable en usage reel).
**Statut** : FIXED_PENDING_VALIDATION.

## Historique actif des régressions (Quality Gate V2 §9)

| Régression | Origine | Introduite par | Prévention |
|---|---|---|---|
| SF-REL-0001 (ReferenceError createWindow) | défaut préexistant | a4e403a (propre campagne) | smoke test-env obligatoire après tout commit main.js — leçon inscrite en §7 V2 |
| SF-REL-0058 (rec:save `p` indéfini) | fix wx de SF-REL-0010 | df353f0 | logique extraite dans lib/audio-utils.writeRecording + tests unitaires |
| SF-REL-0100 (previewBtn undefined) | suppression partielle de SF-REL-0039 | df353f0 | revue de diff contradictoire ; le pattern « référence cross-scope » reste à surveiller (node --check ne le voit pas) |
| SF-REL-0141 (.part partagé PID) | durcissement atomicité SF-REL-0130 | 865b891/9d4f986 | test de concurrence ×20 dans audio-utils.test.js |

Règle : avant de toucher un composant, chercher ici + dans le tableau ses anomalies passées et les tests de non-régression associés. Ne jamais écraser l'historique d'une anomalie réapparue — créer une nouvelle entrée référençant l'originale.

## Tableau de bord V2 (recalculé 15/11/2026)

| Statut | Nombre | Détail |
|---|---|---|
| CLOSED | 28 | 0141 + 0612-0619 + 0620-0630 + 0631-0635 + 0636-0638 |
| FIXED_PENDING_VALIDATION | 84 | cycles 1-5 historiques + 0639 |
| ACCEPTED | 20 | cycles 1-5 |
| INVESTIGATING | 1 | SF-REL-0611 crash AudioContext |
| OPEN / BLOCKED | 0 | — |
| **Total IDs définis** | **132** | IDs uniques ; trous de numerotation 0065-0099 et 0117-0119 (jamais attribues) |

### Doublons fonctionnels documentés (IDs distincts, même anomalie)

| Groupe | IDs | Problème commun | Traitement |
|---|---|---|---|
| backpressure PCM | SF-REL-0042, SF-REL-0137 | File IPC main→renderer non bornée | 0137 explicitement marqué doublon de 0042 — conservé pour traçabilité |
| storageRoot chemin arbitraire | SF-REL-0045, SF-REL-0129, SF-REL-0601 | storageRoot() accepte tout chemin absolu/UNC | Même mécanisme, même rationale d'acceptation — 3 IDs pour 1 anomalie |
| config:save stringify avant borne | SF-REL-0043, SF-REL-0608 | JSON.stringify précède le test 5 Mo | Même observation foundée deux fois (cycles 1 et 5) |

**Anomalies fonctionnellement distinctes : 114 IDs − 4 IDs doublons = 110.**
(0050 « ui:log sans rate-limit » et 0607 « throttle log() » se recoupent
partiellement mais traitent des mécanismes distincts : rate-limit IPC vs
coût disk I/O — comptés séparés.)

### Validation runtime CDP (15/11/2026, test/cdp-drive.js)

Driver CDP ajoute : exe lance avec `--remote-debugging-port=9222`,
Runtime.evaluate dans la page reelle. 7/7 checks PASS sur session
sa9fe21 (test-profile) :

- rec:save de bout en bout : `window.sf.saveRecording` -> fichier
  `recordings/cdp-runtime-*.webm` cree et persiste (8 octets verifies
  sur disque) — chemin IPC + writeRecording + mkdir async (SF-REL-0602)
  valides en RUNTIME. Couvre partiellement SF-REL-0058, SF-REL-0141,
  SF-REL-0130.
- Contrat d'erreur rec:save : data null -> rejet propre.
- play() voix reelle : 2 nodes (cable+mon), contexts 'running',
  stopAll -> voices=0. Cycle de vie voix valide en RUNTIME.
- AudioContexts cable(dc79ff)+mon(default) 'running' — pipeline audio
  actif, pertinent pour SF-REL-0611 (session stable).
- file:check absent -> detection OK ; yt:info URL invalide -> rejet
  « URL YouTube invalide ».

Impact : ces entrees gagnent une preuve RUNTIME, mais restent
FIXED_PENDING_VALIDATION — la revue independante du diff et le test
de non-regression cible restent requis pour CLOSED.

### Revues indépendantes des diffs (Quality Gate V2 §4)

| Commit | Contenu | Verdict |
|---|---|---|
| 54d77a6 | writeRecording partSeq | VALIDÉ — aucune anomalie ; résidus = ACCEPTED existants |
| ed5e042 | mkdir async/openDir/log/key/maxBuffer | VALIDÉ — 3 mkdir awaités dans handlers async ; borne log vérifiée au 1er appel |
| 9093732 | crashReporter après setPath | VALIDÉ — ordre conforme doc Electron, isPrimary correct |
| 3723fb2 | uiLog deviceId makeOutput | VALIDÉ — pas de TDZ, helper try/catch + preload |

Revues exécutées par subagent adverse en lecture seule (15/11/2026).
Note : la revue porte sur les commits, pas sur chaque anomalie prise
isolément — le lien anomalie↔commit reste à établir pour les autres
entrées FIXED_PENDING_VALIDATION.

### Conditions V2 non satisfaites — état par entrée

Pour les 89 FIXED_PENDING_VALIDATION, les conditions manquantes les plus
fréquentes : revue indépendante du diff (aucune documentée par anomalie),
validation runtime comportementale spécifique (la plupart n'ont que
STATIC+UNIT+smoke générique), test de non-régression dédié (absent pour
les anomalies main.js/C# antérieures à l'extraction lib/).

**Lecture honnête** : le registre prouve ~50 corrections de défauts réels
(STATIC+UNIT), mais ne prouve PAS leur comportement corrigé en runtime,
ni l'absence de régression matérielle. La quasi-totalité des FIXED_PENDING_
VALIDATION attend la validation `VALIDATION.md` ou un smoke ciblé par anomalie.
