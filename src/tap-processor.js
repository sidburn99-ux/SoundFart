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
      // Garde d'alignement : un chunk impair de floats decalerait
      // DEFINITIVEMENT l'appariement L/R (inversion stereo persistante).
      // Le contrat main garantit 8 octets/frame ; on droppe le reste par securite.
      if (!(e.data instanceof ArrayBuffer) || e.data.byteLength % 8 !== 0) return;
      const inc = new Float32Array(e.data);
      const usable = inc.length - (inc.length % 2);
      for (let i = 0; i < usable; i++) {
        if (this.len >= this.cap - 2) { this.r = (this.r + 2) & (this.cap - 1); this.len -= 2; }
        this.buf[this.w] = inc[i];
        this.w = (this.w + 1) & (this.cap - 1);
        this.len++;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true; // sortie sans canal : rien a remplir
    const n = out[0].length;
    for (let c = 0; c < out.length; c++) out[c].fill(0);
    for (let i = 0; i < n && this.len >= 2; i++) {
      const L = this.buf[this.r];
      const R = this.buf[(this.r + 1) & (this.cap - 1)];
      // Un NaN/Inf dans le PCM (corruption, bug amont) ne doit pas
      // propager de bruit infini dans l'enregistrement.
      out[0][i] = Number.isFinite(L) ? L : 0;
      if (out[1]) out[1][i] = Number.isFinite(R) ? R : 0;
      this.r = (this.r + 2) & (this.cap - 1);
      this.len -= 2;
    }
    return true;
  }
}
registerProcessor('tap-processor', TapProcessor);
