// Driver CDP de stress pour chasser SF-REL-0611 (crash renderer AudioContext).
// Usage : lancer dist\SoundFart.exe --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-stress.js [iterations]
// Exerce play/stopAll en rafale, churn de modales, cycles audio, rec:save
// et checkMissing — les chemins les plus gourmands en AudioContext/nodes.
// Si le renderer meurt, evaluate/ws echoue -> CRASH detecte.

const DBG = 'http://127.0.0.1:9222';
const ITERS = parseInt(process.argv[2] || '40', 10);

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(DBG + '/json')).json();
      const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('page index.html introuvable sur ' + DBG);
}

let idc = 0;
const pending = new Map();
let ws;
let wsDead = false;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (wsDead) return reject(new Error('ws mort (renderer probablement crash)'));
    const id = ++idc;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000,
  });
  if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STRESS_JS = `
(async () => {
  const out = {};
  const snds = (cfg.sounds || []).slice(0, 8);
  out.sounds = snds.length;
  // 1. Rafale play/stop : decode + voix + nodes en churn
  for (let i = 0; i < 6; i++) {
    const s = snds[i % Math.max(1, snds.length)];
    if (!s) break;
    play(s).catch(() => {});
    if (i % 2) stopAll(true); else stopAll(false);
    await new Promise(r => setTimeout(r, 120));
  }
  await new Promise(r => setTimeout(r, 800));
  stopAll(true);
  out.voicesAfterBurst = voices.size;
  // 2. Churn de modales (inert/onClose/resolve)
  for (let i = 0; i < 5; i++) {
    modal('stress ' + i, 'corps', [{ label: 'ok', onclick: (c) => c() }]);
    await new Promise(r => setTimeout(r, 60));
    if (modalClose) modalClose();
  }
  out.modalRootChildren = document.getElementById('modal-root').children.length;
  // 3. rec:save burst (writeRecording + IPC)
  for (let i = 0; i < 3; i++) {
    await window.sf.saveRecording({ data: new Uint8Array(64).buffer, name: 'cdp-stress-' + Date.now() + '-' + i, ext: '.webm', dir: '' });
  }
  out.recSaved = true;
  // 4. Etat audio + heap
  out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
  out.cable = audio.cable ? audio.cable.ctx.state : null;
  out.mon = audio.mon ? audio.mon.ctx.state : null;
  return out;
})()`;

const CYCLE_JS = `(async () => {
  try {
    await teardownAudio();
    await applyAudio();
    return { ok: true, cable: audio.cable ? audio.cable.ctx.state : null };
  } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 120) }; }
})()`;

(async () => {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  ws.onclose = () => { wsDead = true; console.log('WS-CLOSED (renderer mort ?)'); };
  await send('Runtime.enable');

  console.log('stress: ' + ITERS + ' iterations sur ' + target.url);
  for (let i = 0; i < ITERS; i++) {
    try {
      const r = await evaluate(STRESS_JS);
      console.log('iter ' + i, JSON.stringify(r));
      // cycle audio complet toutes les 8 iterations
      if (i % 8 === 7) {
        const c = await evaluate(CYCLE_JS);
        console.log('  cycle-audio', JSON.stringify(c));
      }
      await sleep(400);
    } catch (e) {
      console.log('CRASH-OU-ERREUR iter ' + i + ' : ' + String(e && e.message || e).slice(0, 200));
      // verifier si la page est toujours la
      try {
        const list = await (await fetch(DBG + '/json')).json();
        const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
        if (!page) { console.log('PAGE ABSENTE — renderer probablement crash'); break; }
      } catch { console.log('DBG injoignable — renderer mort'); break; }
      await sleep(1000);
    }
  }
  console.log('---FIN STRESS---');
  try { ws.close(); } catch {}
  process.exit(0);
})().catch((e) => { console.error('DRIVER-FAIL', e); process.exit(1); });
