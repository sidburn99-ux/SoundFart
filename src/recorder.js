// ================================================================
// enregistreur
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ enregistreur
// Garde AudioTap : audioTapStop est un singleton global — une ancienne
// session qui finit en async ne doit PAS tuer le tap d'une session plus
// recente. Chaque audioTapStart reussi prend un jeton ; on n'arrete que
// si le notre est toujours le dernier delivre.
let tapGenCounter = 0, lastTapGen = 0;

async function recorderModal() {
  let streams = [], actx = null, rec = null, chunks = [];
  let myTapGen = 0; // jeton de la prise de tap par CETTE session (0 = pas de tap a nous)
  let recordedSound = null, recTimer = null, recStart = 0, looseTracks = [];
  let dead = false; // passe a true a la fermeture : avorte les startBtn encore en vol
  let closedDuringRec = false; // modale fermee PENDANT une prise : pas de modale resultat (elle detruirait une modale ouverte entre-temps)
  let tapNode = null, pcmQ = [], pcmSeen = false, tapLost = false, pcmDrops = 0, pcmQBytes = 0;
  let analyser = null, meterRaf = 0;
  // Pas de disconnect() ni d'analyser=null : le noeud reste dans le graphe
  // comp -> analyser -> dest jusqu'a actx.close() — le couper ici
  // rendrait la fin d'enregistrement silencieuse, et nuller analyser
  // empêchait startMeter de jamais afficher la jauge (retour terrain).
  const stopMeter = () => { if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = 0; } meterBar.style.display = 'none'; };
  const startMeter = () => {
    stopMeter();
    if (!analyser) return;
    const td = new Uint8Array(analyser.fftSize);
    meterBar.style.display = '';
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(td);
      let peak = 0;
      for (let i = 0; i < td.length; i += 4) { const v = Math.abs(td[i] - 128) / 128; if (v > peak) peak = v; }
      meterFill.style.width = Math.min(100, peak * 140) + '%';
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  };
  const killTapNode = () => { if (tapNode) { try { tapNode.disconnect(); } catch {} tapNode = null; } pcmQ = []; pcmQBytes = 0; };
  // N'arrete le tap que s'il appartient a la session la plus recente :
  // sinon le cleanup d'une vieille modale tuerait l'enregistrement d'une
  // nouvelle session (silencieux, sans tapDead car arret volontaire).
  const stopTapIfMine = () => {
    // Le catch silencieux laissait un AudioTap orphelin (CPU + process
    // jusqu'a la detection parent-death) sans aucun diagnostic.
    if (myTapGen && myTapGen === lastTapGen) window.sf.audioTapStop().catch((e) => window.sf.uiLog('audioTapStop: ' + (e && e.message)));
  };
  const offTapDead = window.sf.onTapDead ? window.sf.onTapDead(() => {
    window.sf.uiLog('tapDead rec=' + (rec ? rec.state : 'null') + ' dead=' + dead);
    tapLost = true; // le tap est mort : ni enregistrement silencieux ni faux succes
    if (dead || !rec || rec.state === 'inactive') return;
    toast('Source « Audio du PC » perdue — enregistrement arrêté.', 'warn');
    try { rec.stop(); } catch (e) { window.sf.uiLog('recorder rec.stop (tapDead): ' + (e && e.message)); }
  }) : null;
  const offTapPcm = window.sf.onTapPcm ? window.sf.onTapPcm((ab) => {
    if (!pcmSeen) { pcmSeen = true; window.sf.uiLog('tapPcm: premier flux recu (' + ab.byteLength + 'o)'); }
    // transfer [ab] : evite le clone structure de chaque chunk PCM (frequence elevee)
    if (tapNode) { try { tapNode.port.postMessage(ab, [ab]); } catch {} }
    // Borne en octets AUSSI : 600 chunks PCM 48 kHz stereo ≈ 115 Mo si le
    // worklet tarde — la limite en nombre seul ne bornait rien.
    else if (pcmQ.length < 600 && pcmQBytes + ab.byteLength < 64 * 1024 * 1024) { pcmQ.push(ab); pcmQBytes += ab.byteLength; }
    else if (!pcmDrops) { pcmDrops = 1; window.sf.uiLog('pcmQ saturee : chunks AudioTap jetes (renderer occupe)'); }
  }) : null;

  // « default » exclu : apres la bascule micro auto, il pointerait sur CABLE Output (on enregistrerait la soundboard, pas le micro)
  // Si enumerateDevices jette, les handlers IPC enregistres plus haut fuiraient
  // pour toute la session : on les desabonne avant de propager.
  let devs;
  try {
    devs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications' && d.deviceId !== 'default');
  } catch (e) {
    if (offTapDead) offTapDead();
    if (offTapPcm) offTapPcm();
    throw e;
  }
  // matched : sans ca, un select sans option « selected » prend devs[0]
  // automatiquement et micSel.value est truthy -> le repli firstReal
  // ci-dessous ne se declenchait JAMAIS (peut choisir CABLE Output).
  let micMatched = false;
  const micSel = el('select', {}, devs.map((d) => {
    const sel = d.deviceId === cfg.settings.micId;
    if (sel) micMatched = true;
    const o = el('option', { value: d.deviceId, text: (VIRTUAL_RE.test(d.label || '') ? '⚠ ' : '') + (d.label || d.deviceId), selected: sel });
    o.dataset.label = d.label || d.deviceId;
    return o;
  }));
  if (!micMatched && devs.length) {
    // Priorite a un peripherique non virtuel : devs[0] peut etre CABLE Output
    // -> le « micro » enregistrerait la soundboard au lieu de la voix.
    const firstReal = devs.find((d) => !VIRTUAL_RE.test(d.label || '')) || devs[0];
    micSel.value = firstReal.deviceId;
  }
  const micOn = el('input', { type: 'checkbox', checked: true, title: 'Enregistre la voix via ton micro (avec réduction d\'écho et de bruit).' });
  const pcOn = el('input', { type: 'checkbox', checked: false, title: 'Enregistre tout ce que tu entends sur le PC (vidéo, jeu, musique) — capturé directement à la sortie, sans repasser par le câble.' });
  const cableOn = el('input', { type: 'checkbox', checked: false, title: 'Enregistre ce que SoundFart envoie vers Discord (les sons de la soundboard).' });
  const status = el('div', { class: 'hint', text: 'Choisis les sources, puis lance l\'enregistrement.' });
  // Jauge de niveau en direct : une barre de « progression » n'a pas de sens
  // (duree libre) — ce qui manque a l'utilisateur c'est de VOIR que le son
  // est capte. AnalyserNode sur le mix -> pic RMS par frame.
  const meterBar = el('div', { class: 'rec-meter' }, el('i'));
  meterBar.style.display = 'none';
  const meterFill = meterBar.firstChild;
  const nameIn = el('input', { type: 'text', value: 'Enregistrement ' + new Date().toLocaleString('fr-FR'), maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name })));
  const startBtn = el('button', { text: '● Enregistrer', class: 'primary' });
  const stopBtn = el('button', { text: '■ Arrêter', disabled: true });

  const extFor = (mime) => (mime && mime.includes('mp4') ? '.m4a' : mime && mime.includes('ogg') ? '.ogg' : '.webm');
  const mimePick = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';

  const stopLoose = () => { looseTracks.forEach((t) => t.stop()); looseTracks = []; };

  // libere ce qui a ete ouvert apres la fermeture du modal (sources tardives, tap systeme)
  const deadCleanup = (st) => {
    if (st) st.getTracks().forEach((t) => t.stop());
    stopLoose();
    killTapNode();
    stopTapIfMine();
    if (actx) { actx.close().catch(() => {}); actx = null; }
  };

  const cleanup = () => {
    dead = true;
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    stopMeter();
    if (offTapDead) offTapDead();
    if (offTapPcm) offTapPcm();
    // Enregistrement existant : on laisse onstop faire la sauvegarde + tout le
    // menage — l'annuler ici perdrait silencieusement l'enregistrement.
    // Si rec.stop() echoue (ou rec inactif sans onstop a venir), on nettoie
    // quand meme : micro/tap/contexte ne doivent pas rester allumes.
    // rec non-null = un onstop peut etre EN VOL (state 'inactive' immediat
    // mais blob/askDestDir/modal pas finis) : sans ce flag, onstop ouvrirait
    // sa modale de resultat et detruirait une modale ouverte entre-temps —
    // closedDuringRec ne couvrait que « ferme pendant la prise ».
    if (rec) closedDuringRec = true;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); return; } catch { /* onstop ne viendra pas : nettoyage ci-dessous */ }
    }
    streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    streams = [];
    stopLoose();
    killTapNode();
    stopTapIfMine();
    if (actx) { actx.close().catch(() => {}); actx = null; }
  };

  // Capture l'audio systeme (Discord, musique...) = tout ce qui sort par le peripherique par defaut.
  // Methode 1 : chromeMediaSource (Electron/desktopCapturer) — la plus fiable sous Windows.
  // Methode 2 : getDisplayMedia + loopback (peut echouer : « Could not start audio source »).
  const audioOnly = (stream) => {
    const vids = stream.getVideoTracks();
    if (vids.length) looseTracks.push(...vids); // garder la video vivante : le loopback meurt avec elle
    return new MediaStream(stream.getAudioTracks());
  };
  const checkLive = async (stream) => {
    await new Promise((r) => setTimeout(r, 300));
    const tracks = stream.getAudioTracks();
    if (!tracks.length || tracks.some((t) => t.readyState !== 'live')) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('piste audio système interrompue (loopback indisponible)');
    }
    return stream;
  };
  const systemStream = async () => {
    const srcId = await window.sf.desktopSource().catch(() => null);
    const attempts = [];
    if (srcId) {
      attempts.push(() => navigator.mediaDevices.getUserMedia({
        audio: { chromeMediaSource: 'desktop', chromeMediaSourceId: srcId },
      }));
      attempts.push(() => navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: srcId } },
      }));
    }
    attempts.push(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((disp) => { looseTracks.push(...disp.getVideoTracks()); return new MediaStream(disp.getAudioTracks()); }));
    let lastErr = null;
    for (const fn of attempts) {
      try {
        const st = audioOnly(await fn());
        return await checkLive(st);
      } catch (e) {
        lastErr = e;
        stopLoose();
        window.sf.uiLog('systemStream: ' + (e && e.name) + ' ' + (e && e.message));
      }
    }
    throw lastErr || new Error('audio systeme indisponible');
  };

  // Peripherique d'entree qui correspond au cable virtuel (ex. « CABLE Output »)
  const cableStream = async () => {
    const inp = (audio.devices.inp || []).filter((d) => d.deviceId !== 'default');
    const d = inp.find((x) => /output/i.test(x.label) && VIRTUAL_RE.test(x.label))
      || inp.find((x) => /cable/i.test(x.label));
    if (!d) throw new Error('peripherique « CABLE Output » introuvable');
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: d.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  };

  // Source morte en cours d'enregistrement : le fichier serait
  // silencieux sur cette source sans avertissement. Factorise : le repli
  // systemStream l'oubliait (piste jamais surveillee).
  const watchEnded = (st) => st.getTracks().forEach((t) => t.addEventListener('ended', () => {
    if (!dead && rec && rec.state === 'recording') {
      toast('Une source audio est morte — enregistrement arrêté.', 'warn');
      try { rec.stop(); } catch {}
    }
  }));

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true; // desactive des le clic : evite le double demarrage
    try {
      streams = [];
      // « Audio du PC » : AudioTap capture le loopback systeme en PCM float32 48 kHz sur
      // stdout -> IPC -> AudioWorklet -> enregistreur. Ne passe PLUS par le cable :
      // la voix des amis Discord n'est plus reinjectee dans l'appel (anti-echo).
      // Repli sur getDisplayMedia si le tap echoue.
      let tapOn = false, pcConnected = false;
      pcmSeen = false; tapLost = false;
      if (pcOn.checked) {
        try {
          const r = await window.sf.audioTapStart();
          tapOn = !!(r && r.ok);
          if (tapOn) { myTapGen = ++tapGenCounter; lastTapGen = myTapGen; }
          if (!tapOn) window.sf.uiLog('audioTapStart: ' + (r && r.err));
        } catch (e) { window.sf.uiLog('audioTapStart: ' + e.message); }
        if (dead) { deadCleanup(); return; }
      }
      const want = [];
      if (micOn.checked) want.push(['micro', () => navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micSel.value ? { exact: micSel.value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })]);
      if (pcOn.checked && !tapOn) want.push(['audio du PC', systemStream]);
      if (cableOn.checked) want.push(['câble SoundFart', cableStream]);
      // tapOn = source « audio du PC » active via PCM/worklet (pas de getUserMedia) :
      // elle compte comme une source meme si want est vide.
      if (!want.length && !(pcOn.checked && tapOn)) throw new Error('coche au moins une source');
      for (const [label, fn] of want) {
        try {
          const st = await fn();
          if (dead) { deadCleanup(st); return; }
          watchEnded(st);
          streams.push(st);
          if (label === 'audio du PC') pcConnected = true;
        }
        catch (e) { window.sf.uiLog('recorder src ' + label + ': ' + (e && e.name) + ' ' + (e && e.message)); streams.forEach((st) => st.getTracks().forEach((t) => t.stop())); streams = []; throw new Error(label + ' : ' + e.message); }
      }
      if (dead) { deadCleanup(); return; }
      const mime = mimePick();
      actx = new AudioContext({ sampleRate: SR });
      // Contexte cree hors geste utilisateur peut etre 'suspended' (politique
      // autoplay, veille) : sans resume, le MediaRecorder produit un fichier
      // silencieux sans erreur.
      try { await actx.resume(); } catch (e) { window.sf.uiLog('recorder actx.resume: ' + (e && e.message)); }
      if (actx.state !== 'running') {
        window.sf.uiLog('recorder actx.state=' + actx.state + ' (risque de fichier silencieux)');
        // Un MediaRecorder sur un contexte suspendu produit un fichier
        // silencieux SANS erreur — l'utilisateur doit le savoir, pas
        // seulement le log.
        toast('Enregistrement : contexte audio suspendu — le fichier pourrait être silencieux.', 'warn');
      }
      const dest = actx.createMediaStreamDestination();
      const comp = actx.createDynamicsCompressor(); // evite l'ecrêtage quand plusieurs sources sont mixees
      comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 8;
      // analyser dans le graphe : alimente la jauge de niveau ET reste
      // transparent pour le signal (pas de modification du flux).
      analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      comp.connect(analyser);
      analyser.connect(dest);
      streams.forEach((st) => actx.createMediaStreamSource(st).connect(comp));
      if (tapOn) {
        try {
          await actx.audioWorklet.addModule('tap-processor.js');
          // outputChannelCount [2] : sans ca la sortie du worklet peut etre mono
          // (seul le canal gauche serait enregistre). numberOfInputs 0 : inutilise.
          tapNode = new AudioWorkletNode(actx, 'tap-processor', { numberOfInputs: 0, outputChannelCount: [2] });
          pcConnected = true;
          pcmQ.forEach((ab) => tapNode.port.postMessage(ab, [ab]));
          pcmQ = []; pcmQBytes = 0;
        } catch (e) {
          window.sf.uiLog('tap worklet: ' + (e && e.message));
          killTapNode();
          // Sans cet arret, AudioTap continue de capturer le loopback
          // systeme pendant tout l'enregistrement (CPU + capture inutile).
          stopTapIfMine();
          try {
            const st = await systemStream();
            if (dead) { deadCleanup(st); return; }
            watchEnded(st);
            streams.push(st);
            pcConnected = true;
            actx.createMediaStreamSource(st).connect(comp);
          } catch (e2) { window.sf.uiLog('recorder src audio du PC (repli): ' + (e2 && e2.message)); }
        }
      }
      chunks = [];
      rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      // MediaRecorder peut errerurer sans jamais tirer onstop : sans ce filet,
      // micro/tap/contexte resteraient allumes et l'enregistrement serait perdu.
      let recFailed = false;
      rec.onerror = () => {
        recFailed = true; // onstop sauvegardera le partiel, avec un statut honnete
        window.sf.uiLog('recorder onerror state=' + (rec ? rec.state : '?'));
        if (rec && rec.state === 'inactive') {
          // Passage a inactive SANS onstop (cas deja anticipe ligne ~306) :
          // sans ca recTimer/status/micro/tap/actx restaient ouverts et
          // l'UI affichait « Enregistrement… » sans rien enregistrer.
          // On invoque onstop a la main : il sauve le partiel et nettoie.
          const h = rec.onstop;
          rec.onstop = null; // garde contre un double fire si 'stop' arrive quand meme
          if (h) {
            try {
              const p = h();
              if (p && typeof p.catch === 'function') p.catch((e2) => window.sf.uiLog('recorder onstop manuel: ' + (e2 && e2.message)));
            } catch (e2) { window.sf.uiLog('recorder onstop manuel: ' + (e2 && e2.message)); }
          }
          return;
        }
        try { if (rec && rec.state !== 'inactive') rec.stop(); }
        catch (e) { window.sf.uiLog('recorder rec.stop (onerror): ' + (e && e.message)); }
      };
      rec.onstop = async () => {
        if (recTimer) { clearInterval(recTimer); recTimer = null; }
        stopMeter();
        const recMime = rec ? rec.mimeType : '';
        try {
          const blob = new Blob(chunks, { type: recMime || mime || 'audio/webm' });
          const ab = await blob.arrayBuffer();
          chunks = []; // liberer les Blob sources : des centaines de Mo sinon
          // Liberer TOUT de suite : si la modale a ete fermee pendant la
          // prise, plus personne ne stoppait micro/AudioTap/AudioContext
          // pendant que l'utilisateur choisissait le dossier (P1).
          streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
          stopLoose();
          killTapNode();
          stopTapIfMine();
          if (actx) { actx.close().catch(() => {}); actx = null; }
          rec = null;
          startBtn.disabled = false; stopBtn.disabled = true;
          micSel.disabled = micOn.disabled = pcOn.disabled = cableOn.disabled = false;
          const fname = nameIn.value.trim() || 'enregistrement';
          // Apercu AVANT sauvegarde : la prise est en memoire (ab) — on la
          // decode et la joue sur l'ecoute locale sans rien ecrire. La voix
          // est enregistree dans voices/ pour que STOP et stopAll la
          // stoppent comme une lecture normale.
          let previewVoice = null, previewBusy = false;
          const previewRec = async () => {
            // Double-clic pendant le decodeAudioData : sans garde, deux voix
            // seraient jouees et la premiere orpheline (seul STOP la stoppe).
            if (previewBusy) return;
            previewBusy = true;
            try {
              // voices.has : un STOP global a deja tue la voix sans passer
              // par onended -> previewVoice serait perime et le clic
              // stopperait une voix morte au lieu de relancer l'apercu.
              if (previewVoice && voices.has(previewVoice)) { stopVoice(previewVoice, true); previewVoice = null; return; }
              previewVoice = null;
              if (!audio.mon) { toast('Choisis une « écoute locale » dans les réglages pour pré-écouter.', 'warn'); return; }
              if (ab.byteLength > 150 * 1024 * 1024) { toast('Enregistrement trop lourd pour l\'aperçu — sauvegarde d\'abord.', 'warn'); return; }
              const buf = await decoder.decodeAudioData(ab.slice(0));
              const out = audio.mon;
              const src = out.ctx.createBufferSource();
              src.buffer = buf;
              const g = out.ctx.createGain();
              g.gain.value = 1;
              src.connect(g); g.connect(out.bus);
              const v = { soundId: '__rec_preview__', nodes: [{ src, g, out }], preview: true };
              voices.add(v);
              src.onended = () => { try { g.disconnect(); } catch {} endVoice(v); if (previewVoice === v) previewVoice = null; };
              src.start();
              previewVoice = v;
              // Watchdog identique a play() : contexte suspendu (veille) ->
              // onended ne tire jamais, la voix resterait zombie dans voices/.
              v.killTimer = setTimeout(() => {
                if (!voices.has(v)) return;
                try { src.stop(); } catch {}
                try { g.disconnect(); } catch {}
                endVoice(v);
                if (previewVoice === v) previewVoice = null;
                toast('Aperçu interrompu : la sortie audio était suspendue.', 'warn');
              }, Math.ceil(buf.duration * 1000) + 15000);
            } catch (e) { logErr('previewRec', e); toast('Aperçu impossible : ' + (e && e.message), 'warn'); }
            finally { previewBusy = false; }
          };
          // Rogner avant sauvegarde : decode la prise et ré-encode en WAV
          // (PCM 16 bits) — les conteneurs MediaRecorder (webm/opus) ne sont
          // pas découpables sans ré-encodage, et ffmpeg ne doit pas être
          // téléchargé pour ça. WAV est dans AUDIO_EXT : lecture/éditeur OK.
          const trimStartIn = el('input', { type: 'number', min: 0, step: 0.1, value: '0' });
          const trimEndIn = el('input', { type: 'number', min: 0, step: 0.1, value: '' });
          const encodeWav = (buf, startSec, endSec) => {
            const sr = buf.sampleRate, nch = buf.numberOfChannels;
            const s0 = Math.max(0, Math.floor(startSec * sr));
            const s1 = Math.min(buf.length, Math.floor((endSec == null ? buf.duration : endSec) * sr));
            const n = Math.max(1, s1 - s0);
            const bytes = 44 + n * nch * 2;
            const wa = new ArrayBuffer(bytes), dv = new DataView(wa);
            const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
            ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVEfmt ');
            dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
            dv.setUint32(24, sr, true); dv.setUint32(28, sr * nch * 2, true);
            dv.setUint16(32, nch * 2, true); dv.setUint16(34, 16, true);
            ws(36, 'data'); dv.setUint32(40, n * nch * 2, true);
            const chans = []; for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
            let o = 44;
            for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
              const v = Math.max(-1, Math.min(1, chans[c][s0 + i]));
              dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7FFF, true); o += 2;
            }
            return wa;
          };
          const trimNodes = [
            field('Rogner (secondes)', el('div', { class: 'row' },
              el('span', { class: 'hint', text: 'Début' }), trimStartIn,
              el('span', { class: 'hint', text: 'Fin' }), trimEndIn),
              'Laisse tel quel pour tout garder. Si tu rognes, le fichier est enregistré en WAV (plus lourd mais sans perte).'),
          ];
          const destDir = await askDestDir([{ label: 'Écouter', onclick: () => previewRec() }], trimNodes);
          if (destDir === null) {
            // La modale a ete detruite par askDestDir : status est detache,
            // seul un toast reste visible — l'utilisateur doit etre informe.
            toast('Enregistrement annulé (choix du dossier).', 'warn');
          } else {
          // Rogner si demande : decode -> slice -> WAV 16 bits. Toute
          // erreur de decode retombe sur le fichier complet (jamais de
          // perte silencieuse de la prise).
          let saveData = ab, saveExt = extFor(recMime || mime);
          const t0 = Math.max(0, +trimStartIn.value || 0);
          const t1raw = trimEndIn.value.trim();
          const t1 = t1raw === '' ? null : Math.max(0, +t1raw || 0);
          if (t0 > 0.01 || (t1 != null && t1 > 0)) {
            try {
              const buf = await decoder.decodeAudioData(ab.slice(0));
              const dur = buf.duration;
              const end = (t1 != null && t1 > 0) ? Math.min(t1, dur) : dur;
              if (end - t0 > 0.05) { saveData = encodeWav(buf, t0, end); saveExt = '.wav'; }
              else toast('Rognage ignoré : la fenêtre demandée est vide.', 'warn');
            } catch (e) { logErr('trimRec', e); toast('Rognage impossible — fichier complet sauvegardé.', 'warn'); }
          }
          const path = await window.sf.saveRecording({ data: saveData, name: fname, ext: saveExt, dir: destDir || cfg.settings.storageDir || '' });
          if (typeof path !== 'string' || !path) throw new Error('réponse rec:save invalide');
          recordedSound = {
            id: uid(), name: fname, path, volume: 100, plays: 0, addedAt: Date.now(),
            categoryId: null, favorite: false, norm: 1, shortcut: null,
            trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
          };
          // Modale fermee pendant la prise : l'utilisateur a peut-etre ouvert
          // une autre modale entre-temps — ne pas la detruire. Le fichier est
          // sauvegarde ; on donne le chemin pour l'ajouter plus tard.
          // modalClose non nul = une modale etrangere est ouverte MAINTENANT
          // (phases trim+save sans modale : l'utilisateur a pu ouvrir
          // l'editeur) — modal() la detruirait (slot unique).
          if (closedDuringRec || modalClose) {
            toast('Enregistrement sauvegardé : ' + path + ' (ajoute-le via « + » si besoin).', 'info');
          } else {
          // askDestDir a remplace la modale enregistreur (slot unique) : sans
          // modale de resultat, recordedSound mourait dans une closure et le
          // fichier restait orphelin dans recordings/ — plus jamais ajoutable.
          modal('Enregistrement terminé', [
            el('div', { class: 'hint', text: 'Durée ' + fmtTime((Date.now() - recStart) / 1000) + ' — ' + path + (recFailed ? ' — ENREGISTREMENT INTERROMPU PAR UNE ERREUR (fichier partiel)' : '') }),
            field('Nom', nameIn),
            field('Catégorie', catSel),
          ], [
            { label: 'Fermer', onclick: (c) => c() },
            { label: 'Écouter', onclick: () => { if (recordedSound) play(recordedSound, { monitorOnly: true, preview: true }); } },
            { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
              if (!recordedSound) return;
              recordedSound.name = nameIn.value.trim() || recordedSound.name;
              recordedSound.categoryId = catSel.value || null;
              const added = recordedSound;
              recordedSound = null;
              if (!pushSound(added)) { c(); return; }
              save(); renderAll(); c();
              toast('Son ajouté à la bibliothèque.');
              setTimeout(() => editSound(added), 60);
            } },
          ]);
          }
          }
        } catch (e) {
          // Si l'echec precede le cleanup deplace (arrayBuffer), les sources
          // sont encore live : on libere ici aussi (idempotent).
          streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
          stopLoose();
          killTapNode();
          stopTapIfMine();
          if (actx) { actx.close().catch(() => {}); actx = null; }
          rec = null;
          startBtn.disabled = false; stopBtn.disabled = true;
          // Modale potentiellement detruite par askDestDir : toast, pas
          // status — sinon l'echec de sauvegarde etait invisible et la
          // prise (des centaines de Mo) perdue sans trace.
          toast('Sauvegarde impossible : ' + e.message, 'warn');
          window.sf.uiLog('rec:save: ' + (e && e.message));
        }
      };
      // modal ferme pendant la preparation : ne pas demarrer l'enregistrement
      if (dead) { deadCleanup(); if (actx) { actx.close().catch(() => {}); actx = null; } return; }
      // Le tap est mort entre tapStart et maintenant : demarrer produirait un
      // fichier silencieux — on refuse avec un message clair. Uniquement si le
      // worklet PCM est la source retenue : si le repli systemStream a pris le
      // relais, tapLost est sans objet.
      if (tapNode && tapLost) throw new Error('audio du PC : flux AudioTap interrompu avant le démarrage');
      if (tapNode && !pcmSeen) {
        // audioTapStart a repondu ok mais aucun chunk PCM n'est arrive :
        // demarrer enregistrerait du silence indetectable. Attente bornee
        // (~2 s) des premiers frames — le loopback emet toujours des frames.
        for (let i = 0; i < 40 && !pcmSeen; i++) await new Promise((r) => setTimeout(r, 50));
        if (!pcmSeen) throw new Error('audio du PC : aucun flux PCM reçu d\'AudioTap');
      }
      // L'attente PCM a pu chevaucher une fermeture de modale.
      if (dead) { deadCleanup(); if (actx) { actx.close().catch(() => {}); actx = null; } return; }
      // « Audio du PC » coche mais ni worklet PCM ni repli systeme n'ont
      // abouti : demarrer produirait un fichier silencieux indetectable.
      if (pcOn.checked && !pcConnected) throw new Error('audio du PC : aucune source disponible (capture et repli système en échec)');
      if (tapNode) {
        // Flush du ring buffer : le PCM arrive des l'audioTapStart, avant les
        // getUserMedia -> sans ca le debut du fichier contiendrait de l'audio
        // capture AVANT le clic sur « Enregistrer ».
        tapNode.port.postMessage('flush');
        tapNode.connect(comp);
      }
      rec.start(250);
      recStart = Date.now();
      startMeter();
      recTimer = setInterval(() => { status.textContent = '● Enregistrement… ' + fmtTime((Date.now() - recStart) / 1000); }, 250);
      status.textContent = '● Enregistrement…';
      startBtn.disabled = true; stopBtn.disabled = false;
      micSel.disabled = micOn.disabled = pcOn.disabled = cableOn.disabled = true;
    } catch (e) {
      window.sf.uiLog('recorder start: ' + (e && e.name) + ' ' + (e && e.message));
      stopMeter();
      status.textContent = 'Source inaccessible : ' + e.message;
      // meme liberation que rec.onstop : pas de micro/tap/contexte leaving trainer
      streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
      stopLoose();
      killTapNode();
      stopTapIfMine();
      if (actx) { actx.close().catch(() => {}); actx = null; }
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {} });

  const cableDevLabel = () => {
    const d = (audio.devices.inp || []).find((x) => /output/i.test(x.label) && VIRTUAL_RE.test(x.label))
      || (audio.devices.inp || []).find((x) => /cable/i.test(x.label));
    return d ? d.label : 'CABLE Output (introuvable)';
  };
  const micLabel = () => { const o = micSel.selectedOptions[0]; return o ? (o.dataset.label || o.textContent) : 'aucun micro'; };
  const srcNames = el('div', { class: 'hint' });
  const syncSrcNames = () => { srcNames.textContent = 'Sources : micro = ' + micLabel() + ' · audio du PC = sortie système · câble = ' + cableDevLabel(); };
  micSel.addEventListener('change', syncSrcNames);
  syncSrcNames();

  modal('Enregistreur', [
    field('Micro', el('div', { class: 'row' }, micOn, micSel), 'Voix via le périphérique d\'entrée choisi.'),
    srcNames,
    field('Audio du PC', pcOn, 'Coche pour mixer ce que tu entends (musique, voix Discord, jeu) directement dans l\'enregistrement — le flux passe par SoundFart sans repasser par le câble, donc sans écho pour tes amis.'),
    field('Câble SoundFart', cableOn, 'Coche pour ajouter ce qui passe dans le câble virtuel (sons de la soundboard + micro mixé).'),
    el('div', { class: 'hint', text: 'Tu peux combiner plusieurs sources : elles sont mixées avec un limiteur anti-saturation. Le son est enregistré en qualité numérique, sans passer par les haut-parleurs.' }),
    el('div', { class: 'row' }, startBtn, stopBtn),
    meterBar,
    status,
    field('Nom', nameIn),
    field('Catégorie', catSel),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
      if (!recordedSound) { toast('Enregistre d\'abord un son.', 'warn'); return; }
      recordedSound.name = nameIn.value.trim() || recordedSound.name;
      recordedSound.categoryId = catSel.value || null;
      if (!pushSound(recordedSound)) { c(); return; }
      save(); renderAll(); c();
      toast('Son ajouté à la bibliothèque.');
      setTimeout(() => editSound(recordedSound), 60);
    } },
  ], { onClose: cleanup });
}
