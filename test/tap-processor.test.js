// Tests du TapProcessor (AudioWorklet) avec stubs AudioWorkletProcessor.
// Couvre : alignement 8 octets, buffer circulaire borne, flush, drop des
// frames anciennes, garde sortie sans canal, filtrage NaN/Inf.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadProcessor() {
  let Cls = null;
  const sandbox = {
    AudioWorkletProcessor: class {
      constructor() { this.port = { onmessage: null }; }
    },
    registerProcessor: (name, c) => { Cls = c; },
    Float32Array, ArrayBuffer, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'tap-processor.js'), 'utf8'), sandbox);
  return Cls;
}

const f32 = (x) => Math.fround(x);
const frame = (l, r) => {
  const b = new ArrayBuffer(8);
  const f = new Float32Array(b);
  f[0] = l; f[1] = r;
  return b;
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function makeProc(Cls) {
  const p = new Cls();
  return { p, send: (ab) => p.port.onmessage({ data: ab }) };
}

test('tap-processor : flux stereo contigu L/R', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  send(frame(0.1, 0.2));
  send(frame(0.3, 0.4));
  const outs = [[new Float32Array(2), new Float32Array(2)]];
  p.process([], outs);
  const [L, R] = outs[0];
  assert.ok(close(L[0], f32(0.1)) && close(L[1], f32(0.3)));
  assert.ok(close(R[0], f32(0.2)) && close(R[1], f32(0.4)));
});

test('tap-processor : chunk non multiple de 8 octets ignore (alignement)', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  send(frame(0.5, 0.6));
  send(new ArrayBuffer(12)); // 1.5 frame -> drope
  send(frame(0.7, 0.8));
  const outs = [[new Float32Array(2), new Float32Array(2)]];
  p.process([], outs);
  const [L, R] = outs[0];
  assert.ok(close(L[0], f32(0.5)) && close(L[1], f32(0.7)));
  assert.ok(close(R[0], f32(0.6)) && close(R[1], f32(0.8)));
});

test('tap-processor : flush vide le buffer', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  send(frame(0.9, 0.9));
  p.port.onmessage({ data: 'flush' });
  const outs = [[new Float32Array(2), new Float32Array(2)]];
  p.process([], outs);
  assert.deepEqual([...outs[0][0]], [0, 0]);
});

test('tap-processor : buffer sature -> frames anciennes jetees, pas de blocage', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  const capFrames = (1 << 19) / 2; // floats / 2 par frame
  const chunk = new ArrayBuffer(8 * 1024); // 1024 frames
  const f = new Float32Array(chunk);
  for (let i = 0; i < f.length; i++) f[i] = 1;
  for (let i = 0; i < Math.ceil((capFrames * 2) / 1024); i++) send(chunk);
  const outs = [[new Float32Array(4), new Float32Array(4)]];
  p.process([], outs);
  assert.equal(p.len % 2, 0); // len toujours pair (frames)
  assert.ok(p.len <= (1 << 19) - 2, 'len borne par cap-2');
});

test('tap-processor : sortie sans canal -> pas de crash, retourne true', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  send(frame(0.1, 0.2));
  assert.equal(p.process([], []), true);
  assert.equal(p.process([], [[new Float32Array(0)]]), true);
});

test('tap-processor : NaN/Inf dans le PCM -> 0 en sortie', () => {
  const Cls = loadProcessor();
  const { p, send } = makeProc(Cls);
  const b = new ArrayBuffer(16); // 2 frames
  const f = new Float32Array(b);
  f[0] = NaN; f[1] = Infinity; f[2] = 0.3; f[3] = -0.4;
  send(b);
  const outs = [[new Float32Array(2), new Float32Array(2)]];
  p.process([], outs);
  const [L, R] = outs[0];
  assert.equal(L[0], 0);
  assert.equal(R[0], 0);
  assert.ok(close(L[1], f32(0.3)));
  assert.ok(close(R[1], f32(-0.4)));
});
