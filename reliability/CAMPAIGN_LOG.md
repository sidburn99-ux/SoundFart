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
