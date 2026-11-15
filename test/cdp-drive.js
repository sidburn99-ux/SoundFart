// Driver CDP pour validation runtime SoundFart (Quality Gate V2).
// Usage : lancer dist\SoundFart.exe --test-profile --remote-debugging-port=9222
//         puis : node test/cdp-drive.js
// Se connecte au renderer via Chrome DevTools Protocol et evalue du JS
// dans le contexte de la page (fonctions globales d'app.js + window.sf).
// Aucun fichier modifie ; les seuls effets de bord sont ceux des APIs
// legitimately appelees (rec:save ecrit dans userData/recordings).

const DBG = 'http://127.0.0.1:9222';

async function getTarget() {
  for (let i = 0; i < 30; i++) {
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
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idc;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000,
  });
  if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}

const results = [];
async function check(name, fn) {
  try {
    const v = await fn();
    results.push([name, 'PASS', JSON.stringify(v)]);
    console.log('PASS', name, '=>', JSON.stringify(v));
  } catch (e) {
    results.push([name, 'FAIL', String(e && e.message || e)]);
    console.log('FAIL', name, '=>', String(e && e.message || e));
  }
}

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
  await send('Runtime.enable');

  await check('contexte page (sf, play, cfg)', () => evaluate(
    '({sf:!!window.sf, play:typeof play, cfgSounds:(typeof cfg!=="undefined"&&cfg?cfg.sounds.length:-1)})'));

  await check('etat AudioContext sorties', () => evaluate(
    '({cable:audio.cable?audio.cable.ctx.state:null, mon:audio.mon?audio.mon.ctx.state:null, cableDev:(audio.cable&&audio.cable.deviceId||"").slice(0,12), monDev:(audio.mon&&audio.mon.deviceId||"").slice(0,12)})'));

  await check('file:check fichier absent', () => evaluate(
    'window.sf.checkFiles(["Z:\\\\definitely-not-here-12345.mp3"])'));

  await check('rec:save runtime (writeRecording via IPC)', async () => {
    const p = await evaluate(
      'window.sf.saveRecording({data:new Uint8Array([82,73,70,70,1,2,3,4]).buffer,name:"cdp-runtime-"+Date.now(),ext:".webm",dir:""})');
    return { path: p };
  });

  await check('rec:save rejet donnees nulles (contrat erreur)', () => evaluate(
    `window.sf.saveRecording({data:null,name:"x",ext:".webm",dir:""}).then(()=>"no-throw").catch(e=>String(e&&e.message||e).slice(0,80))`));

  await check('lecture son reel + voix/stopAll', async () => {
    const v = await evaluate('(async()=>{const s=(typeof cfg!=="undefined"&&cfg.sounds||[]).find(x=>/\\.mp3$/i.test(x.path||""))||((typeof cfg!=="undefined"&&cfg.sounds)||[])[0];if(!s)return{skip:"aucun son"};const voice=await play(s);await new Promise(r=>setTimeout(r,1200));const st={voice:!!voice,nodes:voice?voice.nodes.length:0,voices:voices.size,cable:audio.cable?audio.cable.ctx.state:null,mon:audio.mon?audio.mon.ctx.state:null};stopAll(true);await new Promise(r=>setTimeout(r,300));st.voicesAfter=voices.size;return st;})()');
    return v;
  });

  await check('yt:info URL invalide (chemin erreur)', () => evaluate(
    `window.sf.ytInfo("pas-une-url").then(()=>"no-throw").catch(e=>String(e&&e.message||e).slice(0,100))`));

  // ---- batch 2 : cycle de vie config / audio / fichiers ----
  await check('config save/load roundtrip', async () => {
    const before = await evaluate('cfg.sounds.length');
    await evaluate('window.sf.saveConfig(cfg)');
    const loaded = await evaluate('window.sf.loadConfig()');
    return { before, loadedSounds: loaded && loaded.sounds ? loaded.sounds.length : null };
  });

  await check('applyAudio re-run (recreate contexts)', async () => {
    const r = await evaluate('(async()=>{try{await applyAudio();return{ok:true,cable:audio.cable?audio.cable.ctx.state:null,mon:audio.mon?audio.mon.ctx.state:null};}catch(e){return{ok:false,err:String(e&&e.message||e).slice(0,120)};}})()');
    return r;
  });

  await check('file:check sons reels (5 premiers)', () => evaluate(
    'window.sf.checkFiles((cfg.sounds||[]).slice(0,5).map(s=>s.path))'));

  await check('teardownAudio + applyAudio (cycle complet)', async () => {
    const r = await evaluate('(async()=>{try{await teardownAudio();const torn={cable:audio.cable,mon:audio.mon,mic:!!audio.micStream};await applyAudio();return{torn:{cableNull:torn.cable===null,monNull:torn.mon===null,micNull:!torn.mic},cable:audio.cable?audio.cable.ctx.state:null,mon:audio.mon?audio.mon.ctx.state:null};}catch(e){return{err:String(e&&e.message||e).slice(0,150)};}})()');
    return r;
  });

  await check('stopAll idle-safe', () => evaluate(
    '(async()=>{stopAll(true);return voices.size;})()'));

  console.log('---RESULTATS---');
  for (const [n, s, d] of results) console.log(s, n, d);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('DRIVER-FAIL', e); process.exit(1); });
