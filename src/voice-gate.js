// Voice gate : reduction de bruit sur la VOIX uniquement (chemin micro ->
// limiteur). Les sons de la soundboard ne passent jamais par ce noeud.
//
// Chain : highpass ~80 Hz (ronflements, vibrations de table) puis downward
// expander : sous le seuil, le gain descend vers 0 avec release lent —
// le souffle/respiration entre les mots est attenue, la parole passe.
// Les contraintes getUserMedia (echoCancellation, noiseSuppression,
// autoGainControl) restent actives en amont : ce noeud complete, ne remplace pas.
//
// Parametres conservateurs : seuil -50 dBFS, expansion complete mais a
// temporisation lente — un seuil plus haut coupait les attaques douces.

class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.thr = typeof o.threshold === 'number' ? o.threshold : 0.003; // ~-50 dBFS
    this.floor = typeof o.floor === 'number' ? o.floor : 0;           // gain min sous le seuil
    // Coefficients d'attack/release en "par sample" : attack rapide pour
    // laisser passer les consonnes, release lent pour ne pas hacher.
    const sr = sampleRate;
    this.atkC = Math.exp(-1 / (Math.max(0.001, o.attack || 0.008) * sr));
    this.relC = Math.exp(-1 / (Math.max(0.01, o.release || 0.25) * sr));
    this.env = 0;
    this.g = 1;
    // Highpass one-pole : y = x - xPrev + r*yPrev, r ~ 0.99 -> ~76 Hz a 48 kHz.
    this.r = typeof o.highpass === 'number' ? o.highpass : 0.99;
    this.xPrev = [];
    this.yPrev = [];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const nCh = Math.min(input.length, output.length);
    const n = input[0].length;
    for (let c = 0; c < nCh; c++) {
      const inp = input[c], out = output[c];
      if (this.xPrev.length <= c) { this.xPrev.push(0); this.yPrev.push(0); }
      let xp = this.xPrev[c], yp = this.yPrev[c];
      for (let i = 0; i < n; i++) {
        const x = inp[i];
        // highpass one-pole
        const y = x - xp + this.r * yp;
        xp = x; yp = y;
        // enveloppe pic (canal 0 pour la detection — mono compatible)
        if (c === 0) {
          const a = Math.abs(y);
          this.env = a > this.env ? a : this.env * this.relC;
          const target = this.env > this.thr ? 1 : this.floor;
          const coef = target > this.g ? this.atkC : this.relC;
          this.g += (target - this.g) * (1 - coef);
        }
        out[i] = y * this.g;
      }
      this.xPrev[c] = xp; this.yPrev[c] = yp;
    }
    return true;
  }
}

registerProcessor('voice-gate', VoiceGateProcessor);
