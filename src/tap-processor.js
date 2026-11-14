// Recoit du PCM float32 stereo 48 kHz (interleave L,R, 8 octets/frame) envoye par
// AudioTap via main.js ('sf:tapPcm') et le reinjecte dans le graphe de l'enregistreur.
// Buffer circulaire de ~5,5 s : si la source sature, on jette les frames les plus
// anciennes plutot que de bloquer le thread audio.
class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 19; // 524288 floats = 262144 frames stereo 48 kHz (~5,5 s de marge)
    this.buf = new Float32Array(this.cap);
    this.r = 0; this.w = 0; this.len = 0;
    this.port.onmessage = (e) => {
      // 'flush' : vide le buffer circulaire (appele juste avant rec.start pour
      // eliminer le pre-roll capture pendant la preparation des sources).
      if (e.data === 'flush') { this.r = 0; this.w = 0; this.len = 0; return; }
      const inc = new Float32Array(e.data);
      for (let i = 0; i < inc.length; i++) {
        if (this.len >= this.cap - 2) { this.r = (this.r + 2) & (this.cap - 1); this.len -= 2; }
        this.buf[this.w] = inc[i];
        this.w = (this.w + 1) & (this.cap - 1);
        this.len++;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const n = out[0] ? out[0].length : 128;
    for (let c = 0; c < out.length; c++) out[c].fill(0);
    for (let i = 0; i < n && this.len >= 2; i++) {
      out[0][i] = this.buf[this.r];
      if (out[1]) out[1][i] = this.buf[(this.r + 1) & (this.cap - 1)];
      this.r = (this.r + 2) & (this.cap - 1);
      this.len -= 2;
    }
    return true;
  }
}
registerProcessor('tap-processor', TapProcessor);
