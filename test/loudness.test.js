// Tests loudness/normalisation : calcul du gain, plafond de pic,
// migration config, et justesse de loudnessFromPcm (BS.1770 en JS pur,
// valide contre ffmpeg ebur128 a ~0,05 LU lors de la revue).
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/audio-utils.js');

// ---------- normGain ----------
test('normGain : ramene la loudness a la cible', () => {
  // -30 LUFS -> -18 = +12 LU = x3.98
  const g = U.normGain({ lufs: -30, truePeakDb: -40, targetLufs: -18 });
  assert.ok(Math.abs(g - 3.98) < 0.02, 'gain ' + g);
});

test('normGain : le plafond de pic borne le gain', () => {
  // loudness voudrait x4 (plafond) mais pic a -0.2 dBFS -> gain max -0.8 dB = x0.91
  const g = U.normGain({ lufs: -60, truePeakDb: -0.2, targetLufs: -18, tpCeilDb: -1 });
  assert.ok(g < 1 && g > 0.85, 'gain ' + g);
});

test('normGain : plafond x4 et silence', () => {
  assert.equal(U.normGain({ lufs: -80, truePeakDb: -60, targetLufs: -18 }), 4);
  assert.equal(U.normGain({ lufs: -Infinity, truePeakDb: -Infinity }), null);
  assert.equal(U.normGain({}), null);
});

test('normGain : l arrondi ne depasse jamais le plafond de pic', () => {
  // Cas ou round() classical depasserait : on floor au centieme.
  const g = U.normGain({ lufs: -19.5, truePeakDb: -0.05, targetLufs: -18, tpCeilDb: -1 });
  const tpGain = Math.pow(10, (-1 - (-0.05)) / 20);
  assert.ok(g <= tpGain + 1e-9, `g=${g} tpGain=${tpGain}`);
});

test('normGain : null/undefined ne devient pas 0 dBFS invente', () => {
  // +null === 0 : sans garde, un truePeakDb null plafonnait a x0.89.
  const g = U.normGain({ lufs: -30, truePeakDb: null, targetLufs: -18 });
  assert.ok(Math.abs(g - 3.98) < 0.02, 'gain ' + g);
  assert.equal(U.normGain({ lufs: null, truePeakDb: -20 }), null);
});

test('normGain : attenuation et cas limites', () => {
  // Son trop fort : gain < 1 (attenue vers la cible)
  const g = U.normGain({ lufs: -10, truePeakDb: -20, targetLufs: -18 });
  assert.ok(g > 0 && g < 1, 'gain ' + g);
  // truePeakDb = +Infinity -> plafond 0 -> null (pas de gain aberrant)
  assert.equal(U.normGain({ lufs: -30, truePeakDb: Infinity, targetLufs: -18 }), null);
  // Parametres personnalises
  const g2 = U.normGain({ lufs: -30, truePeakDb: -40, targetLufs: -18, maxGain: 2 });
  assert.ok(Math.abs(g2 - 2) < 0.02, 'maxGain ' + g2);
});

test('channelWeights : >2 canaux — LFE exclu, surrounds ponderes', () => {
  const w6 = U.channelWeights(6);
  assert.equal(w6.length, 6);
  assert.equal(w6[5], 0, 'LFE (6e canal) doit peser 0');
  assert.ok(Math.abs(w6[3] - 1.41) < 1e-9 && Math.abs(w6[4] - 1.41) < 1e-9, 'surrounds 1.41');
  const w2 = U.channelWeights(2);
  assert.deepEqual(w2, [1, 1]);
});

// ---------- isPreLufsConfig (migration) ----------
test('isPreLufsConfig : v1 et absent = legacy, v2+ = preserve', () => {
  assert.equal(U.isPreLufsConfig(1), true);
  assert.equal(U.isPreLufsConfig(undefined), true);
  assert.equal(U.isPreLufsConfig('1'), true);
  assert.equal(U.isPreLufsConfig(2), false);
  assert.equal(U.isPreLufsConfig(3), false);
});

// ---------- loudnessFromPcm : signaux synthétiques ----------
const SR = 48000;
function sine(freq, dur, amp = 0.5, sr = SR, ch = 2) {
  const n = Math.floor(dur * sr);
  const out = [];
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
    out.push(d);
  }
  return out;
}
function noise(dur, amp = 0.3, sr = SR, ch = 2, seed = 42) {
  const n = Math.floor(dur * sr);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  const out = [];
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = amp * rnd();
    out.push(d);
  }
  return out;
}
function silence(dur, sr = SR, ch = 2) {
  return Array.from({ length: ch }, () => new Float32Array(Math.floor(dur * sr)));
}

test('loudnessFromPcm : silence -> -Infinity', () => {
  assert.equal(U.loudnessFromPcm(silence(2), SR), -Infinity);
  assert.equal(U.loudnessFromPcm([new Float32Array(0)], SR), -Infinity);
});

test('loudnessFromPcm : fichier < 400 ms -> valeur finie (pas de bloc 400 ms)', () => {
  const l = U.loudnessFromPcm(sine(1000, 0.2, 0.5), SR);
  assert.ok(Number.isFinite(l), 'loudness ' + l);
  // Un sine 1 kHz a 0.5 pic : LUFS attendu ~ -15 a -18 (K-weighting boost les aigus)
  assert.ok(l > -30 && l < 0, 'loudness ' + l);
});

test('loudnessFromPcm : mono et stereo coherents', () => {
  const mono = U.loudnessFromPcm(sine(440, 1, 0.5, SR, 1), SR);
  const stereo = U.loudnessFromPcm(sine(440, 1, 0.5, SR, 2), SR);
  // Stereo = 2 canaux de meme signal -> +3 LU environ (somme des energies)
  assert.ok(Math.abs((stereo - mono) - 3) < 1.5, `mono=${mono} stereo=${stereo}`);
});

test('loudnessFromPcm : gating — le silence ne compte pas', () => {
  // 2 s de silence puis 2 s de sine : le niveau doit etre celui du
  // sine seul (portions sous -70 LUFS et -10 LU relatives ecartees).
  const n = SR * 2;
  const mk = (fill) => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = fill(i);
    return [d, d.slice()];
  };
  const gated = U.loudnessFromPcm(mk((i) => (i < n / 2 ? 0 : 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR))), SR);
  const plain = U.loudnessFromPcm(sine(1000, 2, 0.5), SR);
  // Le gating exclut le silence : loudness proche du signal seul
  // (le sine demarre a i=0 de sa propre phase, ecart de phase mineur).
  assert.ok(Math.abs(gated - plain) < 3, `gated=${gated} plain=${plain}`);
});

test('loudnessFromPcm : ordre de grandeur sur bruit et sine', () => {
  // Bornes large mais discriminantes : un RMS ou une echelle lineaire
  // donnerait des valeurs tres differentes.
  const lNoise = U.loudnessFromPcm(noise(2, 0.3), SR);
  const lSine = U.loudnessFromPcm(sine(1000, 2, 0.5), SR);
  assert.ok(lNoise > -30 && lNoise < -5, 'noise ' + lNoise);
  assert.ok(lSine > -30 && lSine < 0, 'sine ' + lSine);
});

// loudnessFromPcmAsync : meme resultat que la version synchrone,
// mais yield toutes les ~2 M frames (UI non gelee sur fichiers longs).
test('loudnessFromPcmAsync : identique a loudnessFromPcm', async () => {
  const sr = 48000, n = sr * 3; // 3 s stéréo
  const mk = (ph) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr + ph); return d; };
  const chs = [mk(0), mk(0.7)];
  const sync = U.loudnessFromPcm(chs, sr);
  const asy = await U.loudnessFromPcmAsync(chs, sr);
  assert.ok(Number.isFinite(sync) && Number.isFinite(asy));
  assert.equal(asy, sync, 'async doit etre bit-identique au synchrone');
  // et sur un buffer avec des tranches multiples (petit chunkForce)
  const asy2 = await U.loudnessFromPcmAsync(chs, sr, 1000);
  assert.equal(asy2, sync, 'avec petit chunk aussi');
});
