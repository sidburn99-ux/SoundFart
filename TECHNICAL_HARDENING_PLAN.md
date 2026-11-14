# TECHNICAL_HARDENING_PLAN.md — SoundFart

> Rôle : plan de reprise et de suivi d'une mission d'audit/durcissement technique. Statut : **actuel mais éphémère** — point de handoff entre sessions, à vider ou archiver en fin de mission. À consulter : uniquement pour reprendre un chantier hardening.
> Commit de référence : `fa3f523` (main, après merges PR #1-#3 docs). Mission v2 = audit complet + refonte (branche `hardening/v2`).


## État des lieux (après 2 audits complets + durcissements)

### Déjà corrigé et vérifié
- Restauration micro : uniquement via `audio-restore.json` (marqueur de vraie bascule) ; guard PID+StartTime ; watchdog = suspension session.
- Enregistreur : onstop non annulé, worklet stéréo `[2]`, flush anti pré-roll, handlers tap par identité, anti double-clic, `tapLost` anti-fichier-silencieux, diagnostics PCM complets.
- AudioTap PCM : prouvé en réel (2,3 Mo/6 s, pic non nul) ; 3 enregistrements « audio du PC » validés (-23/-24/-29 dB).
- ffmpeg : `.sha256` gyan.dev hash nu accepté (C1 — ffmpeg était impossible à installer).
- Modales : onClose de la précédente invoqué (fuite enregistreur corrigée).
- Sécurité : gardes IPC `fromApp`, `openDir` dossier seul, https-only, whitelist ffmpeg, timeouts, SHA-256, `windowsHide`, borne 300 Mo, `__proto__` purgé.
- Config : `.bak` fallback, `normalizeCfg` coercitions, écriture atomique.
- Docs : SPEC/GUIDE/TESTS_VM/README/journaux alignés ; suivi.tsv/html à jour.

### Restes connus (à traiter dans cette mission)
- **Crash renderer AudioContext** (exitCode -1/143) — NON résolu, chantier P0/P1.
- Backpressure PCM non borné côté renderer (`pcmQ` 600 msgs, ring worklet 5,5 s).
- `decodeAudioData` sur fichiers >~1 h → pic mémoire renderer.
- Limiteur = DynamicsCompressor souple → clipping possible à volume 300 %.
- `config:load` sans borne de taille ; `file:check`/`files:expand` fs sync (gel UI possible).
- Double STOP (menu accelerator + globalShortcut — idempotent mais incohérent).
- Label UI « SoundFart-data » en dur même en mode dev/repli.
- `unhandledRejection` ne restaure pas le micro (choix documenté, à trancher).
- Formats WASAPI : `Fmt.FromPtr`/`Convert` à auditer (16/24/32 bits, extensible).
- Cycle de vie AudioContext : `interrupted`/`closed` non gérés partout.
- `menu:state` payload non validé (types).

## Priorités
- P0 : crash AudioContext, enregistrements silencieux (résolu), restauration micro (résolu).
- P1 : backpressure PCM, formats WASAPI, AudioContext lifecycle, STOP, régressions lecture.
- P2 : mémoire decodeAudioData/bufCache, fs sync, robustesse config.
- P3 : cohérence docs, label UI, double STOP cosmétique.

## Tests audio réels disponibles
- VB-CABLE installé, G930 présent, Discord utilisé par l'utilisateur.
- AudioTap PCM prouvé ; ffmpeg/yt-dlp dans `%APPDATA%\SoundFart\tools\`.
- `npm test` = 14/14 (node:test, fonctions pures).

## Corrections realisees (session 2)

- main.js : execFileSync -> audioExecP partout sauf will-quit/uncaughtException ; restoreMicNowP async ; menu:state valide ; config:load borne 16 Mo ; STOP menu sans accelerator ; shortcuts:apply valide avant unregisterAll + dedup ; rec:save/media:cut/file:reveal valides ; yt:* restreint aux hotes YouTube ; cable:openPage catch ; log() borne 4 Ko ; render-process-gone -> 1 reload ; app:dataDir expose ; permissions media = audio seul.
- src/app.js : getBuffer anti-OOM 150 Mo + dedup inflight ; voices.add avant boucle + rollback partiel ; dedup sorties par deviceId ; resume().catch ; statechange interrupted -> toast ; micStream ended/mute -> toast+applyAudio ; pistes enregistrees 'ended' -> stop ; normalizeCfg clamps (addedAt/plays>=0, fades>=0) ; yt endIn seul -> erreur ; view: valide ; addPaths/checkMissing/applyShortcuts catches ; '+'->'Plus' ; findShortcutOwner menu accels ; removeSound purge bufCache ; lastDestDir effacable ; libelle dossier = vrai userData.
- AudioTap.cs : blockAlign valide + pas inter-canal = blockAlign/channels ; codes S_ WASAPI (hr>0) non fatals, hr<0 seulement.
- lib/audio-utils.js : safeName rejette les noms reserves Windows.
- preload.js : getDataDir.

## Tests

- node --check : main.js, app.js, preload.js, audio-utils.js, tap-processor.js OK
- npm test : 14/14 pass
- csc.exe AudioTap.cs : compile sans erreur
- npm run dist : a executer
- Audio reel : NON reteste (modifs surtout lifecycle/IPC ; AudioTap recompile a la volee au prochain lancement)
