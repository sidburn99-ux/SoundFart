// Tests loudness/normalisation : parse ebur128, calcul du gain, True
// Peak, migration config, et SURTOUT la justesse de loudnessFromPcm
// comparee a ffmpeg ebur128 (reference EBU R128) quand il est dispo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('../lib/audio-utils.js');

// ---------- parseEbur128 ----------
const FFMPEG_SUMMARY = `
[Parsed_ebur128_0 @ 0000] t: 1.999979   TARGET:-23 LUFS    M: -21.1 S:-120.7     I: -21.1 LUFS       LRA:   0.0 LU  FTPK: -18.1 dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0000] Summary:

  Integrated loudness:
    I:         -21.1 LUFS
    Threshold: -31.1 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold:   0.0 LUFS
    LRA low:     0.0 LUFS
    LRA high:    0.0 LUFS

  True peak:
    Peak:      -18.1 dBFS
`;

test('parseEbur128 : resume ffmpeg -> lufs + truePeakDb', () => {
  const m = U.parseEbur128(FFMPEG_SUMMARY);
  assert.equal(m.lufs, -21.1);
  assert.equal(m.truePeakDb, -18.1);
});

test('parseEbur128 : -inf et sortie vide', () => {
  const sil = U.parseEbur128('Integrated loudness:\n    I:         -inf LUFS\n\n  True peak:\n    Peak:       -inf dBFS\n');
  assert.equal(sil.lufs, -Infinity);
  assert.equal(sil.truePeakDb, -Infinity);
  const empty = U.parseEbur128('');
  assert.equal(empty.lufs, null);
  assert.equal(empty.truePeakDb, null);
});

// ---------- normGain ----------
test('normGain : ramene la loudness a la cible', () => {
  // -30 LUFS -> -18 = +12 LU = x3.98
  const g = U.normGain({ lufs: -30, truePeakDb: -40, targetLufs: -18 });
  assert.ok(Math.abs(g - 3.98) < 0.02, 'gain ' + g);
});

test('normGain : le True Peak borne le gain', () => {
  // loudness voudrait x4 (plafond) mais TP a -0.2 dBFS -> gain max -0.8 dB = x0.91
  const g = U.normGain({ lufs: -60, truePeakDb: -0.2, targetLufs: -18, tpCeilDb: -1 });
  assert.ok(g < 1 && g > 0.85, 'gain ' + g);
});

test('normGain : plafond x4 et silence', () => {
  assert.equal(U.normGain({ lufs: -80, truePeakDb: -60, targetLufs: -18 }), 4);
  assert.equal(U.normGain({ lufs: -Infinity, truePeakDb: -Infinity }), null);
  assert.equal(U.normGain({}), null);
});

test('normGain : l arrondi ne depasse jamais le plafond TP', () => {
  // Cas ou round() classical depasserait : on floor au centieme.
  const g = U.normGain({ lufs: -19.5, truePeakDb: -0.05, targetLufs: -18, tpCeilDb: -1 });
  const tpGain = Math.pow(10, (-1 - (-0.05)) / 20);
  assert.ok(g <= tpGain + 1e-9, `g=${g} tpGain=${tpGain}`);
});

// ---------- isPreLufsConfig (migration) ----------
test('normGain : null/undefined ne devient pas 0 dBFS invente', () => {
  // +null === 0 : sans garde, un truePeakDb null plafonnait a x0.89.
  const g = U.normGain({ lufs: -30, truePeakDb: null, targetLufs: -18 });
  assert.ok(Math.abs(g - 3.98) < 0.02, 'gain ' + g);
  assert.equal(U.normGain({ lufs: null, truePeakDb: -20 }), null);
});

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

// ---------- reference croisee ffmpeg ebur128 ----------
function findFfmpeg() {
  const cands = [process.env.FFMPEG_PATH, process.env.SOUNDFART_FFMPEG,
    'C:\\Users\\Sidbu\\AppData\\Local\\Temp\\SoundFart-test\\tools\\ffmpeg\\ffmpeg.exe',
    'ffmpeg'];
  for (const c of cands) {
    if (!c) continue;
    const r = spawnSync(c, ['-version'], { encoding: 'utf8', timeout: 10000 });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
const FFMPEG = findFfmpeg();

// Ecrit un WAV PCM16 mono/stereo et renvoie le chemin.
function writeWav(file, channels, sr = SR) {
  const nch = channels.length, n = channels[0].length;
  const dataSize = n * nch * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nch, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * nch * 2, 28); buf.writeUInt16LE(nch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    buf.writeInt16LE(Math.round(v * 32767), o); o += 2;
  }
  fs.writeFileSync(file, buf);
  return file;
}
function ffmpegLufs(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vn', '-sn', '-dn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  return U.parseEbur128(String(r.stderr || '') + String(r.stdout || ''));
}

test('loudnessFromPcm vs ffmpeg ebur128 : sine 1 kHz stereo 2 s', { skip: !FFMPEG && 'ffmpeg absent' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-loud-'));
  const f = writeWav(path.join(dir, 'sine.wav'), sine(1000, 2, 0.5));
  const ref = ffmpegLufs(f);
  assert.ok(Number.isFinite(ref.lufs), 'ffmpeg I: ' + ref.lufs);
  const js = U.loudnessFromPcm(sine(1000, 2, 0.5), SR);
  assert.ok(Math.abs(js - ref.lufs) < 0.5, `js=${js} ffmpeg=${ref.lufs}`);
});

test('loudnessFromPcm vs ffmpeg ebur128 : bruit blanc stereo 2 s', { skip: !FFMPEG && 'ffmpeg absent' }, () => {
  const ch = noise(2, 0.3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-loud-'));
  const f = writeWav(path.join(dir, 'noise.wav'), ch);
  const ref = ffmpegLufs(f);
  assert.ok(Number.isFinite(ref.lufs), 'ffmpeg I: ' + ref.lufs);
  const js = U.loudnessFromPcm(ch, SR);
  assert.ok(Math.abs(js - ref.lufs) < 0.5, `js=${js} ffmpeg=${ref.lufs}`);
});

test('loudnessFromPcm vs ffmpeg ebur128 : signal module (silence + transitoire)', { skip: !FFMPEG && 'ffmpeg absent' }, () => {
  // 1 s silence + 1 s sine : teste le gating (le silence ne doit pas compter)
  const n = SR;
  const mk = (fill) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = fill(i); return [d, d.slice()]; };
  const ch = mk((i) => (i < SR / 2 ? 0 : 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-loud-'));
  const f = writeWav(path.join(dir, 'gate.wav'), ch);
  const ref = ffmpegLufs(f);
  assert.ok(Number.isFinite(ref.lufs), 'ffmpeg I: ' + ref.lufs);
  const js = U.loudnessFromPcm(ch, SR);
  assert.ok(Math.abs(js - ref.lufs) < 0.5, `js=${js} ffmpeg=${ref.lufs}`);
});
