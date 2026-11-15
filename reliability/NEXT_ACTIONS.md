# NEXT_ACTIONS — point de reprise unique

> Dernière réconciliation : 15/11/2026 (fin session audit lib + réévaluation ACCEPTED).
> Pour reprendre : lire ce fichier, puis `git log --oneline -3` pour
> confirmer HEAD, `npm test` (**40 attendus**), `node --check` sur tout JS
> modifié depuis. Ne pas relancer les validations déjà listées comme
> faites dans TEST_MATRIX.md sans raison nouvelle.

## État réel (vérifié 15/11/2026)

- **Registre** : 166 anomalies — **131 CLOSED** · **11 FPV** ·
  23 ACCEPTED · 1 INVESTIGATING (SF-REL-0611). Toutes les zones de code
  sont auditées, y compris lib/audio-utils.js en entier et les deux .cs.
- **FPV en attente de revue indépendante** (diff de la session
  lib/ACCEPTED, à relire puis promouvoir) :
  - SF-REL-0054 — `app.quit()` après 2e crash renderer (main.js)
  - SF-REL-0055 — `call npm test` + errorlevel dans build.bat
  - SF-REL-0059 — rejet yt:download >512 Mo (main.js)
  - SF-REL-0116 — `stopFallback` 1,5 s dans stopVoice (app.js)
  - SF-REL-0674/0675/0676/0677/0678/0679/0680 — safeName (noms réservés
    Windows avec espace/point, ctrl chars), writeRecording unlink wx,
    chooseRestoreIds filtre flow, fmtTime arrondi, parseTs bornes,
    expandPaths garde itérable (lib/audio-utils.js)
- **Branche** : `hardening/v2`, poussé sur GitHub SSH après chaque commit.
- **Build** : `dist\SoundFart.exe` à jour (npm run dist après chaque
  changement fonctionnel). Smoke `--test-profile` relancé sur le nouveau
  build ; aucun `.dmp` Crashpad à ce jour.
- **Couverture runtime** : voir TEST_MATRIX.md — YouTube complet,
  micro/MediaRecorder, boucle VB-CABLE, AudioTap, rec:save, media:cut
  tous validés avec niveaux non nuls mesurés.

## Prochaine action exacte (ordre chronologique)

1. **Revue indépendante du diff session** (lib/audio-utils.js +
   main.js 0054/0059 + app.js 0116 + build.bat 0055) → promouvoir les 11
   FPV en CLOSED si corrects. Commits concernés : voir `git log` récent.
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
