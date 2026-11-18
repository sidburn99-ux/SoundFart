// Test ad hoc : tap multi-sources Linux — 'system' (monitor sink defaut)
// et 'cable' (monitor soundfart_cable) demarrent ensemble, canaux PCM
// separes, comptage d'octets par source.
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

  // Compteurs PCM par canal
  await evl(`window.__pcm = { system: 0, cable: 0 };
    window.sf.onTapPcm((ab) => { window.__pcm.system += ab.byteLength; });
    window.sf.onTapPcmCable((ab) => { window.__pcm.cable += ab.byteLength; });
    'listeners-ok'`);

  console.log('tapStart [system,cable]:', JSON.stringify(await evl(`window.sf.audioTapStart(['system','cable'])`)));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('pcm apres 1.5s (silence):', JSON.stringify(await evl('window.__pcm')));

  // tapStart a nouveau : sources deja actives -> started sans respawn
  console.log('tapStart again:', JSON.stringify(await evl(`window.sf.audioTapStart(['system','cable'])`)));

  console.log('pcm apres 2e start:', JSON.stringify(await evl('window.__pcm')));
  ws.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
