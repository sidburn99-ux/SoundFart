'use strict';
// Câble virtuel Linux : null-sink PulseAudio/PipeWire via pactl.
// Équivalent de VB-CABLE : le sink 'soundfart_cable' reçoit la sortie
// Discord de SoundFart ; sa source '.monitor' est choisie comme micro
// dans Discord. Idempotent : un sink existant est réutilisé, jamais
// dupliqué. Le sink est CONSERVÉ entre les lancements — on ne touche
// jamais au module d'un autre processus, donc pas de déchargement.
function createLinuxCable(deps) {
  const { log, execFileTracked, H } = deps;
  // platform injectable pour les tests (defaut : plateforme reelle).
  const IS_LINUX = (deps.platform || process.platform) === 'linux';
  const SINK_NAME = 'soundfart_cable';
  const SINK_DESC = 'SoundFart Cable';

  const pactl = (args, timeout) =>
    execFileTracked('pactl', args, { timeout: timeout || 10000 });

  // ENOENT = pactl absent ; code de sortie != 0 = serveur injoignable.
  const pactlErr = (e) =>
    (e && e.code === 'ENOENT')
      ? 'pactl introuvable — installez pulseaudio-utils ou pipewire-pulse'
      : 'serveur audio injoignable (PulseAudio/PipeWire)';

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

  H('linux:audioStatus', () => status());
  H('linux:ensureCable', () => ensure());
  return { status, ensure, SINK_NAME, SINK_DESC };
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
