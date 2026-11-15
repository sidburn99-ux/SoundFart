// One-off : AudioTap WASAPI loopback — demarrer le tap, jouer un
// oscillateur sur la sortie par defaut, mesurer le RMS du PCM recu.
const DBG = 'http://127.0.0.1:9222';
(async () => {
  const list = await (await fetch(DBG + '/json')).json();
  const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
  if (!page) { console.log('NO_PAGE'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (ex) => {
    const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true, timeout: 60000 });
    const res = r.result;
    if (res && res.exceptionDetails) return 'EXC:' + JSON.stringify(res.exceptionDetails).slice(0, 400);
    return res && res.result ? res.result.value : res;
  };
  const out = await ev(`(async()=>{
    try{
      const chunks=[];
      const off = window.sf.onTapPcm ? window.sf.onTapPcm((ab)=>{ chunks.push(new Uint8Array(ab)); }) : null;
      const started = await window.sf.audioTapStart();
      await new Promise(r=>setTimeout(r,500));
      // oscillateur sur sortie par defaut (ce que le loopback capte)
      const actx = new AudioContext();
      const osc = actx.createOscillator(); osc.frequency.value=440;
      const g = actx.createGain(); g.gain.value=0.5;
      osc.connect(g).connect(actx.destination); osc.start();
      await new Promise(r=>setTimeout(r,2500));
      osc.stop(); actx.close();
      await window.sf.audioTapStop();
      if(off) off();
      // PCM float32 stereo 48kHz = 8 o/frame ; chunks = Uint8Array
      let sum=0,n=0,peak=0,bytes=0;
      for(const c of chunks){ bytes+=c.length;
        const f = new Float32Array(c.buffer, c.byteOffset, Math.floor(c.length/4));
        for(let i=0;i<f.length;i++){const a=f[i];sum+=a*a;n++;const ar=Math.abs(a);if(ar>peak)peak=ar;}
      }
      const rms = n? Math.sqrt(sum/n) : 0;
      return {ok:true, tapStart:started, chunks:chunks.length, bytes, samples:n, rms:+rms.toExponential(3), peak:+peak.toFixed(3)};
    }catch(e){ try{await window.sf.audioTapStop()}catch(_){} return {ok:false, err:String(e&&e.name||'')+': '+String(e&&e.message||e).slice(0,250)}; }
  })()`);
  console.log('audioTap =>', JSON.stringify(out));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
