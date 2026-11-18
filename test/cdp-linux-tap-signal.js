// Test : tap multi-sources Linux — mesure du SIGNAL (somme |float32|)
// sur chaque canal pendant qu'on joue un sinus sur chaque sink.
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

  // Accumulateur : octets + somme |echantillon| par canal
  await evl(`window.__sig = {};
    const acc = (src) => (ab) => {
      const s = (window.__sig[src] = window.__sig[src] || { bytes: 0, sum: 0, n: 0 });
      s.bytes += ab.byteLength;
      const f = new Float32Array(ab);
      for (let i = 0; i < f.length; i += 7) { s.sum += Math.abs(f[i]); s.n++; } // echantillonne
    };
    window.sf.onTapPcm(acc('system'));
    window.sf.onTapPcmCable(acc('cable'));
    'ok'`);

  console.log('tapStart:', JSON.stringify(await evl(`window.sf.audioTapStart(['system','cable'])`)));
  await new Promise((r) => setTimeout(r, 1000));
  const before = await evl('window.__sig');
  console.log('avant lecture:', JSON.stringify(before));

  // Lecture externe : sinus 440Hz sur chaque sink (3 s)
  // lancee cote WSL entre les deux releves
  ws.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
