// Re-test ciblé : devices après création du sink + capture monitor.
const DBG = 'http://127.0.0.1:9222';
async function getTarget() {
  const list = await (await fetch(DBG + '/json')).json();
  return list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
}
let idc = 0; const pending = new Map(); let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idc; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
(async () => {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  // force re-enum devices
  console.log('refreshDevices:', JSON.stringify(await evaluate('typeof refreshDevices === "function" ? (refreshDevices(), "ok") : "absent"')));
  await new Promise(r=>setTimeout(r,1500));
  console.log('devices:', JSON.stringify(await evaluate(`(async()=>{const ds=await navigator.mediaDevices.enumerateDevices();return ds.filter(d=>d.kind.startsWith('audio')).map(d=>d.kind+':'+(d.label||'(blank)'));})()`), null, 1));
  console.log('status:', JSON.stringify(await evaluate('window.sf.linuxAudioStatus()')));
  ws.close(); process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
