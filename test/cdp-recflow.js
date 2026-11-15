// Test CDP de la regression V2 enregistreur : micro seul -> stop ->
// askDestDir -> "Ajouter a la bibliotheque" -> son jouable.
// Usage : SoundFart.exe --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-recflow.js
const DBG = 'http://127.0.0.1:9222';

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(DBG + '/json')).json();
      const page = list.find((t) => t.type === 'page' && /index\.html$/.test(t.url));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
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
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

const FLOW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const modalBtns = () => [...document.querySelectorAll('#modal-root button')].map((b) => b.textContent);
  const clickBtn = (re) => {
    const bs = [...document.querySelectorAll('#modal-root button')];
    const b = bs.find((x) => re.test(x.textContent));
    if (b) { b.click(); return b.textContent; }
    return null;
  };
  // 1. modale enregistreur
  recorderModal();
  await sleep(1000);
  log.push('modal:' + modalBtns().join('|'));
  // micro seul : pcOn/cableOn = checkbox[1] et [2] -> OFF si cochees
  const cbs = [...document.querySelectorAll('#modal-root input[type=checkbox]')];
  cbs.forEach((c, i) => { if (i > 0 && c.checked) c.click(); });
  await sleep(300);
  // 2. demarrer
  log.push('start->' + clickBtn(/Enregistrer/));
  await sleep(4000);
  log.push('apres4s:' + modalBtns().join('|'));
  // 3. arreter
  log.push('stop->' + clickBtn(/Arreter|Arrêter/));
  await sleep(1500);
  // 4. askDestDir -> OK (champ vide = dossier par defaut)
  log.push('dest->' + clickBtn(/^OK$/));
  await sleep(3000);
  log.push('resultat:' + modalBtns().join('|'));
  // 5. ajouter a la bibliotheque
  log.push('add->' + clickBtn(/Ajouter/));
  await sleep(1000);
  const s = cfg.sounds[cfg.sounds.length - 1];
  let playOk = null;
  if (s) { const v = await play(s); playOk = !!v; if (v) stopVoice(v, true); }
  return { log, sounds: cfg.sounds.length, lastName: s ? s.name : null, playOk };
})()`;

(async () => {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await send('Runtime.enable');
  const r = await evaluate(FLOW);
  console.log(JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
