# NEXT_ACTIONS

1. Passe d'exploration indépendante : 3-4 subagents sur angles disjoints
   (main.js processus/fichiers ; src/app.js renderer ; C# interop ; scripts/tests).
2. Qualifier chaque découverte -> FINDINGS.md (SF-REL-XXXX).
3. Corriger par gravité, tests à chaque fois, commits séparés.
4. Compléter ARCHITECTURE.md et TEST_MATRIX.md au fil des passes.

## Apres cycle 1
1. Traiter SF-REL-0049 (ren.GetBuffer transitoire) et SF-REL-0052 (ffmpeg copy partiel).
2. Evaluer SF-REL-0042 (backpressure PCM) — pause stdout si seuil depasse.
3. npm run dist + smoke reel complet (fenetre, periphériques, lecture, enregistrement).
4. Passe adverse : relire mes propres diffs (auto-contradictoire).
5. Mettre à jour TEST_MATRIX.md (couverture réelle après ajouts).

## Reprise (fin session cycle 3)
1. `git log --oneline -5` verifier HEAD, `npm test` (32 attendus), `node --check main.js`.
2. Poursuivre passes : zones restantes = endurance longue, interactions
   multi-scenarios, revue des ACCEPTED (SF-REL-0046/0047/0053).
3. Validation manuelle VALIDATION.md requise avant toute conclusion
   fiabilite (enregistrement, routage, debranchement peripherique).
4. Bug connu : crash AudioContext exitCode -1/143 sporadique —
   surveiller, reproduire si possible, NE PAS masquer.
