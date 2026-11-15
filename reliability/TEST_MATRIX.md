# TEST_MATRIX — couverture reelle

## Automatisé (npm test, node:test — 37 tests, vérifié 15/11/2026)
| Zone | Fichier test | Cas couverts |
|---|---|---|
| lib/audio-utils | audio-utils.test.js | parseEndpoints malformé + fuzz, realDevices placeholders, safeName noms réservés + fuzz, expandPaths/Async, fmtTime, chemins, parseTs bornes, chooseRestoreIds (fallback sans nom — SF-REL-0140), writeRecording (collision, ext invalide, écriture concurrente ×20 — SF-REL-0141) |
| lib/media-permission | media-permission.test.js | décision media, realDevices |
| tap-processor | tap-processor.test.js | alignement 8o, circulaire borné, flush, drop ancien, sortie vide, NaN/Inf |

Note V2 : ces tests couvrent STATIC+UNIT. Aucun ne valide le
comportement runtime des corrections dans l'app empaquetée — voir
« NON couvert » ci-dessous et le statut FIXED_PENDING_VALIDATION du
registre.

## Compilé / vérifié statiquement
| Zone | Vérification |
|---|---|
| AudioTap.cs / AudioEndpoint.cs | csc.exe compile OK à chaque batch |
| AudioEndpoint list/get | exécuté réel (noms+ids endpoints) |
| JS | node --check sur chaque fichier modifié |
| package | npm audit 0 vulnérabilité |

## Exécuté réel (RUNTIME via CDP — test/cdp-drive.js, 15/11/2026)
| Check | Résultat |
|---|---|
| rec:save -> fichier persisté recordings/ | PASS (8 octets vérifiés) |
| rec:save data null -> rejet | PASS |
| play() voix 2 nodes + ctx running + stopAll | PASS |
| AudioContext cable+mon 'running' | PASS |
| file:check absent / yt:info URL invalide | PASS |
| Suite | 7/7 — session sa9fe21, aucune erreur log |

## Exécuté réel (smoke, pas fonctionnel)
| Vérification | Résultat |
|---|---|
| dist\SoundFart.exe --test-profile | fenêtre créée, config.json+audio-restore.json écrits, [perm] ALLOW — smoke générique de démarrage, PAS une validation comportementale par anomalie |

## NON couvert — validation manuelle requise (VALIDATION.md)
- Lecture audio réelle, loudness, seeking, fades
- Enregistrement micro / audio PC / Discord (chemin PCM complet)
- Reconnexion device invalidé (USB/audio service restart)
- Bascule+restauration micro tous rôles (guard, watchdog, kill parent)
- yt-dlp/ffmpeg réels, imports YouTube
- rec:save / media:cut de bout en bout (SF-REL-0058 corrigé mais non rejoué)
- getDisplayMedia fallback system audio
- Comportement long terme (fuites, endurance)
