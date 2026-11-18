// Driver CDP Linux : validation audio reelle sous PulseAudio/PipeWire.
// Usage : lancer l'AppImage (ou electron .) avec
//   --test-profile --remote-debugging-port=9222
// puis : node test/cdp-linux-audio.js
// Probe : enumerateDevices, getUserMedia sur sources monitor, lecture vers
// le null-sink soundfart_cable et capture du .monitor pour mesurer le niveau.

const DBG = 'http://127.0.0.1:9222';

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(DBG + '/json')).json();
      const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('page index.html introuvable sur ' + DBG);
}

let idc = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idc;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000,
  });
  if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}

const results = [];
async function check(name, fn) {
  try {
    const v = await fn();
    results.push([name, 'PASS', JSON.stringify(v)]);
    console.log('PASS', name, '=>', JSON.stringify(v));
  } catch (e) {
    results.push([name, 'FAIL', String(e && e.message || e)]);
    console.log('FAIL', name, '=>', String(e && e.message || e));
  }
}

(async () => {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };

  await check('plateforme linux', () => evaluate('window.sf.platform'));

  await check('enumerateDevices audio', () => evaluate(`(async () => {
    try { await navigator.mediaDevices.getUserMedia({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop())); } catch(e) {}
    const ds = await navigator.mediaDevices.enumerateDevices();
    return ds.filter(d=>d.kind.startsWith('audio')).map(d=>({kind:d.kind,label:d.label||'(sans label)',id:d.deviceId.slice(0,12)}));
  })()`));

  await check('linuxAudioEnsure', () => evaluate('window.sf.linuxAudioEnsure()'));
  await check('linuxAudioStatus', () => evaluate('window.sf.linuxAudioStatus()'));

  // getUserMedia sur chaque source : les monitor sources sont-elles capturables ?
  await check('getUserMedia par device audioinput', () => evaluate(`(async () => {
    const ds = await navigator.mediaDevices.enumerateDevices();
    const ins = ds.filter(d=>d.kind==='audioinput');
    const out = [];
    for (const d of ins) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:d.deviceId}}});
        const t = s.getAudioTracks()[0];
        const st = t.getSettings();
        out.push({label:d.label||'(sans label)', ok:true, ch:st.channelCount, rate:st.sampleRate});
        s.getTracks().forEach(t=>t.stop());
      } catch(e) { out.push({label:d.label||'(sans label)', ok:false, err:String(e&&e.name||e)}); }
    }
    return out;
  })()`));

  // Lecture vers le sink cable + capture du monitor : niveau mesure des deux cotes.
  await check('play->sink + monitor capture (niveau)', () => evaluate(`(async () => {
    const ds = await navigator.mediaDevices.enumerateDevices();
    const cableOut = ds.find(d=>d.kind==='audiooutput' && /soundfart/i.test(d.label||''));
    const cableMon = ds.find(d=>d.kind==='audioinput' && /soundfart/i.test(d.label||''));
    if (!cableOut) return {err:'sink soundfart_cable absent des sorties'};
    const ctx = new AudioContext({sampleRate:48000});
    if (ctx.setSinkId) await ctx.setSinkId(cableOut.deviceId);
    // capture du monitor en parallele
    let monRms = null, monErr = null;
    let monCtx = null, analyser = null, srcNode = null;
    if (cableMon) {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:cableMon.deviceId}, echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
        monCtx = new AudioContext();
        srcNode = monCtx.createMediaStreamSource(ms);
        analyser = monCtx.createAnalyser(); analyser.fftSize = 2048;
        srcNode.connect(analyser);
      } catch(e) { monErr = String(e&&e.name||e); }
    }
    const osc = ctx.createOscillator(); osc.frequency.value = 440; osc.type='sine';
    const g = ctx.createGain(); g.gain.value = 0.5;
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    osc.connect(g); g.connect(an); an.connect(ctx.destination);
    osc.start();
    await new Promise(r=>setTimeout(r,1200));
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum=0; for (const v of buf) sum+=v*v;
    const outRms = Math.sqrt(sum/buf.length);
    let monLevel = null;
    if (analyser) {
      await new Promise(r=>setTimeout(r,300));
      const mb = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(mb);
      let ms2=0; for (const v of mb) ms2+=v*v;
      monLevel = Math.sqrt(ms2/mb.length);
    }
    osc.stop();
    try { ctx.close(); } catch {}
    if (monCtx) { try { monCtx.close(); } catch {} }
    return {sink: cableOut.label, monitor: cableMon ? cableMon.label : null, monErr,
            outRms: +outRms.toFixed(4), monRms: monLevel==null?null:+monLevel.toFixed(4)};
  })()`));

  await check('yt-dlp/ffmpeg outils (linuxAudioStatus déjà fait)', () => evaluate('window.sf.platform'));

  ws.close();
  const fails = results.filter(r=>r[1]==='FAIL').length;
  console.log('\\n=== ' + (results.length-fails) + '/' + results.length + ' PASS ===');
  process.exit(fails?1:0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
