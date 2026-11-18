'use strict';
// Tests unitaires main/linux-cable.js — pactl/execFileTracked mockés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinuxCable } = require('../main/linux-cable');

const ERR_PACTL = 'pactl introuvable — installez pulseaudio-utils ou pipewire-pulse';
const ERR_SERVER = 'serveur audio injoignable (PulseAudio/PipeWire)';

function enoent() {
  const e = new Error('spawn pactl ENOENT');
  e.code = 'ENOENT';
  return e;
}

// execFileTracked mocké : inspecte les args et renvoie {stdout,stderr}.
// `table` : map clé = args.join(' ') -> {stdout,stderr} | Error à lever.
function makeExec(table) {
  const calls = [];
  const fn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const key = (args || []).join(' ');
    const hit = table[key];
    if (!hit) return Promise.resolve({ stdout: '', stderr: '' });
    if (hit instanceof Error) return Promise.reject(hit);
    return Promise.resolve(hit);
  };
  fn.calls = calls;
  return fn;
}

function makeCable(exec, platform) {
  const logs = [];
  const handlers = {};
  const H = (ch, fn) => { handlers[ch] = fn; };
  const cable = createLinuxCable({
    log: (m) => logs.push(m),
    execFileTracked: exec,
    H,
    platform,
  });
  return { cable, logs, handlers };
}

const SINK_LIST = '0\tsoundfart_cable\tmodule-null-sink\ts16le 2ch 48000Hz\n';
const SRC_LIST = '0\tsoundfart_cable.monitor\tmodule-null-sink.c\ts16le 2ch 48000Hz\n';

test('H enregistre les deux canaux IPC', () => {
  const { handlers } = makeCable(makeExec({}), 'linux');
  assert.equal(typeof handlers['linux:audioStatus'], 'function');
  assert.equal(typeof handlers['linux:ensureCable'], 'function');
});

test('win32 : status() retourne tout faux sans appeler pactl', async () => {
  const exec = makeExec({});
  const { cable } = makeCable(exec, 'win32');
  const st = await cable.status();
  assert.deepEqual(st, { linux: false, pactl: false, server: false, sink: false, monitor: false });
  assert.equal(exec.calls.length, 0);
});

test('win32 : ensure() refuse proprement', async () => {
  const exec = makeExec({});
  const { cable } = makeCable(exec, 'win32');
  const r = await cable.ensure();
  assert.deepEqual(r, { ok: false, error: 'réservé à Linux' });
  assert.equal(exec.calls.length, 0);
});

test('linux : status() détecte pactl, serveur, sink et monitor', async () => {
  const exec = makeExec({
    'info': { stdout: 'Server String: /run/user/1000/pulse/native', stderr: '' },
    'list short sinks': { stdout: SINK_LIST, stderr: '' },
    'list short sources': { stdout: SRC_LIST, stderr: '' },
  });
  const { cable } = makeCable(exec, 'linux');
  const st = await cable.status();
  assert.equal(st.linux, true);
  assert.equal(st.pactl, true);
  assert.equal(st.server, true);
  assert.equal(st.sink, true);
  assert.equal(st.monitor, true);
  assert.equal(st.error, undefined);
});

test('linux : status() sans le sink -> sink et monitor faux', async () => {
  const exec = makeExec({
    'info': { stdout: 'ok', stderr: '' },
    'list short sinks': { stdout: '0\talsa_output.pci-0000_00_1f.3.analog-stereo\talsa\t\n', stderr: '' },
    'list short sources': { stdout: '0\ttalsa_input.pci-0000_00_1f.3.analog-stereo\ttalsa\t\n', stderr: '' },
  });
  const { cable } = makeCable(exec, 'linux');
  const st = await cable.status();
  assert.equal(st.pactl, true);
  assert.equal(st.sink, false);
  assert.equal(st.monitor, false);
});

test('linux : status() pactl absent -> ENOENT message + retour anticipé', async () => {
  const exec = makeExec({ 'info': enoent() });
  const { cable, logs } = makeCable(exec, 'linux');
  const st = await cable.status();
  assert.deepEqual(st, { linux: true, pactl: false, server: false, sink: false, monitor: false, error: ERR_PACTL });
  // pas d'appel list après échec de info
  assert.equal(exec.calls.length, 1);
  assert.ok(logs.some((m) => m.includes(ERR_PACTL)));
});

test('linux : status() serveur injoignable -> erreur générique + détail', async () => {
  const exec = makeExec({ 'info': new Error('Connection refused'), });
  const { cable } = makeCable(exec, 'linux');
  const st = await cable.status();
  assert.equal(st.pactl, false);
  assert.equal(st.server, false);
  assert.equal(st.error, ERR_SERVER + ' — Connection refused');
});

test('linux : ensure() crée le null-sink quand absent', async () => {
  const exec = makeExec({
    'info': { stdout: 'ok', stderr: '' },
    'list short sinks': { stdout: '0\talsa_output.analog\ttalsa\t\n', stderr: '' },
    'load-module module-null-sink sink_name=soundfart_cable sink_properties=device.description=SoundFart-Cable':
      { stdout: '123\n', stderr: '' },
  });
  const { cable, logs } = makeCable(exec, 'linux');
  const r = await cable.ensure();
  assert.deepEqual(r, { ok: true, created: true });
  const load = exec.calls.find((c) => c.args[0] === 'load-module');
  assert.ok(load, 'load-module attendu');
  assert.deepEqual(load.args.slice(1), ['module-null-sink', 'sink_name=soundfart_cable', 'sink_properties=device.description=SoundFart-Cable']);
  assert.equal(load.opts.timeout, 20000);
  assert.ok(logs.some((m) => m.includes('null-sink créé')));
});

test('linux : ensure() idempotent si le sink existe déjà', async () => {
  const exec = makeExec({
    'info': { stdout: 'ok', stderr: '' },
    'list short sinks': { stdout: SINK_LIST, stderr: '' },
  });
  const { cable } = makeCable(exec, 'linux');
  const r = await cable.ensure();
  assert.deepEqual(r, { ok: true, created: false });
  assert.ok(!exec.calls.some((c) => c.args[0] === 'load-module'));
});

test('linux : ensure() pactl absent -> erreur lisible', async () => {
  const exec = makeExec({ 'info': enoent() });
  const { cable } = makeCable(exec, 'linux');
  const r = await cable.ensure();
  assert.deepEqual(r, { ok: false, error: ERR_PACTL });
});

test('linux : ensure() single-flight — appels concurrents partagent la promesse', async () => {
  let resolveLoad;
  const gate = new Promise((res) => { resolveLoad = res; });
  const calls = [];
  const exec = (bin, args) => {
    calls.push(args.join(' '));
    const key = args.join(' ');
    if (key === 'info') return Promise.resolve({ stdout: 'ok', stderr: '' });
    if (key === 'list short sinks') return Promise.resolve({ stdout: '', stderr: '' });
    if (key.startsWith('load-module')) return gate.then(() => ({ stdout: '1\n', stderr: '' }));
    return Promise.resolve({ stdout: '', stderr: '' });
  };
  const { cable } = makeCable(exec, 'linux');
  const p1 = cable.ensure();
  const p2 = cable.ensure();
  // ensure() est async : les promesses retournées sont des wrappers
  // distincts, mais ils partagent la même promesse flight interne.
  resolveLoad();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, { ok: true, created: true });
  assert.deepEqual(r2, { ok: true, created: true });
  assert.equal(calls.filter((c) => c.startsWith('load-module')).length, 1);
});
