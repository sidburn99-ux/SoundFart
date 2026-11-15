// Test CDP : enregistrement multi-sources (micro + PC + cable) avec un son
// joue pendant la prise, puis decode du fichier sauvegarde -> RMS mesure.
// Prouve objectivement que les sources captent du signal (pas juste un fichier).
// Usage : SoundFart.exe --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-recmix.js
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

const WANT = process.argv[2] || 'all';
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
  // son a jouer pendant la prise (source cable)
  const snd = cfg.sounds.find((s) => s.path && /\\.(wav|mp3|ogg|webm|m4a)$/i.test(s.path)) || cfg.sounds[0];
  // 1. modale enregistreur, les 3 sources ON
  recorderModal();
  await sleep(1000);
  // sources : argv[2] = 'mic' | 'pc' | 'cable' | 'all' (defaut 'all')
  const want = '${WANT}';
  const cbs = [...document.querySelectorAll('#modal-root input[type=checkbox]')];
  // ordre : micOn, pcOn, cableOn
  const order = ['mic', 'pc', 'cable'];
  cbs.forEach((c, i) => {
    const on = want === 'all' || order[i] === want;
    if (c.checked !== on) c.click();
  });
  await sleep(300);
  // 2. demarrer
  log.push('start->' + clickBtn(/Enregistrer/));
  await sleep(1500); // laisser les sources s'initialiser
  // 3. jouer un son pendant la prise (sortie cable -> source cableOn)
  const v = snd ? await play({ ...snd, preview: true }) : null;
  log.push('play->' + !!v);
  await sleep(4000);
  if (v) stopVoice(v, true);
  // 4. arreter -> askDestDir -> OK
  log.push('stop->' + clickBtn(/Arreter|Arrêter/));
  await sleep(1500);
  log.push('dest->' + clickBtn(/^OK$/));
  await sleep(3000);
  log.push('resultat:' + modalBtns().join('|'));
  // 5. ajouter a la bibliotheque
  log.push('add->' + clickBtn(/Ajouter/));
  await sleep(800);
  const added = cfg.sounds[cfg.sounds.length - 1];
  const path = added ? added.path : null;
  // 6. lire + decoder le fichier sauvegarde -> RMS par fenetre
  let meas = null;
  if (path) {
    try {
      const raw = await window.sf.readFile(path);
      const u8 = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer || raw);
      const abuf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const ab = await actx.decodeAudioData(abuf);
      const data = ab.getChannelData(0);
      let sum = 0, peak = 0, nz = 0;
      for (let i = 0; i < data.length; i += 16) { const a = Math.abs(data[i]); sum += a * a; if (a > peak) peak = a; if (a > 0.001) nz++; }
      const n = Math.ceil(data.length / 16);
      meas = { dur: +ab.duration.toFixed(2), ch: ab.numberOfChannels, rms: +Math.sqrt(sum / n).toFixed(4), peak: +peak.toFixed(4), nonzeroPct: +(100 * nz / n).toFixed(1), bytes: u8.byteLength };
      actx.close().catch(() => {});
    } catch (e) { meas = { err: String(e && e.message || e) }; }
  }
  // nettoyage : retirer le son ajoute
  if (added && /^Enregistrement/.test(added.name)) { removeSound(added); await sleep(400); const b = [...document.querySelectorAll('#modal-root button')].find((x) => /Retirer|Supprimer|Oui|Confirmer/.test(x.textContent)); if (b) { b.click(); await sleep(400); } }
  return { log, path, meas, sounds: cfg.sounds.length };
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
