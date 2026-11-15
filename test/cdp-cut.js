// One-off : media:cut de bout en bout — declenche ensureFfmpeg
// (telechargement ffmpeg.zip ~80 Mo + SHA-256 + extraction), puis une
// vraie coupe 0-5 s d'un mp3 existant. Timeout large : download + extract.
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
    const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true, timeout: 600000 });
    const res = r.result;
    if (res && res.exceptionDetails) return 'EXC:' + JSON.stringify(res.exceptionDetails).slice(0, 300);
    return res && res.result ? res.result.value : res;
  };
  // Profil test : premier mp3 existant dans cfg.sounds
  const out = await ev(`(async()=>{
    const s=(cfg.sounds||[]).find(x=>/\\.mp3$/i.test(x.path||""));
    if(!s) return {skip:"aucun mp3"};
    try {
      const r = await window.sf.mediaCut({input:s.path,start:0,end:5,dir:""});
      return {ok:true,out:r};
    } catch(e) { return {ok:false,err:String(e&&e.message||e).slice(0,300)}; }
  })()`);
  console.log('mediaCut =>', JSON.stringify(out));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
