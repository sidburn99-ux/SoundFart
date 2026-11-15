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
