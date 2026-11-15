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
