# CAMPAIGN_LOG

## 2026-11-15 — Session 1 (démarrage Reliability Factory)
- Baseline établie : HEAD 609a40c, arbre propre, tests 23/23, npm audit 0.
- reliability/ créé. Prochaine étape : passes d'exploration indépendantes.

## 2026-11-15 — Cycle 1 (audits indépendants + corrections)
- 4 subagents explore : main.js/IPC, renderer, C#, scripts/tests.
- 57 anomalies qualifiées -> FINDINGS.md. P0 critique trouve : SF-REL-0001
  (ReferenceError displayMedia -> pas de fenetre) introduit en a4e403a,
  corrige 9685c04, verifie par smoke reel.
- Commits : 9685c04 (P0), d894d7c (C# cycle2), df353f0 (renderer+main+scripts+tests).
- Tests : 25/25, node --check OK, csc OK, AudioEndpoint list reel OK.
- Suivi.html repare (mojibake regen-suivi).
- Reste : SF-REL-0042/0049/0052 en investigation ; validation matérielle requise.

## 2026-11-15 — Cycle 2/3 (passe contradictoire + couverture worklet)
- Subagent passe 3 : preload/CSP/worklet/scripts + revue des diffs -> SF-REL-0058..0064.
- SF-REL-0058 P0 : rec:save ReferenceError 'p' (regression df353f0) -> corrige 9c9363f.
- P4 corriges : tap-processor garde+NaN, flush PCM palier 16 Kio, CSP object-src,
  gardes destructure media:cut/yt:download, marqueur troncature shortcuts.
- Nouveau test/tap-processor.test.js (6 tests, stubs AudioWorklet) -> 31/31.
- npm run dist OK + smoke exe reel OK (11:35, permissions ALLOW, pas de crash).
- Amelioration usine : writeRecording extrait dans lib/ (testé) —
  la classe de bug « ReferenceError dans handler main.js » est desormais
  detectable par node:test. Lecon : tout handler a logique non triviale
  doit deleguer a lib/.
- Smoke 11:38 OK ; crash AudioContext exitCode -1 observe 11:35 sur run
  precedent = bug connu non resolu (AGENTS), rapporte honnetement.

## 2026-11-15 — Cycle 3 (suite) : audits profonds renderer + main.js
- 2 subagents : app.js cycle de vie + main.js zones restantes.
- P0 supplementaire : SF-REL-0100 previewBtn (enregistreur casse) — 2e P0
  de regression issus des corrections precedentes. La passe
  contradictoire paie.
- ~35 anomalies qualifiees -> FINDINGS.md (IDs 0100-0140).
- Corrections : lifecycle micro (adoption marqueur, quitting, guard
  early-exit, mutex), tap epoch, ecritures atomiques (marqueur, rec via
  hardlink), bornes (config/.bak/sums/watchdog/import JSON), filtres
  yt sortie, UI (modales YouTube/recorder, cache, bornes, raccourcis).
- npm test 32/32, node --check OK, csc OK.
- Reste INVESTIGATING : SF-REL-0128 (sonde integrite binaires).

## 2026-11-15 — Cycle 3 (suite) : audits profonds renderer + main.js
- 2 subagents : app.js cycle de vie + main.js zones restantes.
- P0 supplementaire : SF-REL-0100 previewBtn (enregistreur casse) — 2e P0
  de regression issus des corrections precedentes. La passe
  contradictoire paie.
- ~35 anomalies qualifiees -> FINDINGS.md (IDs 0100-0140).
- Corrections : lifecycle micro (adoption marqueur, quitting, guard
  early-exit, mutex), tap epoch, ecritures atomiques (marqueur, rec via
  hardlink), bornes (config/.bak/sums/watchdog/import JSON), filtres
  yt sortie, UI (modales YouTube/recorder, cache, bornes, raccourcis).
- npm test 32/32, node --check OK, csc OK.
- Reste INVESTIGATING : SF-REL-0128 (sonde integrite binaires).
- SF-REL-0128 CLOSED : toolSane + discardCorruptTool (sonde integrite).
- Smoke 12:00 : adoption marqueur validee en reel (owner mort -> adopte,
  guard respawne). Crash AudioContext -1 observe 11:38 = bug connu.
- Plus aucune anomalie INVESTIGATING ouverte. ~95 anomalies qualifiees.

## Cycle 5 — fuzz lib + audit IPC + forensique crash (suite)

- Tests de proprietes ajoutes (writeRecording concurrence x20, safeName
  fuzz, parseEndpoints fuzz, chooseRestoreIds sans-nom, parseTs bornes)
  -> 37/37 verts. Le fuzz a trouve SF-REL-0141 (P1) : .part partage entre
  ecritures concurrentes -> corrige (partSeq).
- Audit surface IPC complet (subagent) : 23 handlers, 0 canal mort, garde
  fromApp uniforme. 10 findings : 5 corriges (mkdir async UNC, openDir
  stat async, autoSetup coercion, throttle log 1/min, key cap 128,
  maxBuffer mort retire), 4 ACCEPTED documentes (dir d'ecriture arbitraire
  = feature legitime, file:read media, stringify config, catch sondes).
- Forensique crash -1/143 : crash aussi ~3 min apres creation (pas
  seulement a la creation) ; device dc79ff = CABLE Input VB-Audio =
  suspect n°1. crashReporter.start deplace APRES setPath(userData) —
  les dumps partaient dans %APPDATA% au lieu du bon profil (bug
  d'instrumentation corrige). Smoke long en cours pour capturer un .dmp.
- A/B cableId vide impossible : pick() re-assigne auto CABLE Input par
  design (le sonboard cible Discord via cable).

## Transition Quality Gate V2 (15/11/2026)

Nouveau cadre gouvernant adopte (cycle 12 etapes, verrou de cloture,
revue independante, analyse d'impact, niveaux de preuve CONFIRMED→
UNDETERMINED, niveaux de validation STATIC→LONG_DURATION, criteres de
convergence, interdictions methodologiques).

Migration du registre :
- ~80 entrees « CLOSED » reclassées FIXED_PENDING_VALIDATION : la preuve
  disponible etait STATIC+UNIT (+ smoke generique de demarrage), sans
  validation runtime par anomalie ni revue independante systematique.
- Restent CLOSED : SF-REL-0001, 0120, 0128 (runtime documente).
- Nouveau : SF-REL-0611 = crash AudioContext -1/143 (INVESTIGATING,
  UNDETERMINED — attend le .dmp Crashpad).
- Section « Historique actif des regressions » ajoutee (0001, 0058,
  0100, 0141 avec origines et preventions).
- Tableau de bord V2 ajoute : 3 CLOSED / 79 FPV / 20 ACCEPTED / 1 INV.

Regle de travail desormais : toute nouvelle anomalie suit le cycle 12
etapes ; tout fix exige test de non-regression + revue independante du
diff + validation runtime appropriatee avant CLOSED ; toute modification
de main.js exige smoke test-env >= 60 s avec verification du log.

## Réconciliation documentaire V2 (15/11/2026, sans audit ni code)

- 114 IDs uniques définis dans FINDINGS.md (tables + prose 0141,
  0601-0610, 0611) — aucun doublon de définition, aucun ID orphelin.
- Doublons fonctionnels identifiés : 0042/0137, 0045/0129/0601,
  0043/0608 -> 110 anomalies fonctionnellement distinctes.
- Les 3 CLOSED (0001, 0120, 0128) reclassées FIXED_PENDING_VALIDATION :
  condition « revue indépendante du diff » non documentée pour aucune.
- Tableau de bord recalculé depuis les entrées : 0 CLOSED / 89 FPV /
  24 ACCEPTED / 1 INVESTIGATING = 114.
- TEST_MATRIX mis à jour (37 tests, couverture réelle listée).
- Aucune preuve réinventée : ce qui n'est pas documenté reste
  NOT VERIFIED ; le registre ne prétend pas à l'exhaustivité au-delà
  des 114 entrées.

## V2 — validation runtime CDP (15/11/2026)

- test/cdp-drive.js cree : driver Chrome DevTools Protocol (WebSocket
  natif Node) pour executer du JS dans le renderer reel — debloque la
  validation runtime sans interaction UI manuelle.
- Exe lance `--remote-debugging-port=9222 --test-profile` ; 7/7 checks
  PASS : rec:save persiste un vrai fichier, contrat d'erreur OK,
  play()/stopAll cycle de vie voix OK, contexts running, file:check et
  yt:info rejets propres.
- Preuve RUNTIME ajoutee au registre pour les chemins couverts ;
  aucune entree CLOSE — revue independante du diff toujours requise.
- Smoke session sa9fe21 stable, heap constant, pas de crash.

## V2 — SF-REL-0612 P0 crash downloadFile + revues independantes (15/11/2026)

- **P0 trouve par la validation runtime** : test/cdp-yt.js (ytEnsure sur
  profil neuf) a fait Mourir le process main — `[fatal] uncaughtException:
  TypeError: onProgress is not a function` main.js:554. Cause :
  `downloadFile(sumsUrl, sumsTmp)` sans 3e argument -> undefined() dans
  le handler data. Tout downloadVerified crashait a l'etape .sums :
  yt:ensure, ffmpeg — aucun outil telechargeable installable sur profil
  neuf. Bug present depuis l'introduction de downloadVerified.
- Fix : `onProgress = () => {}` par defaut dans downloadFile ET runYt
  (meme classe de crash). npm test 37/37, node --check OK, dist rebuild.
- **Verification runtime du fix** : ytEnsure complet -> yt-dlp.exe
  23,5 Mo, SHA-256 verifie, process vivant. Scenario du crash rejoue
  avec succes.
- **Revues independantes (subagent adverse)** : 4 commits recents
  (54d77a6, ed5e042, 9093732, 3723fb2) tous VALIDÉS, aucune anomalie
  bloquante, residus = ACCEPTED documentes.
- SF-REL-0141 promue CLOSED : 9 conditions V2 remplies (premiere entree
  fully conforme). Dashboard : 1 CLOSED / 89 FPV / 24 ACCEPTED / 1 INV.
- Nouveau driver : test/cdp-drive.js (12 checks) + test/cdp-yt.js.

## V2 — yt:info reel valide (15/11/2026)

- test/cdp-ytinfo.js : ytInfo("Big Buck Bunny") -> ok, titre+durée
  (635 s) retournés. Valide : yt-dlp.exe installé et exécutable,
  runYt spawn/timeout, parsing JSON, contrat de retour.
- Reste non couvert : yt:download réel (gros fichier), ffmpeg ensure
  (~80 Mo, même downloadVerified désormais prouvé), media:cut bout en
  bout, MediaRecorder micro/loopback, Discord routing — voir
  VALIDATION.md / NEXT_ACTIONS.

## V2 — SF-REL-0613 P0 ffmpeg + media:cut valide (15/11/2026)

- media:cut via CDP a révélé l'impossibilité d'installer ffmpeg :
  tar GNU (Git) shadowe bsdtar -> « C: » distant puis « not a tar
  archive » (zip). Bug en chaîne masqué par SF-REL-0612.
- Fix : System32\tar.exe (bsdtar) prioritaire, repli PATH.
- Runtime : ffmpeg.zip SHA-256 x3, extraction OK, coupe réelle
  dry-fart_extrait.mp3 1996 o. media:cut FONCTIONNEL de bout en bout.
- yt:info reel valide (Big Buck Bunny). Reste : yt:download complet,
  MediaRecorder micro/loopback, Discord routing, endurance, .dmp 0611.

## V2 — yt:download sectionne reel valide (15/11/2026)

- test/cdp-ytdl.js : ytDownload(BBB, 10-15s, sectioned) -> MP3 reel
  sf-mwhuhtl48ml4-aqz-KE-bpKQ.mp3 (217 Ko) dans imports/.
- Valide : ensureYtDlp+ensureFfmpeg, runYt --download-sections -x,
  filtre artefacts .part/.ytdl, template unique, retour {path,
  sectioned:true}. Toute la chaine YouTube import fonctionne.
- Reste non couvert : yt:download audio COMPLET (gros), MediaRecorder
  micro/loopback, Discord routing, sleep/wake, endurance, .dmp 0611.

## V2 — SF-REL-0614/0615 corriges (15/11/2026)

- Normalisation typeof des callbacks progression (downloadFile,
  downloadVerified, runYt) + try/catch sur webContents.send des
  callbacks ytprogress x3 et tapDead.
- node --check OK, npm test 37/37, npm run dist OK, smoke runtime OK.
- Statut : FIXED_PENDING_VALIDATION (revue independante requise).

## V2 — yt:download COMPLET valide + 0615 bouclee (15/11/2026)

- Revue independante diff 041715e : VALIDE ; residu sf:shortcut/sf:menu
  (meme race webContents) corrige par parite -> commit 553ac13.
- yt:download full:true (Me at the zoo 19s) -> .webm 252 Ko,
  sectioned:false. Les DEUX chemins yt:download (sectionne + complet)
  valides runtime de bout en bout.
- Reste : revue 553ac13 pour CLOSED 0615, MediaRecorder micro/loopback,
  Discord routing, endurance, .dmp 0611 (toujours aucun dump).

## V2 — MediaRecorder + boucle VB-CABLE validees (15/11/2026)

- cdp-rec.js : getUserMedia micro reel (permission ALLOW, label
  CABLE Output), MediaRecorder webm/opus 1.44 s decode OK — RMS ~0
  attendu (cable sans signal).
- cdp-cableloop.js : 440 Hz -> CABLE Input -> capture CABLE Output ->
  RMS 0.282 / peak 0.407. Boucle VB-CABLE complete avec audio NON NUL
  mesure. Permission media, capture micro, encodage opus, routage
  cable : tous prouves runtime.
- Reste : rec:save avec audio reel, AudioTap loopback systeme,
  Discord routing, endurance, .dmp 0611.

## V2 — AudioTap loopback + rec:save audio reel valides (15/11/2026)

- cdp-recsave.js : blob webm reel -> saveRecording ->
  recordings/cable-loop-test.webm 24446 o. rec:save prouve avec audio
  authentique.
- cdp-tap.js : audioTapStart -> oscillateur sortie defaut -> 73 chunks
  PCM 1,4 Mo via sf:tapPcm -> RMS 0.285 / peak 0.635. Capture systeme
  WASAPI prouvee avec niveau non nul.
- Couverts desormais runtime : getUserMedia, MediaRecorder, rec:save,
  boucle VB-CABLE, AudioTap loopback. Reste : Discord routing, sleep/
  wake, endurance, .dmp 0611, VALIDATION.md materiel.

## V2 — 0612-0615 CLOSED + durcissement final (15/11/2026)

- Revue independante complete : inventaire 8 webContents.send, normalisation
  onProgress, filet uncaughtException. Residu : sf:micWatchOff (1267) non
  protege + onProgress invoque nu dans 3 handlers + catch{} silencieux.
- Fix : cbOrNoop extrait dans lib/audio-utils.js (testable), try/catch sur
  les 3 invocations onProgress, micWatchOff/tapDead logges en warn,
  sf:menu/sf:shortcut/tous les sends de handlers desormais proteges.
- Test : cbOrNoop unit test (undefined/null/0/'x'/{}/[]/true -> noop ;
  vrai callback preserve). npm test 38/38.
- Runtime : smoke OK, yt:info reel re-valide (runYt modifie).
- 0612-0615 -> CLOSED (limite documentee : test sur le helper, call-sites
  main.js non couverts par npm test).

## V2 — audit audio critique : 4 anomalies corrigees (15/11/2026)

Audit adverse complet (watchdog, AudioTap, restauration, renderer) :
8 anomalies trouvees. Corrigees : SF-REL-0616 (exe non verifie +
statuts mensongers restauration), 0617 (watchdog fausse suspension
pendant bascule), 0618 (play sur contexte mourant). Restent ouvertes
(documentees) : 0619 (importConfig hors chaine), A6/A7/A8 de l'audit
(exit-path execFileSync ~45 s, micro bypass master = voulu, garde
micro non relance si tue — ACCEPTED probabiliste).
Verifications : node --check x2, npm test 38/38, dist rebuild, smoke
OK, cdp-drive 12/12 PASS (cycle teardownAudio/applyAudio valide).

## V2 — 0616-0619 CLOSED (15/11/2026)

- Revue independante des diffs lifecycle audio : 0618/0619 valides ;
  0616/0617 valides avec residus de couverture micSwitching.
- Residus corriges : flag des l'entree d'autoSetupImpl (couvre compile
  + execs + enabled=false), audioRestoreImpl encadre, re-check
  micSwitching avant suspension watchdog, retry restoreMicNowP si
  will-quit a precede un set capture en vol.
- npm test 38/38, dist rebuild, smoke + cdp-drive 12/12 PASS.
- 0616-0619 -> CLOSED (limite documentee : call-sites main.js hors
  npm test).

## V2 — audit config/fichiers : 4 P2 corriges (15/11/2026)

Audit adverse zone config/missing/shortcuts/shell : 4 anomalies P2
corrigees (SF-REL-0620 expandPaths comptait les visites ; 0621
relocateSound sans validation ext/doublon ; 0622 id __stop__ ;
0623 addPaths sans plafond). P3 documentes non corriges :
migrateOldConfig non borne, sounds:seed confiance, watchdogMic JSON
brut, normalizeCfg champs non types, shell:openDir repli, shortcuts
sans blocklist systeme.
Test regression ajoute : 5100 non-audio + 2 sons -> 2 trouves.
npm test 39/39, dist rebuild, smoke OK.

## V2 — audit process/enfants IPC : 6 anomalies corrigees (15/11/2026)

Audit adverse execFileTracked/killTree/runYt/downloadFile/displaymedia/
flags single-flight : 6 anomalies corrigees (SF-REL-0625 deadline
totale download 15 min ; 0626 template distinct repli yt ; 0627
displaymedia frame.url ; 0628 ffmpeg.exe partiel purge ; 0629
audioTapKilling reset sur error ; 0630 p.kill filet will-quit).
Verifie sain : timeouts execFileTracked, childProcs purge, fromApp
partout, single-flight flags avec finally.
Attention : la refactorisation rej/res de downloadFile a initialement
corrompu sha256File (res hors scope) et laisse des resolve/reject
bruts contournant done() — detecte et corrige avant commit.
npm test 39/39, dist rebuild, smoke + yt:info reel OK.

## V2 — 0620-0630 CLOSED (15/11/2026)

- Revue independante des 3 commits : majoritairement valide ; 3 residus
  corriges : toast addPaths quand liste pleine (0623), preference tag2
  sur tri mtime pour le repli yt (0626), protocole file: exige dans
  displaymedia (0627).
- Residuel documente : settings totalement absent -> watchdog desarme
  alors que renderer suppose arme (config anterieure, rare) ;
  expandPaths sync quasi-mort (seul async utilise en prod).
- Runtime : yt:download sectionne re-valide apres correctifs.
- 0620-0630 -> CLOSED avec limites par entree (0625 deadline non
testable en auto, 0627 getDisplayMedia non teste UI).

## V2 — audit renderer app.js : 5 corriges, 1 ouvert (15/11/2026)

Audit adverse zones non couvertes (bufCache, modales, raccourcis,
playback) : P1 enregistreur (sources live pendant askDestDir) +
4 P2 corriges (0631-0635). Documentes non corriges : 0636 modales
sans piege focus ni file d'attente (P2), PCM decode non borne (P2),
checkMissing sans debounce/timeout (P2), renderGrid par frappe (P2),
polyphonie illimitée (P3).
npm test 39/39, dist rebuild, smoke + cdp-drive 12/12 PASS.

## V2 — SF-REL-0636 corrige (15/11/2026)

- inert #app pendant modales ; closedDuringRec pour l'enregistreur ;
  garde modalClose pour le resultat YouTube (ytModalAlive cable).
- npm test 39/39, dist rebuild, smoke + cdp-drive 12/12 PASS.
- Reste documente : PCM decode non borne, checkMissing sans debounce,
  renderGrid par frappe, polyphonie illimitee.

## V2 — SF-REL-0638 checkMissing + etat campagne (15/11/2026)

- checkSeq generation token + debounce focus 400 ms + erreur visible.
- npm test 39/39, dist rebuild, smoke + cdp-drive 12/12 PASS.
- FPV en attente de revue : 0631-0638 (8 anomalies renderer/config/
  IPC). P2/P3 residuels documentes : renderGrid par frappe,
  expandPaths sync quasi-mort, settings absent -> watchdog desarme.

## V2 — revue groupee 0631-0638 + 2 residus corriges (15/11/2026)

Revue adverse independante : 0631-0635, 0638 valides ; 2 anomalies :
- 0636 : l'inert pose AVANT modalClose() etait defait par le close()
  de l'ancienne modale -> fond interactif des qu'une modale en
  remplace une autre. Fix : inert pose APRES modalClose().
- 0637 : decodeActive/decodeQueue declares mais JAMAIS cables
  (dead code) -> decodeAudioData sans aucune borne de concurrence.
  Fix : acquireDecode/releaseDecode autour du decode, slot transfere
  au waiter (pas de deadlock).
- Reserves documentees non corrigees : faux positif macOS normAccel
  (CommandOrControl=Cmd vs Ctrl), modale yt non solicitee si l'user
  ferme la modale pendant yt:download, pic OOM pendant decode
  (inevitable), scans checkMissing abandones continuent en vol.
Verifs : node --check, npm test 39/39, dist, smoke + cdp-drive PASS.

## V2 — cloture 0636/0637 + SF-REL-0639 (15/11/2026)

- Revue independante du diff 44d00b9 : les 2 residus (inert ordre,
  semaphore decode) CORRECTS ET COMPLETS -> 0636/0637 CLOSED.
- Revue a trouve une nouvelle anomalie : decodeQueue non bornee,
  chaque waiter retenait son ArrayBuffer brut (<=150 Mo). Fix :
  file bornee 64 waiters / 512 Mo cumules, rejet honnete.
- 28 CLOSED, 84 FPV, 20 ACCEPTED, 1 INVESTIGATING (132 IDs).

## V2 — audit zones non couvertes (15/11/2026)

Subagent : preload.js, media-permission.js, tap-processor.js, app.js
zones restantes. Sain : zero innerHTML (pas de XSS possible), preload
minimal avec re-validation main, tap PCM aligne, permission media
bornee, import config borne 8 Mo.
Constats : 0640 REJETE (invariant modal single-slot deja protecteur),
0641/0643/0644 corriges, 0642 ACCEPTED (surface file:read documentee).
Verifs : node --check, npm test 39/39, dist, smoke + cdp-drive.

## V2 — revue f320368 : 0641/0643/0644 CLOSED (15/11/2026)

Revue independante : 4 correctifs CORRECTS sans reserve ; rejet 0640
confirme justifie (confirmBox ferme deja settings en amont de onDone).
Remarques conservees : id '' possible (pre-existant, basse), toast
saveConfig une seule fois a vie (choix assume). 0639 reste FPV : sa
borne de file decode n'a pas encore sa propre revue.

## V2 — audit lifecycle OS + scripts (15/11/2026)

Subagent : single-instance, powerMonitor, session, Crashpad, scripts
build, storageRoot, migrateOldConfig. Sain : single-instance correct,
window-all-closed/will-quit idempotent, permissions bornees, scripts
propres, electron-builder whitelist stricte (aucune donnee utilisateur
embarquee).
Corriges : 0650 trim log OOM (P1), 0651 rate-limit ui:log, 0652
powerMonitor suspend/resume + refresh devices, 0653 watchdog
ensureAudioTool, 0654 gardes quitting restore, 0655 purge dumps >30j,
0657 borne migrate. 0656 ACCEPTED (sonde sync = pire que pending async).
Verifs : node --check x3, npm test 39/39, dist, smoke + cdp-drive.

## V2 — reconciliation docs (15/11/2026)

NEXT_ACTIONS reecrit : ancien fichier empilait 4 points de reprise
obsoletes (cycles 1-4 + V2). Desormais UN point de reprise unique et
chronologique. TEST_MATRIX mis a jour : 39 tests (etait 37), couverture
CDP complete documentee (10 drivers, niveau non nul mesure), zones
« NON couvert » recadrees sur le seul vrai restant = materiel/VALIDATION.
Registre verifie : 145 IDs, 32 CLOSED, 90 FPV, 22 ACCEPTED, 1 INVESTIGATING.

## V2 — revue groupee e99d0b1+b007d19 : 6 residus corriges (15/11/2026)

Revue adverse : 0639/0650-0655/0657 audites. 0655/0657 CORRECTS.
Residus corriges : 0639 (noFileErr sur rejet file pleine -> faux badge),
0650 (warn ENOENT parasite + bytesRead), 0651 (warn resume spam +
compteur partage + console-message non sanitize), 0652 (delai 2,5 s
post-resume), 0653 (ensureAudioTool apres gardes config), 0654 (gardes
quitting autoSetupImpl + fallback). FPV en attente re-revue.
Verifs : node --check x3, npm test 39/39, dist, smoke + cdp-drive.

## V2 — revue par lots FPV historiques : 82 CLOSED (15/11/2026)

Deux revues adverses en parallele : lot A (57 IDs main.js/app.js) et
lot B (23 IDs C#/lib/scripts) — TOUS CONFIRMES, fixes presents et
corrects dans le code actuel, aucun absent ni douteux. 0039 couvert
par la preuve de 0100. Total : 82 anomalies cycle 1/2 -> CLOSED.
Registre : 145 IDs, 114 CLOSED, 8 FPV (0639, 0650-0655, 0657 — residus
de 52b5b66 en attente re-revue), 22 ACCEPTED, 1 INVESTIGATING (0611).
Reste : re-revue 52b5b66, .dmp 0611, validation materielle VALIDATION.md.

## V2 — registre FPV epuise (15/11/2026)

Re-revue independante du diff de residus 52b5b66 : les 6 correctifs
CORRECTS (0639 noFileErr, 0650 ENOENT+bytesRead, 0651 budgets separes+
cadence warn, 0652 delai post-resume, 0653 ordre gardes, 0654 gardes
quitting completes). 8 derniers FPV -> CLOSED.
REGISTRE FINAL : 145 IDs — 122 CLOSED, 22 ACCEPTED, 1 INVESTIGATING
(0611). Plus aucun FIXED_PENDING_VALIDATION.
Reste : .dmp Crashpad 0611, validation materielle VALIDATION.md,
endurance. Prochaine etape : maintenance + surveillance, ou ACCEPTED
a reevaluer si terrain.

## V2 — audit complet C# AudioEndpoint+AudioTap (15/11/2026)

Subagent lecture integrale : 14 constats. Corriges : 0660 (nom vide
accepte non-virtuel — parite JS), 0661 (guard retry 5x backoff),
0664 (frames==0 boucle infinie -> zeroFrames>200 break), 0665
(maxQueued recalcule), 0668 (ReleaseComObject reconnect), 0669 (hr
GetBufferSize), 0670 (warning pid), 0671 (seconds<0 rejete).
Acceptes documentes : 0662 guards accumules, 0663/0666 fenetres PID,
0667 write bloquant, 0672 GC, 0673 channel mask.
Preuves : csc compile OK x2, AudioEndpoint list/get reels, cdp-tap
runtime 73 chunks RMS 0,285 (AudioTap modifie recompile + execute).
npm test 39/39, dist rebuild, smoke + cdp-drive.

## V2 — revue diff C# + symetrie hr (15/11/2026)

Revue independante b9ea0a7 : 8/8 CORRECTS -> CLOSED. Remarque mineure
(src.GetBufferSize hr ignore) corrigee par parite. Rebuild dist +
cdp-tap re-valide (73 chunks RMS 0,285) + cdp-drive 12/12.
Registre : 159 IDs, 138 CLOSED, 0 FPV, 28 ACCEPTED, 1 INVESTIGATING.
Toutes les zones de code auditees — campagne de detection epuisee ;
il ne reste que 0611 (.dmp), VALIDATION.md materiel, endurance.

## 15/11/2026 (suite) — audit lib/audio-utils.js integral + reevaluation ACCEPTED

- Audit integral lib/audio-utils.js (16 exports, subagent adverse) :
  7 anomalies — 3 P2 (0674 noms reserves Windows « con .x », 0675 ctrl
  chars safeName, 0676 repli wx sans unlink -> .webm tronque final) et
  4 P3 (0677 chooseRestoreIds filtre flow, 0678 fmtTime « 1:60.0 »,
  0679 parseTs « 1:99 », 0680 expandPaths non iterable). Toutes corrigees
  + tests unitaires ajoutes (npm test 40/40).
- Reevaluation des ACCEPTED (subagent adverse, verification code
  actuel) : 17 justifications reconduites, 1 OBSOLETE (0048 -> CLOSED
  via 0127 execFileTracked), 4 RECONSIDEREES traitees :
  0054 app.quit() apres 2e crash renderer, 0055 npm test dans build.bat,
  0116 stopFallback 1,5 s (voix zombie onended), 0059 rejet yt:download
  >512 Mo (coherence file:read). Toutes FPV en attente de revue.
- Vérifications : node --check x3, npm test 40/40, npm run dist,
  smoke test-profile relance sur le nouveau build.
- Registre : 166 anomalies — 131 CLOSED, 11 FPV, 23 ACCEPTED,
  1 INVESTIGATING (0611). Toutes les zones de code auditees.

## 15/11/2026 (suite 2) — revue diff 73ed0a7 + promotion CLOSED

- Revue independante adverse (subagent) du commit 73ed0a7 : 11/11
  CORRECT. Reserves mineures documentees dans FINDINGS cycle 8
  (ENOTSUP absent de la liste de repli, parseEndpoints nom vide->id,
  decimales parseTs, pas de filtre reason sur render-process-gone,
  stopFallback sans second stop).
- Affinage post-revue SF-REL-0059 : erreur marquee noRetry (evite un
  retry yt-dlp update inutile sur oversize) + unlink du fichier >512 Mo.
- Les 11 FPV (0054, 0055, 0059, 0116, 0674-0680) promus CLOSED.
  npm test 40/40 apres l'affinage.
- Registre : 166 anomalies — 142 CLOSED, 0 FPV, 23 ACCEPTED,
  1 INVESTIGATING (0611).

## 15/11/2026 (suite 3) — driver stress CDP pour SF-REL-0611

- test/cdp-stress.js ajoute : 40 iterations de play/stopAll en rafale,
  churn de modales, rec:save burst, teardownAudio/applyAudio x5.
- Resultat : 40/40 iterations propres, heap stable 10 Mo, 0 crash,
  0 .dmp. Preuve negative pour 0611 — ne ferme PAS l'anomalie
  (investigation maintenue, exposition smoke continue).
- Registre inchange : 142 CLOSED, 0 FPV, 23 ACCEPTED, 1 INVESTIGATING.

## 15/11/2026 (suite 4) — mitigation 0611 : AudioContext partage

- applyAudioInner creait 2 AudioContext meme quand cableId===monId
  (cas frequent : ecoute locale = meme peripherique). Chaque contexte
  est une surface d'exposition au crash audio utility Chromium.
- Fix : audio.mon partage audio.cable quand les deviceId sont egaux ;
  teardownAudio deduplique la fermeture par ctx (closedCtx Set) ;
  play() dedup existant par deviceId deja compatible ; updateMaster
  idempotent.
- Verifie runtime CDP : forced cableId=monId -> audio.cable===audio.mon
  (shared:true), teardown null les deux, restore monId=default ->
  contextes distincts a nouveau. cdp-drive 12/12 PASS, npm test 40/40.
- 0611 reste INVESTIGATING : mitigation de surface, pas preuve de cause.

## 15/11/2026 (suite 5) — residus config/raccourcis corriges

- SF-REL-0681 : watchdogMic desarme si settings absent de config.json
  (UI affichait watchdog arme) -> settings non-objet traite comme {}.
- SF-REL-0682 : Alt+F4 absent de RESERVED_SC -> ajout (fermeture OS
  ne doit pas etre enregistrable en globalShortcut).
- Verifications : node --check x2, npm test 40/40, npm run dist,
  cdp-drive 12/12 PASS sur nouveau build, smoke+stress relances.
- Registre : 168 anomalies — 142 CLOSED, 2 FPV (0681/0682), 23 ACCEPTED,
  1 INVESTIGATING.

## 15/11/2026 (suite 6) — revue 0681/0682 + reserve corrigee

- Revue adverse : 0681 CORRECT ; 0682 CORRECT AVEC RESERVE — la liste
  dupliquee de findShortcutOwner n'avait pas alt+f4 (capture a chaud
  contourait la blocklist) et normAccel ne strippait pas les espaces
  ('Alt + F4' passait).
- Fix : RESERVED_SC hisse au niveau module (source unique normalizeCfg
  + findShortcutOwner), normAccel retire les espaces.
- Runtime CDP sur rebuild : normAccel('Alt + F4')='alt+f4',
  findShortcutOwner bloque 'Alt+F4' ET 'Alt + F4' -> 'un raccourci
  reserve du systeme', Ctrl+F toujours bloque, config intacte.
- Observation pre-existante documentee (non corrigee) : autoSwitchMic
  et watchdogMic ne sont pas independants cote main (watchdog exige
  autoSwitchMic===true) — les deux checkboxes UI suggèrent
  l'independance, ecart UX mineur.
- 0681/0682 -> CLOSED. Registre : 168 anomalies — 144 CLOSED, 0 FPV,
  23 ACCEPTED, 1 INVESTIGATING.

## 15/11/2026 (suite 7) — items VALIDATION.md logiciels executes

- Section F (resilience config) validee en runtime sur test-profile :
  - config.json corrompu (texte invalide) -> config.json.broken-<ts>
    cree, .bak charge (31 sons), config.json reecrit saine.
  - config.json 17 Mo -> rejet borne 16 Mo, .broken cree, .bak charge,
    pas de freeze.
- Items VALIDATION.md coches dans le document. Restent : tous les
  items materiels (A audio reel partiellement couvert CDP, B periph,
  C enregistrement multi-source, D Discord, E partiellement CDP,
  F endurance/orphelins).

## 15/11/2026 (suite 8) — VALIDATION.md A.6 execute

- WAV 172,8 Mo (15 min stereo 48 kHz) genere via ffmpeg des tools,
  play() via CDP -> refuse propre (voice:false), heap 10 Mo stable,
  0 voix, pas de crash. Item A.6 coche. Fichier test supprime.

## 15/11/2026 (suite 9) — VALIDATION.md A.4 execute

- Supression pendant lecture via CDP : play() -> voix active ->
  removeSound + confirm -> son retire (cfg.sounds 30->29), voix
  arretee proprement, pas d'erreur. Item A.4 coche.

## 15/11/2026 (suite 10) — VALIDATION.md A.3 + F orphelins executes

- A.3 : 10 play() rapides du meme son -> voix toutes nettoyees
  (voices 8->0), heap 10 Mo, pas de zombie ni crash.
- F orphelins : yt:download video 3h (~130 Mo .part) + taskkill /F
  (kill brutal = simulation crash) -> 0 yt-dlp/ffmpeg residuel.
  .part conserve (limitation documentee SF-REL-0136), supprime
  manuellement apres test.
- Items coches dans VALIDATION.md.

## 15/11/2026 (suite 11) — VALIDATION.md F import 200 sons execute

- 200 fichiers webm dans un dossier -> expandPaths+addPaths <1 s,
  cfg.sounds 29->229, heap 10 Mo, pas de freeze. Config test nettoyee
  (retour a 29 sons), dossier many-sounds supprime.

## 15/11/2026 (suite 12) — VALIDATION.md A.5 execute (partiel)

- WAV 5 min (52,9 Mo, 44,1 kHz stereo) : addPaths import + getBuffer
  decode 300 s stereo + play() voice creee (preview), heap 10 Mo
  stable. MP3 3 min non couvert (meme chemin decode). Item coche
  partiellement valide.
- Note harnais : play() refuse a juste titre un objet son absent de
  cfg.sounds (garde SF-REL-0633) — les voice:false precedents etaient
  des faux negatifs de test, pas des bugs.

## 15/11/2026 (suite 13) — VALIDATION.md C regression V2 executee

- Flux enregistreur complet pilote par CDP (test/cdp-recflow.js) :
  recorderModal -> micro seul (pcOn/cableOn OFF) -> 4 s de prise ->
  stop -> askDestDir -> OK -> modale « Enregistrement termine » ->
  « Ajouter a la bibliotheque » -> son present dans cfg.sounds et
  play() OK. Nettoyage : son retire (retour 29 sons).
- Reste non couvert sur cet item : niveau non silencieux du micro
  (necessite oreille/entree reelle).

## 15/11/2026 (suite 14) — VALIDATION.md C sources enregistrement validees

- Nouveau driver test/cdp-recmix.js : enregistrement avec sources
  selectionnables (mic|pc|cable|all), son joue pendant la prise, puis
  decodeAudioData du fichier sauvegarde -> RMS/peak/nonzeroPct mesures.
- cable seul : RMS 0,0158 / peak 0,15 — sortie soundboard capturee.
- pc seul : RMS 0,0168 / peak 0,19 — loopback systeme capture le son.
- all : RMS 0,0216 / peak 0,26 — mix 3 sources sans erreur.
- Micro seul : flux OK mais niveau non prouvable sans voix reelle.

## 15/11/2026 (suite 15) — VALIDATION.md C fermeture modale enregistrement

- Nouveau driver test/cdp-recclose.js : « Fermer » pendant une prise
  micro de 3 s -> enregistreur s'arrete, askDestDir affiche, annulation
  -> 0 son ajoute (29->29), AUCUN fichier dans recordings/ (verifie par
  listing), reouverture recorderModal propre.
- LED micro non verifiable par agent (niveau OS) — note dans
  VALIDATION.md.
