// Test ad hoc : audioTapStart/Stop sous Linux (parec).
const DBG = 'http://127.0.0.1:9222';
(async () => {
  const list = await (await fetch(DBG + '/json')).json();
  const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let idc = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const id = ++idc; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const evl = async (ex) => { const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  console.log('tapStart:', JSON.stringify(await evl('window.sf.audioTapStart()')));
  await new Promise(r => setTimeout(r, 2500));
  console.log('tapStop:', JSON.stringify(await evl('window.sf.audioTapStop()')));
  ws.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
