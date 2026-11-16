// Verification du panneau Paramètres (style Discord) via CDP.
// Usage : SoundFart.exe --test-profile --remote-debugging-port=9222 puis node test/cdp-settings.js
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
  throw new Error('page introuvable');
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

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}

(async () => {
  const page = await getTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
  };

  // Ouvre le panneau Paramètres
  await evalJs('settingsModal(); "opened"');
  await new Promise((r) => setTimeout(r, 400));

  const info = await evalJs(`(() => {
    const nav = document.querySelector('.set-nav');
    const panes = [...document.querySelectorAll('.set-pane')];
    const btns = [...document.querySelectorAll('.set-nav button')];
    const modal = document.querySelector('.modal.settings');
    return {
      modalClass: modal ? modal.className : null,
      modalW: modal ? modal.offsetWidth : 0,
      navCats: [...document.querySelectorAll('.set-nav-cat')].map((e) => e.textContent),
      navBtns: btns.map((b) => b.textContent),
      panes: panes.length,
      paneTitles: panes.map((p) => p.querySelector('h3') && p.querySelector('h3').textContent),
      visiblePane: panes.findIndex((p) => !p.hidden),
      fieldsInVisible: panes.find((p) => !p.hidden) ? panes.find((p) => !p.hidden).querySelectorAll('.field').length : -1,
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));

  // Clique chaque entrée de nav et vérifie que le bon panneau s'affiche
  const navTest = await evalJs(`(async () => {
    const out = [];
    const btns = [...document.querySelectorAll('.set-nav button')];
    for (const b of btns) {
      b.click();
      await new Promise((r) => setTimeout(r, 60));
      const panes = [...document.querySelectorAll('.set-pane')];
      const vis = panes.findIndex((p) => !p.hidden);
      const title = panes[vis] && panes[vis].querySelector('h3') ? panes[vis].querySelector('h3').textContent : null;
      out.push({ clicked: b.textContent, visibleTitle: title, fields: panes[vis] ? panes[vis].querySelectorAll('.field, .check, canvas, select, input').length : 0 });
    }
    return out;
  })()`);
  console.log(JSON.stringify(navTest, null, 2));

  // Vérifie que « Appliquer » ne plante pas (valeurs conservées)
  const apply = await evalJs(`(async () => {
    const btns = [...document.querySelectorAll('.modal-actions button')];
    const applyBtn = btns.find((b) => /Appliquer/.test(b.textContent));
    if (!applyBtn) return 'no apply btn';
    applyBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    return 'apply clicked, modal closed=' + !document.querySelector('.modal.settings');
  })()`);
  console.log(apply);

  // Orphelins : la modale doit s'ouvrir même vide ou lister les fichiers
  const orphan = await evalJs(`(async () => {
    try {
      await orphanImportsModal();
      await new Promise((r) => setTimeout(r, 500));
      const m = [...document.querySelectorAll('.modal')].pop();
      return m ? m.querySelector('h2').textContent : 'no modal';
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  console.log('orphan modal:', orphan);

  ws.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
