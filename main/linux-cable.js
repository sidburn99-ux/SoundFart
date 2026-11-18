'use strict';
// Câble virtuel Linux : null-sink PulseAudio/PipeWire via pactl.
// Équivalent de VB-CABLE : le sink 'soundfart_cable' reçoit la sortie
// Discord de SoundFart ; sa source '.monitor' est choisie comme micro
// dans Discord. Idempotent : un sink existant est réutilisé, jamais
// dupliqué. Le sink est CONSERVÉ entre les lancements — on ne touche
// jamais au module d'un autre processus, donc pas de déchargement.
//
// Bascule micro (équivalent Linux d'AudioEndpoint.exe) : la source par
// défaut PulseAudio passe sur <sink>.monitor pour que Discord — qui suit
// la source par défaut — capte le mix sons+micro. Marqueur JSON + guard
// détaché (shell) pour restauration même après crash, comme audio-restore.
const fs = require('fs');
function createLinuxCable(deps) {
  const { log, execFileTracked, H } = deps;
  // platform injectable pour les tests (defaut : plateforme reelle).
  const IS_LINUX = (deps.platform || process.platform) === 'linux';
  const SINK_NAME = 'soundfart_cable';
  // Description SANS espace ni guillemets : les args module de pactl sont
  // tokenises sur les espaces et les quotes sont passees litteralement au
  // parseur de proprietes PA -> « Module initialization failed » (teste sous
  // PulseAudio 17 / WSLg). « SoundFart-Cable » matche toujours /soundfart/i.
  const SINK_DESC = 'SoundFart-Cable';

  const pactl = (args, timeout) =>
    execFileTracked('pactl', args, { timeout: timeout || 10000 });

  // ENOENT = pactl absent ; sinon on propage l'extrait stderr de pactl
  // (exit N : ...) pour ne pas déguiser un load-module en « serveur KO ».
  const pactlErr = (e) => {
    if (e && e.code === 'ENOENT') {
      return 'pactl introuvable — installez pulseaudio-utils ou pipewire-pulse';
    }
    const base = 'serveur audio injoignable (PulseAudio/PipeWire)';
    const detail = e && e.message
      ? String(e.message).replace(/^exit \d+ :\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 160)
      : '';
    return detail ? base + ' — ' + detail : base;
  };

  // Noms de sinks/sources : 'pactl list short X' -> lignes "idx\tname\t…".
  async function names(kind) {
    const out = await pactl(['list', 'short', kind]);
    return new Set(
      ((out && out.stdout) || '').split(/\r?\n/)
        .map((l) => l.split('\t')[1])
        .filter(Boolean)
    );
  }

  async function status() {
    if (!IS_LINUX) return { linux: false, pactl: false, server: false, sink: false, monitor: false };
    const st = { linux: true, pactl: false, server: false, sink: false, monitor: false };
    try {
      await pactl(['info']);
      st.pactl = st.server = true;
    } catch (e) {
      st.error = pactlErr(e);
      log('[linux-cable] status: ' + st.error);
      return st;
    }
    try {
      const [sinks, sources] = await Promise.all([names('sinks'), names('sources')]);
      st.sink = sinks.has(SINK_NAME);
      st.monitor = sources.has(SINK_NAME + '.monitor');
    } catch (e) {
      st.error = pactlErr(e);
    }
    log('[linux-cable] status: ' + JSON.stringify(st));
    return st;
  }

  // Single-flight : un seul ensure en cours, les appels suivants
  // partagent la même promesse (anti double-création).
  let flight = null;
  async function ensure() {
    if (!IS_LINUX) return { ok: false, error: 'réservé à Linux' };
    if (flight) return flight;
    flight = doEnsure().finally(() => { flight = null; });
    return flight;
  }

  async function doEnsure() {
    try {
      await pactl(['info']);
      const sinks = await names('sinks');
      if (sinks.has(SINK_NAME)) return { ok: true, created: false };
      await pactl([
        'load-module', 'module-null-sink',
        'sink_name=' + SINK_NAME,
        'sink_properties=device.description=' + SINK_DESC,
      ], 20000);
      log('[linux-cable] null-sink créé : ' + SINK_NAME);
      return { ok: true, created: true };
    } catch (e) {
      const error = pactlErr(e);
      log('[linux-cable] ensure KO : ' + error + ' (' + (e && e.message) + ')');
      return { ok: false, error };
    }
  }

  // ---------- bascule micro : source par défaut -> <sink>.monitor ----------
  const MONITOR = () => SINK_NAME + '.monitor';
  const markerFile = () => (deps.markerFile ? deps.markerFile() : null);
  const myPid = () => (deps.pid != null ? deps.pid : process.pid);

  function readMarker() {
    const f = markerFile();
    if (!f) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; }
  }
  function writeMarker(obj) {
    const f = markerFile();
    if (!f) return;
    try {
      const t = f + '.tmp';
      fs.writeFileSync(t, JSON.stringify(obj));
      fs.renameSync(t, f);
    } catch (e) { log('[linux-cable] marqueur: ' + e.message, 'warn'); }
  }
  function clearMarker() {
    const f = markerFile();
    if (!f) return;
    try { fs.unlinkSync(f); } catch {}
  }

  async function defaultSource() {
    const out = await pactl(['get-default-source']);
    return String((out && out.stdout) || '').trim() || null;
  }
  const setDefaultSource = (name) => pactl(['set-default-source', String(name)], 10000);

  // Garde externe : si l'app meurt sans restauration (kill, crash), le
  // guard détaché (sh) attend la mort du parent puis rend la source
  // d'origine — même rôle que 'AudioEndpoint guard' sous Windows.
  const guardPids = new Set();
  function spawnGuard(source) {
    if (!deps.spawn || !source) return;
    const script = 'while kill -0 "$1" 2>/dev/null; do sleep 2; done; pactl set-default-source "$2" 2>/dev/null';
    try {
      const g = deps.spawn('sh', ['-c', script, 'sf-linux-mic-guard', String(myPid()), source],
        { detached: true, stdio: 'ignore' });
      if (g.pid) {
        guardPids.add(g.pid);
        g.on('exit', () => guardPids.delete(g.pid));
        g.on('error', () => guardPids.delete(g.pid));
      }
      g.on('error', (e) => log('[linux-cable] guard: ' + (e && e.message), 'warn'));
      g.unref();
    } catch (e) { log('[linux-cable] guard spawn: ' + e.message, 'warn'); }
  }
  function killGuards() {
    for (const pid of guardPids) { try { process.kill(pid); } catch {} }
    guardPids.clear();
  }

  // Restauration : remet la source mémorisée puis consomme le marqueur.
  // Retourne true si une restauration a été faite.
  async function restore() {
    const m = readMarker();
    if (!m) return false;
    killGuards();
    if (m.source) {
      try { await setDefaultSource(m.source); log('[linux-cable] source micro restaurée -> ' + m.source); }
      catch (e) { log('[linux-cable] restore: ' + pactlErr(e), 'warn'); }
    }
    clearMarker();
    return true;
  }
  // Variante synchrone pour will-quit/uncaughtException (pas d'await possible).
  function restoreSync() {
    const m = readMarker();
    if (!m) return false;
    killGuards();
    if (m.source && deps.execFileSync) {
      try { deps.execFileSync('pactl', ['set-default-source', String(m.source)], { timeout: 3000 }); }
      catch (e) { log('[linux-cable] restoreSync: ' + (e && e.message), 'warn'); }
    }
    clearMarker();
    return true;
  }

  // Bascule : enabled=true -> source par défaut = monitor du câble ;
  // enabled=false -> restauration si marqueur présent.
  // Sémantique alignée sur autoSetupImpl Windows (changed/stuckCable).
  async function switchMic(enabled) {
    if (!IS_LINUX) return { ok: false, err: 'réservé à Linux' };
    try {
      await pactl(['info']);
      if (!enabled) {
        const did = await restore();
        return { ok: true, changed: did };
      }
      const st = await ensure();
      if (!st.ok) return { ok: false, err: st.error || 'câble Linux indisponible' };
      const mon = MONITOR();
      const srcs = await names('sources');
      if (!srcs.has(mon)) return { ok: false, err: 'monitor du câble absent : ' + mon };
      const cur = await defaultSource();
      if (cur === mon) {
        const m = readMarker();
        if (!m) {
          // Déjà sur le monitor sans marqueur : état coincé d'une session
          // morte (comme stuckCable Windows) — le renderer proposera la
          // réparation via audio:restore force.
          return { ok: true, changed: false, device: mon, stuckCable: true };
        }
        if (m.owner !== myPid()) {
          // Marqueur d'une session morte : on l'adopte et on respawn un
          // guard pour ce pid (sinon kill -> micro coincé sur le monitor).
          try { writeMarker({ ...m, owner: myPid() }); spawnGuard(m.source); } catch {}
        }
        return { ok: true, changed: false, device: mon };
      }
      // État incohérent éventuel : un marqueur orphelin est restauré avant
      // de mémoriser la nouvelle source (priorité au retour propre).
      if (readMarker()) await restore();
      writeMarker({ source: cur || '', owner: myPid() });
      await setDefaultSource(mon);
      spawnGuard(readMarker() && readMarker().source);
      log('[linux-cable] source micro basculée -> ' + mon + ' (était ' + (cur || '?') + ')');
      return { ok: true, changed: true, device: mon };
    } catch (e) {
      return { ok: false, err: pactlErr(e) };
    }
  }

  // Force sans marqueur : la source par défaut est coincée sur le monitor
  // (crash session précédente) — on la rebascule sur la 1re source non
  // câble/non-monitor. Réparation explicite demandée par l'utilisateur,
  // jamais automatique (même règle que chooseRestoreIds Windows).
  async function forceOffCable() {
    const cur = await defaultSource();
    if (cur !== MONITOR()) return { ok: true, changed: false };
    const srcs = await names('sources');
    const fb = [...srcs].find((n) => n && n !== MONITOR() && !/\.monitor$/.test(n) && !/soundfart/i.test(n));
    if (!fb) return { ok: false, err: 'aucune source micro non-câble trouvée' };
    await setDefaultSource(fb);
    log('[linux-cable] force : source micro débloquée -> ' + fb);
    return { ok: true, changed: true, device: fb };
  }

  H('linux:audioStatus', () => status());
  H('linux:ensureCable', () => ensure());
  return { status, ensure, switchMic, restore, restoreSync, forceOffCable, defaultSource, hasMarker: () => !!readMarker(), SINK_NAME, SINK_DESC, MONITOR };
}

module.exports = { createLinuxCable };
if (require.main === module) {
  // Test manuel : node main/linux-cable.js status|ensure
  const fakeExec = (bin, args) => new Promise((res, rej) => {
    require('child_process').execFile(bin, args, { timeout: 8000 },
      (err, stdout, stderr) => err ? rej(Object.assign(new Error((stderr || err.message).trim()), { code: err.code })) : res({ stdout, stderr }));
  });
  const fakeH = () => {};
  const c = createLinuxCable({ log: console.log, execFileTracked: fakeExec, H: fakeH });
  const cmd = process.argv[2] || 'status';
  c[cmd]().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e); process.exit(1); });
}
