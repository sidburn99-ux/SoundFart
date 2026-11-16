// One-off : valider le chemin MediaRecorder micro via CDP.
// getUserMedia({audio}) -> MediaRecorder 1.5 s -> blob -> decodeAudioData
// -> niveau RMS non nul. Valide permission media, micro reel, encodage.
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
      const st = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const track = st.getAudioTracks()[0];
      const label = track ? track.label : '';
      const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'';
      const rec = new MediaRecorder(st, mime?{mimeType:mime}:undefined);
      const chunks=[]; rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      const done = new Promise(r=>{rec.onstop=()=>r(new Blob(chunks,{type:mime||'audio/webm'}))});
      rec.start(); await new Promise(r=>setTimeout(r,1500)); rec.stop();
      const blob = await done;
      st.getTracks().forEach(t=>t.stop());
      // decode + RMS
      const ab = await blob.arrayBuffer();
      const ac = new OfflineAudioContext(1,44100,44100);
      const buf = await ac.decodeAudioData(ab.slice(0));
      const d = buf.getChannelData(0);
      let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]*d[i];
      const rms = Math.sqrt(sum/d.length);
      let peak=0; for(let i=0;i<d.length;i+=7){const a=Math.abs(d[i]); if(a>peak)peak=a;}
      return {ok:true, mime:blob.type||mime, bytes:blob.size, dur:buf.duration.toFixed(2), rms:+rms.toExponential(2), peak:+peak.toFixed(3), label:label.slice(0,60), tracks:st.getAudioTracks().length};
    }catch(e){ return {ok:false, err:String(e&&e.name||'')+': '+String(e&&e.message||e).slice(0,200)}; }
  })()`);
  console.log('mediaRecorder =>', JSON.stringify(out));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
