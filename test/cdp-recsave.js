// One-off : rec:save avec audio REEL — boucle VB-CABLE -> MediaRecorder ->
// blob -> window.sf.saveRecording -> verifier persistance + taille.
const DBG = 'http://127.0.0.1:9222';
const CABLE_ID = 'dc79ff6520d98fc2604604daf1166f1d4d2c5ca181fa67997ec9ee8631e17899';
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
      const actx = new AudioContext();
      if(actx.setSinkId) await actx.setSinkId('${CABLE_ID}');
      const osc = actx.createOscillator(); osc.frequency.value=440;
      const g = actx.createGain(); g.gain.value=0.4;
      osc.connect(g).connect(actx.destination); osc.start();
      const st = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const rec = new MediaRecorder(st);
      const chunks=[]; rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      const done = new Promise(r=>{rec.onstop=()=>r(new Blob(chunks,{type:'audio/webm'}))});
      await new Promise(r=>setTimeout(r,300));
      rec.start(); await new Promise(r=>setTimeout(r,1500)); rec.stop();
      const blob = await done;
      osc.stop(); actx.close(); st.getTracks().forEach(t=>t.stop());
      const ab = await blob.arrayBuffer();
      // rec:save via preload
      const saved = await window.sf.saveRecording({data: ab, name:'cable-loop-test', ext:'webm', dir:''});
      return {ok:true, blobBytes:blob.size, saved: saved};
    }catch(e){ return {ok:false, err:String(e&&e.name||'')+': '+String(e&&e.message||e).slice(0,250)}; }
  })()`);
  console.log('recSaveReal =>', JSON.stringify(out));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
