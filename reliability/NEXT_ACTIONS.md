# NEXT_ACTIONS — point de reprise unique

> Dernière réconciliation : 15/11/2026 (fin session audit lib + réévaluation ACCEPTED).
> Pour reprendre : lire ce fichier, puis `git log --oneline -3` pour
> confirmer HEAD, `npm test` (**40 attendus**), `node --check` sur tout JS
> modifié depuis. Ne pas relancer les validations déjà listées comme
> faites dans TEST_MATRIX.md sans raison nouvelle.

## État réel (vérifié 15/11/2026)

- **Registre** : 168 anomalies — **144 CLOSED** · **0 FPV** ·
  23 ACCEPTED · 1 INVESTIGATING (SF-REL-0611). Toutes les zones de code
  sont auditées, y compris lib/audio-utils.js en entier et les deux .cs.
- **Derniers ajouts** : 0681 (watchdog settings absent) + 0682 (Alt+F4
  blocklist partagée) — revus, runtime CDP vérifié, CLOSED (d596743).
- **Revue indépendante 73ed0a7** : 11/11 CORRECT → tous CLOSED.
  Réserves mineures documentées dans FINDINGS (cycle 8). Affinage
  post-revue : SF-REL-0059 `noRetry` + unlink fichier >512 Mo.
- **Branche** : `hardening/v2`, poussé sur GitHub SSH après chaque commit.
- **SF-REL-0611 mitigation (74ab247)** : AudioContext partagé quand
  `cableId===monId` — surface d'exposition au crash divisée par 2.
  Mitigation, pas preuve de cause : INVESTIGATING maintenu.
- **Build** : `dist\SoundFart.exe` à jour (rebuild post-74ab247).
  Smoke `--test-profile` + cdp-stress long (200 iters) actifs ;
  aucun `.dmp` Crashpad à ce jour.
- **Couverture runtime** : voir TEST_MATRIX.md — YouTube complet,
  micro/MediaRecorder, boucle VB-CABLE, AudioTap, rec:save, media:cut
  tous validés avec niveaux non nuls mesurés.

## Prochaine action exacte (ordre chronologique)

1. ~~Revue indépendante du diff session~~ — **FAIT** : 11/11 CORRECT →
   CLOSED (réserves documentées, 0059 affiné noRetry+unlink).
2. **SF-REL-0611** (crash renderer -1/143) : INVESTIGATING —
   vérifier `find $TEMP/SoundFart-test -name '*.dmp'` ; si un dump
   apparaît, l'analyser (module/processus fautif) ; sinon maintenir
   l'exposition (smoke tourne) et ne jamais le masquer.
3. **Validation matérielle** (VALIDATION.md, nécessite l'utilisateur) :
   Discord routing réel, sleep/wake réel, restauration micro réelle,
   endurance longue durée, débranchement périphérique à chaud.
4. **ACCEPTED à réévaluer si terrain** : les 23 ACCEPTED sont des
   compromis documentés (audit 15/11 : 17 justifications reconduites,
   doublons 0137/0129/0601/0603/0608/0642 documentés) — rouvrir
   uniquement sur signal réel (rapport utilisateur, crash, dump).
5. Zones déjà auditées et couvertes — NE PAS relancer d'audit général
   sans nouveau signal : main.js, app.js, preload.js,
   media-permission.js, tap-processor.js, audio-utils.js (intégral),
   AudioEndpoint.cs, AudioTap.cs, scripts build, lib tests.

## Règles de reprise

- `AGENTS.md` fait foi : node --check / npm test / npm run dist /
  git push après chaque commit, statuts honnêtes.
- Ne jamais marquer CLOSED sans revue indépendante + test + runtime.
- `suivi.tsv` + `regen-suivi.ps1` à jour pour les changements
  significatifs.
- VB-CABLE jamais embarqué/installé ; isolation Electron intacte.
