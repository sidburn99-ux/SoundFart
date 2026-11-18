// Mesure du signal PCM par source : snapshot -> (lecture externe)
// -> snapshot. Usage : node cdp-linux-tap-measure.js <label>
const DBG = 'http://127.0.0.1:9222';
const label = process.argv[2] || 'run';
(async () => {
  const list = await (await fetch(DBG + '/json')).json();
  const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let idc = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const id = ++idc; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const evl = async (ex) => { const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };

  if (label === 'init') {
    console.log('tapStart:', JSON.stringify(await evl(`window.sf.audioTapStart(['system','cable'])`)));
    await evl(`window.__sig = {};
      const acc = (src) => (ab) => {
        const s = (window.__sig[src] = window.__sig[src] || { bytes: 0, sum: 0, n: 0 });
        s.bytes += ab.byteLength;
        const f = new Float32Array(ab);
        for (let i = 0; i < f.length; i += 7) { s.sum += Math.abs(f[i]); s.n++; }
      };
      window.sf.onTapPcm(acc('system'));
      window.sf.onTapPcmCable(acc('cable'));
      'ok'`);
    await new Promise((r) => setTimeout(r, 800));
    console.log('init sig:', JSON.stringify(await evl('window.__sig')));
    ws.close(); process.exit(0);
  }
  if (label === 'snap') {
    const s = await evl('window.__sig');
    console.log(JSON.stringify(s));
    ws.close(); process.exit(0);
  }
  ws.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
