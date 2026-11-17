// Sonde endurance : activite audio periodique + echantillonnage heap/CDP.
// Usage : lancer l'app avec --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-soak.js <dureeSecondes>   (defaut 300)
// Chaque round (~20 s) joue 3 sons, stopAll, checkMissing, renderGrid et
// releve performance.memory.usedJSHeapSize + bufCacheBytes + etat des
// AudioContexts. Aucune ecriture ; utile pour VALIDATION.md (session
// longue, detection de fuite heap / SF-REL-0611).
// DBG surchargeable via env CDP_PORT si besoin.
const DBG = 'http://127.0.0.1:' + (process.env.CDP_PORT || 9222);
const DUREE = +(process.argv[2] || 300);
async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(DBG + '/json')).json();
      const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('page introuvable');
}
let idc = 0; const pending = new Map(); let ws;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idc; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}
(async () => {
  const page = await getTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); } };
  await send('Runtime.enable');
  console.log('debut soak', DUREE, 's');
  const t0 = Date.now();
  let round = 0;
  while (Date.now() - t0 < DUREE * 1000) {
    round++;
    // Activite : jouer 3 sons + checkMissing + renderGrid
    const r = await ev(`(async()=>{
      const m = performance.memory;
      const heap = m ? Math.round(m.usedJSHeapSize/1048576) : null;
      try {
        const snds = cfg.sounds.slice(0,3);
        for (const s of snds) play(s);
        await new Promise(r=>setTimeout(r,400));
        stopAll(true);
        await checkMissing();
        renderGrid();
      } catch(e){ return {heap, err:String(e&&e.message||e)}; }
      return {heap, sons: cfg.sounds.length, voix: voices.size, cacheMo: Math.round(bufCacheBytes/1048576), ctx: audio.cable?audio.cable.ctx.state+'/'+audio.mon.ctx.state : 'none'};
    })()`);
    console.log('t+' + Math.round((Date.now()-t0)/1000) + 's', JSON.stringify(r));
    await new Promise(r => setTimeout(r, 20000));
  }
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
