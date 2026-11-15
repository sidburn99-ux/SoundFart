# ARCHITECTURE — cartographie (à compléter lors des passes)

Processus :
- Electron main (main.js) : IPC, config, spawn yt-dlp/ffmpeg/tar/csc/powershell, watchdog micro, permissions, cycle de vie.
- preload.js : contextBridge -> surface API renderer (sandbox:true).
- Renderer (src/app.js + index.html + style.css + tap-processor.js) : UI, Web Audio, enregistreur, worklet PCM.
- AudioTap.exe (C#) : WASAPI loopback -> PCM stdout (8o/frame) OU mode pcm fichier ; injecté vers endpoint render.
- AudioEndpoint.exe (C#) : énumération/set défaut/restore/guard rôles (console/comm/multi).

Flux audio : fichiers -> decode (Web Audio/ffmpeg) -> worklet -> [sortie user + tap PCM] -> AudioTap stdin? (à vérifier) -> WASAPI render endpoint -> Windows -> Discord/écouteurs.
Enregistrement : micro/système via getUserMedia + AudioTap capture -> MediaRecorder/webm -> ffmpeg -> fichier.

Frontières : IPC invoke/handle main<->renderer ; spawn stdout/stderr ; fichiers SoundFart-data ; registry AudioEndpoint.
