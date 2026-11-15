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
