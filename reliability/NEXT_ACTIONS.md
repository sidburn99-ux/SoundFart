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

## Priorites Quality Gate V2

- [ ] Capturer et analyser le .dmp Crashpad du crash SF-REL-0611
      (userData/Crashpad/reverses) — conditionne la suite de l'enquete.
- [ ] Validation runtime par anomalie : prioriser les FIXED_PENDING_
      VALIDATION touchant des chemins critiques (rec:save/writeRecording,
      lifecycle micro, yt:download, media:cut) via smoke cible ou
      VALIDATION.md.
- [ ] Revue independante des diffs des corrections les plus risquees
      (atomicite, lifecycle, IPC) — formaliser en entry FINDINGS.
- [ ] Validation materielle reelle (VALIDATION.md) : enregistreur,
      YouTube, Discord/VB-CABLE, restoration micro, sleep/wake.

## État V2 après réconciliation (15/11/2026)

- **0 anomalie CLOSED** — toutes les corrections attendent au minimum la
  revue indépendante du diff + validation runtime ciblée.
- 89 FIXED_PENDING_VALIDATION : priorité aux chemins critiques
  (writeRecording/rec:save, lifecycle micro, yt:download, media:cut,
  tapStart/tapStop) — smoke ciblé par anomalie ou VALIDATION.md.
- SF-REL-0611 (crash AudioContext) : INVESTIGATING, attend .dmp Crashpad.

- [ ] ffmpeg ensure + media:cut bout en bout via CDP (telechargement
      ~80 Mo, validerait le 2e usage de downloadVerified).
- [ ] yt:download réel (import YouTube complet) — nécessite réseau
      et disque ; valider progression/annulation/erreur.

## Point de reprise (15/11/2026, fin session V2)

Fait ce cycle : SF-REL-0612 (P0 onProgress crash main) + SF-REL-0613
(P0 ffmpeg tar) corrigés et validés runtime via CDP ; yt:info réel OK ;
media:cut complet OK ; SF-REL-0141 CLOSED ; 4 diffs revus (validés).

Prochaine action exacte :
1. yt:download réel via CDP (gros fichier, valider progression/erreur)
   — test/cdp-yt.js pattern, URL Big Buck Bunny déjà prouvée lisible.
2. Revue indépendante du diff SF-REL-0612+0613 (2 lignes + bloc tar)
   pour évaluer leur passage CLOSED.
3. .dmp Crashpad SF-REL-0611 si le smoke tourne encore.
4. MediaRecorder micro/loopback + Discord routing : validation matérielle
   (VALIDATION.md) — nécessite intervention ou scénario réel.
