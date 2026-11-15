# NEXT_ACTIONS — point de reprise unique

> Dernière réconciliation : 15/11/2026 (fin session audit lifecycle OS).
> Pour reprendre : lire ce fichier, puis `git log --oneline -3` pour
> confirmer HEAD, `npm test` (39 attendus), `node --check` sur tout JS
> modifié depuis. Ne pas relancer les validations déjà listées comme
> faites dans TEST_MATRIX.md sans raison nouvelle.

## État réel (vérifié 15/11/2026)

- **Registre** : 145 IDs — **122 CLOSED** · **0 FPV** · 22 ACCEPTED ·
  1 INVESTIGATING (SF-REL-0611). Tous les FIXED_PENDING_VALIDATION
  sont résolus ; il ne reste que des ACCEPTED documentés et le crash
  renderer en enquête.
- **Branche** : `hardening/v2`, HEAD ≈ `52b5b66`+docs, poussé sur GitHub SSH.
- **Build** : `dist\SoundFart.exe` à jour (npm run dist après chaque
  changement fonctionnel). Smoke endurance actif en `--test-profile`,
  aucun `.dmp` Crashpad à ce jour.
- **Couverture runtime** : voir TEST_MATRIX.md — YouTube complet,
  micro/MediaRecorder, boucle VB-CABLE, AudioTap, rec:save, media:cut
  tous validés avec niveaux non nuls mesurés.

## Prochaine action exacte (ordre chronologique)

1. ~~Revue du diff de résidus `52b5b66`~~ — **FAIT** : 6/6 CORRECTS,
   8 derniers FPV → CLOSED. Registre épuisé côté FPV.
2. ~~Revue par lots des FPV historiques~~ — **FAIT** (82 IDs → CLOSED,
   revues adverses lots A/B, commit bfd1b70).
3. **SF-REL-0611** (crash renderer -1/143) : INVESTIGATING —
   vérifier `find $TEMP/SoundFart-test -name '*.dmp'` ; si un dump
   apparaît, l'analyser (module/processus fautif) ; sinon maintenir
   l'exposition (smoke tourne) et ne jamais le masquer.
4. **Validation matérielle** (VALIDATION.md, nécessite l'utilisateur) :
   Discord routing réel, sleep/wake réel, restauration micro réelle,
   endurance longue durée, débranchement périphérique à chaud.
5. **ACCEPTED à réévaluer si terrain** : les 22 ACCEPTED sont des
   compromis documentés — rouvrir uniquement sur signal réel
   (rapport utilisateur, crash, dump).
6. Zones déjà auditées et couvertes — NE PAS relancer d'audit général
   sans nouveau signal : main.js (IPC, audio, process, config, callbacks,
   lifecycle OS), app.js (playback, import, raccourcis, enregistreur,
   modales, decode), preload.js, media-permission.js, tap-processor.js,
   scripts build, et les FPV cycle 1/2 (revue lots A/B). Restant jamais
   audité en profondeur : AudioEndpoint.cs et AudioTap.cs côté C#
   (revue lot B s'est limitée aux zones des IDs listés), et
   lib/audio-utils.js dans son ensemble hors tests.

## Règles de reprise

- `AGENTS.md` fait foi : node --check / npm test / npm run dist /
  git push après chaque commit, statuts honnêtes.
- Ne jamais marquer CLOSED sans revue indépendante + test + runtime.
- `suivi.tsv` + `regen-suivi.ps1` à jour pour les changements
  significatifs.
- VB-CABLE jamais embarqué/installé ; isolation Electron intacte.
