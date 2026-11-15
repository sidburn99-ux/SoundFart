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

## Reprise (fin cycle 4)
1. `git log --oneline -3`, `npm test` (32 attendus), HEAD=4375793.
2. Aucune anomalie INVESTIGATING ouverte ; reste ACCEPTED documentes
   (SF-REL-0111, 0116, 0126, 0129, 0136, 0137, 0139 + anciens).investigation possible : SF-REL-0111 (invalidation cache par mtime via
   IPC stat) — benefit faible, couteux.
3. PRIORITE : validation manuelle VALIDATION.md — l'enregistreur et le
   flux YouTube ont ete heavily modifies (modales, pickDir, pcConnected,
   toast erreurs) et demandent un test UI reel.
4. Bug connu : crash AudioContext -1/143 sporadique — 2 occurrences
   smoke (11:18, 11:35, 11:38). Enquete forensique si possible.
- [ ] Analyser le prochain .dmp Crashpad (userData/Crashpad/reports) du
      crash -1/143 : identifier le module/processus fautif (renderer audio
      vs driver VB-CABLE). Smoke long en cours en test-profile.
