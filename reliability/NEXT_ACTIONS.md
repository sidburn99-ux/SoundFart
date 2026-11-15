# NEXT_ACTIONS — point de reprise unique

> Dernière réconciliation : 15/11/2026 (fin session audit lifecycle OS).
> Pour reprendre : lire ce fichier, puis `git log --oneline -3` pour
> confirmer HEAD, `npm test` (39 attendus), `node --check` sur tout JS
> modifié depuis. Ne pas relancer les validations déjà listées comme
> faites dans TEST_MATRIX.md sans raison nouvelle.

## État réel (vérifié 15/11/2026)

- **Registre** : 145 IDs — 32 CLOSED · 90 FIXED_PENDING_VALIDATION ·
  22 ACCEPTED · 1 INVESTIGATING (SF-REL-0611).
- **Branche** : `hardening/v2`, HEAD ≈ `52b5b66`+docs, poussé sur GitHub SSH.
- **Build** : `dist\SoundFart.exe` à jour (npm run dist après chaque
  changement fonctionnel). Smoke endurance actif en `--test-profile`,
  aucun `.dmp` Crashpad à ce jour.
- **Couverture runtime** : voir TEST_MATRIX.md — YouTube complet,
  micro/MediaRecorder, boucle VB-CABLE, AudioTap, rec:save, media:cut
  tous validés avec niveaux non nuls mesurés.

## Prochaine action exacte (ordre chronologique)

1. **Revue indépendante du diff de résidus `52b5b66`** (6 résidus de la
   revue 0639/0650-0654) → CLOSED potentiel pour ce lot.
2. **Revue par lots des FPV historiques** (~83 IDs, cycles 1-5) :
   grouper par sous-système (lib/audio-utils, IPC main, renderer,
   main.js audio), un subagent adverse par lot, promouvoir les diffs
   validés. Commencer par les P0/P1 restants.
3. **SF-REL-0611** (crash renderer -1/143) : INVESTIGATING —
   vérifier `find $TEMP/SoundFart-test -name '*.dmp'` ; si un dump
   apparaît, l'analyser (module/processus fautif) ; sinon maintenir
   l'exposition (smoke tourne) et ne jamais le masquer.
4. **Validation matérielle** (VALIDATION.md, nécessite l'utilisateur) :
   Discord routing réel, sleep/wake réel, restauration micro réelle,
   endurance longue durée, débranchement périphérique à chaud.
5. Zones déjà auditées et couvertes — NE PAS relancer d'audit général
   sans nouveau signal : main.js (IPC, audio, process, config, callbacks,
   lifecycle OS), app.js (playback, import, raccourcis, enregistreur,
   modales, decode), preload.js, media-permission.js, tap-processor.js,
   scripts build. Restant jamais audité en profondeur : AudioEndpoint.cs
   et AudioTap.cs côté C# (hors cycles 1 partiels), lib/audio-utils.js
   dans son ensemble.

## Règles de reprise

- `AGENTS.md` fait foi : node --check / npm test / npm run dist /
  git push après chaque commit, statuts honnêtes.
- Ne jamais marquer CLOSED sans revue indépendante + test + runtime.
- `suivi.tsv` + `regen-suivi.ps1` à jour pour les changements
  significatifs.
- VB-CABLE jamais embarqué/installé ; isolation Electron intacte.
