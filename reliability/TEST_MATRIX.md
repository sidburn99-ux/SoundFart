# TEST_MATRIX — couverture réelle

> Réconcilié le 15/11/2026. Distinguer : automatique / statique /
> runtime CDP / matériel. Ne jamais déclarer « testé » sans preuve.

## Automatisé (`npm test`, node:test — **39 tests**, vérifié 15/11/2026)

| Zone | Fichier test | Cas couverts |
|---|---|---|
| lib/audio-utils | audio-utils.test.js | parseEndpoints + fuzz, realDevices, safeName + fuzz, expandPaths/Async (plafonds sons vs visites — SF-REL-0620), fmtTime, parseTs, chooseRestoreIds, writeRecording (collision, concurrence ×20 — SF-REL-0141), cbOrNoop (SF-REL-0614) |
| lib/media-permission | media-permission.test.js | décision media, realDevices |
| tap-processor | tap-processor.test.js | alignement 8o, circulaire, flush, drop ancien, NaN/Inf |

Note V2 : couvrent STATIC+UNIT. Les call-sites main.js/app.js ne sont
pas testables via npm test — couverts par revue indépendante + runtime.

## Compilé / vérifié statiquement

| Zone | Vérification |
|---|---|
| AudioTap.cs / AudioEndpoint.cs | csc.exe compile OK à chaque batch |
| JS | `node --check` sur chaque fichier modifié (main, preload, app, lib) |
| package | npm audit 0 vulnérabilité ; electron-builder whitelist stricte (aucune donnée utilisateur embarquée) |

## Exécuté réel — runtime CDP (test/cdp-*.js, drivers Chrome DevTools)

| Chemin | Driver | Preuve |
|---|---|---|
| UI complète : config roundtrip, play/stopAll, teardownAudio/applyAudio, file:check | cdp-drive.js | 12/12 checks PASS (rejoué après chaque fix) |
| yt:info réel (Big Buck Bunny 635 s) | cdp-ytinfo.js | métadonnées réelles |
| yt:download sectionné → MP3 217 Ko | cdp-ytdl.js | ffmpeg -x --download-sections |
| yt:download complet → WebM 252 Ko | cdp-ytdlfull.js | sectioned:false |
| media:cut → extrait 1 996 o | cdp-cut.js | ffmpeg réel |
| ytEnsure → yt-dlp + ffmpeg SHA-256 | (dans cdp-yt*/cut) | install vérifiée, 2 P0 trouvés/corrigés |
| Micro → MediaRecorder → blob webm | cdp-rec.js | permission ALLOW, décodage OK |
| Boucle VB-CABLE entrée→sortie | cdp-cableloop.js | RMS 0,282 / peak 0,407 — niveau non nul mesuré |
| rec:save blob réel → webm 24 Ko | cdp-recsave.js | fichier persisté exact |
| AudioTap WASAPI loopback | cdp-tap.js | 73 chunks PCM, RMS 0,285 / peak 0,635 |

## Exécuté réel — smoke

| Vérification | Résultat |
|---|---|
| dist\SoundFart.exe --test-profile | fenêtre, config.json, audio-restore.json, [perm] ALLOW — smoke de démarrage, PAS une validation comportementale |
| Endurance | smoke continu depuis ~15:59, heap stable, aucun `.dmp` Crashpad à ce jour |

## NON couvert — validation matérielle requise (VALIDATION.md)

- Discord routing réel (message audio reçu par Discord via CABLE)
- Sleep/wake réel (trou éventuel dans enregistrement — SF-REL-0652 documenté)
- Restauration micro réelle multi-rolling (guard process, kill parent)
- Débranchement/raccordement périphérique à chaud (USB, Bluetooth)
- Endurance longue durée (>1 session), fuite mémoire sur jours
- getDisplayMedia fallback system audio (chemin UI non testé)
- Crash renderer -1/143 : jamais reproduit sous CDP — attendre .dmp (SF-REL-0611)
