// One-off : valide yt:ensure (telechargement yt-dlp epingle + SHA-256) en runtime.
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
    const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true, timeout: 300000 });
    const res = r.result;
    if (res && res.exceptionDetails) return 'EXC:' + JSON.stringify(res.exceptionDetails).slice(0, 300);
    return res && res.result ? res.result.value : res;
  };
  const out = await ev('window.sf.ytEnsure().then(r=>({ok:true,r})).catch(e=>({ok:false,err:String(e&&e.message||e).slice(0,300)}))');
  console.log('ytEnsure =>', JSON.stringify(out));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
