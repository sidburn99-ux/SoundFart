# TEST_MATRIX — couverture reelle

## Automatisé (npm test, node:test — 31 tests)
| Zone | Fichier test | Cas couverts |
|---|---|---|
| lib/audio-utils | audio-utils.test.js | parseEndpoints malformé, realDevices placeholders, safeName noms réservés, expandPaths/Async, fmtTime, chemins |
| lib/media-permission | media-permission.test.js | décision media, realDevices |
| tap-processor | tap-processor.test.js | alignement 8o, circulaire borné, flush, drop ancien, sortie vide, NaN/Inf |

## Compilé / vérifié statiquement
| Zone | Vérification |
|---|---|
| AudioTap.cs / AudioEndpoint.cs | csc.exe compile OK à chaque batch |
| AudioEndpoint list/get | exécuté réel (noms+ids endpoints) |
| JS | node --check sur chaque fichier modifié |
| package | npm audit 0 vulnérabilité |

## Exécuté réel (smoke, pas fonctionnel)
| Vérification | Résultat |
|---|---|
| dist\SoundFart.exe --test-profile | fenêtre créée, config.json+audio-restore.json écrits, [perm] ALLOW, pas de crash (11:35) |

## NON couvert — validation manuelle requise (VALIDATION.md)
- Lecture audio réelle, loudness, seeking, fades
- Enregistrement micro / audio PC / Discord (chemin PCM complet)
- Reconnexion device invalidé (USB/audio service restart)
- Bascule+restauration micro tous rôles (guard, watchdog, kill parent)
- yt-dlp/ffmpeg réels, imports YouTube
- rec:save / media:cut de bout en bout (SF-REL-0058 corrigé mais non rejoué)
- getDisplayMedia fallback system audio
- Comportement long terme (fuites, endurance)
