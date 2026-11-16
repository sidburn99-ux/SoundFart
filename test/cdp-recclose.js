// Test CDP : fermer la modale enregistreur PENDANT une prise ->
// pas de son ajoute, pas de fichier resultado, sources arretees.
// Usage : SoundFart.exe --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-recclose.js
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
  if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
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
  const n0 = cfg.sounds.length;
  // micro seul
  recorderModal();
  await sleep(1000);
  const cbs = [...document.querySelectorAll('#modal-root input[type=checkbox]')];
  cbs.forEach((c, i) => { if (i > 0 && c.checked) c.click(); });
  await sleep(300);
  log.push('start->' + clickBtn(/Enregistrer/));
  await sleep(3000); // 3 s de prise
  // fermer la modale PENDANT l'enregistrement (croix / Fermer / Echap)
  log.push('close->' + (clickBtn(/Fermer|Annuler/) || 'Echap'));
  if (!document.querySelector('#modal-root')) { /* rien */ }
  await sleep(2500); // laisser le onstop/onclose finir
  log.push('modalApres:' + (document.querySelector('#modal-root') ? modalBtns().join('|') : 'FERMEE'));
  log.push('sounds:' + n0 + '->' + cfg.sounds.length);
  // verif : aucune modale « Enregistrement termine » ne doit apparaitre
  const titre = document.querySelector('#modal-root .modal-title, #modal-root h2, #modal-root h3');
  log.push('titreModal:' + (titre ? titre.textContent : 'aucune'));
  // micro eteint ? verifier via getUserMedia state impossible — on verifie
  // qu'aucun MediaRecorder ne tourne : heuristique = pas de nouvelle modale
  // resultat et sounds inchange. Egalement verifier qu'un 2e recorderModal
  // s'ouvre proprement (sources liberees).
  recorderModal();
  await sleep(800);
  log.push('reopen:' + modalBtns().join('|'));
  clickBtn(/Fermer|Annuler/);
  await sleep(300);
  return { log, sounds: cfg.sounds.length };
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
