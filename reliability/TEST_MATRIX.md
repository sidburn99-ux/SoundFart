# TEST_MATRIX

| Sous-système | Couverture actuelle | Niveau | Statut |
|---|---|---|---|
| lib/audio-utils.js | node:test (findCable*, chooseRestoreIds…) | unitaire | OK 23 tests |
| lib/media-permission.js | node:test (8 cas) | unitaire | OK |
| config/normalizeCfg | partiel via app.js (non testable node pur) | — | GAP |
| IPC main.js | non testé (nécessite Electron) | — | GAP |
| AudioTap.cs | compile + AudioEndpoint list/get réel | partiel | GAP flux |
| AudioEndpoint.cs | list/get réel OK ; set/restore non rejoué | partiel | GAP |
| renderer app.js | non testé (DOM/Electron requis) | — | GAP |
| tap-processor.js | non testé | — | GAP |
| scripts .bat/.ps1 | vérifiés manuellement | manuel | partiel |
| ffmpeg/yt-dlp | non testé en réseau | — | GAP |
