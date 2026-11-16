// ================================================================
// normalisation LUFS
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ normalisation
// Mesure 100 % JS (SFUtils.loudnessFromPcm, coefficients BS.1770 exacts
// valides contre ffmpeg ebur128 a ~0,05 LU) : aucun outil externe, l'app
// reste portable. True Peak : pas d'interpolation — le pic echantillon
// SOUS-estime le pic reel d'environ 1 dB, d'ou le plafond a -1 dBFS.
async function measureForNorm(path) {
  const buf = await getBuffer(path);
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const lufs = window.SFUtils.loudnessFromPcm(chs, buf.sampleRate);
  let peak = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  return {
    lufs,
    truePeakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
  };
}

function normLufsTarget() {
  const v = +cfg.settings.normLufs;
  return (Number.isFinite(v) && v <= 0 && v >= -40) ? v : -18;
}

// Gain = ecart de loudness, plafonne par le True Peak (normGain, lib) :
// un son dense ne doit jamais etre amplifie au point de depasser le
// plafond en pic interpolate — le limiteur aval n'est pas une protection
// True Peak. null -> 1 (silence ou mesure impossible : on ne touche pas).
async function computeNorm(path) {
  const m = await measureForNorm(path);
  const g = window.SFUtils.normGain({ lufs: m.lufs, truePeakDb: m.truePeakDb, targetLufs: normLufsTarget() });
  return g == null ? 1 : g;
}

// host fourni (panneau reglages) : la progression s'affiche EN LIGNE et le
// panneau reste ouvert — l'utilisateur peut cliquer « Appliquer » ou changer
// d'autres reglages pendant la normalisation. Sans host : modale dediee.
async function normalizeAll(host) {
  const targets = cfg.sounds.filter((s) => !missing.has(s.id));
  if (!targets.length) { toast('Aucun son à normaliser.', 'warn'); return; }
  const lufs = normLufsTarget();
  const prog = el('div', { class: 'hint', text: `0 / ${targets.length}` });
  const hint = el('div', { class: 'hint', text: `La loudness de chaque son est ramenée à ${lufs} LUFS. Ça peut prendre un moment sur une grosse bibliothèque.` });
  let done = 0, failed = 0, cancelled = false, closeP = () => {};
  if (host) {
    const cancelBtn = el('button', { class: 'ghost', text: 'Annuler', onclick: () => { cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = 'Annulation…'; } });
    host.replaceChildren(prog, hint, el('div', { class: 'row' }, cancelBtn));
  } else {
    closeP = modal('Normalisation de la bibliothèque', [prog, hint], [{ label: 'Fermer', onclick: (c) => c() }], { onClose: () => { cancelled = true; } });
  }
  for (const s of targets) {
    if (cancelled) break;
    prog.textContent = `${done + 1} / ${targets.length} — ${s.name || 'son'}`;
    try { s.norm = await computeNorm(s.path); } catch (e) { failed++; logErr('computeNorm', e); /* garder s.norm : un echec ne doit pas effacer un reglage perso */ }
    prog.textContent = `${++done} / ${targets.length}`;
    await new Promise((r) => setTimeout(r, 0));
  }
  const msg = `Normalisation terminée : ${done - failed} son(s) ajusté(s)` + (failed ? `, ${failed} ignoré(s)` : '') + (cancelled ? ' (annulée)' : '') + '.';
  save(); closeP();
  if (host) host.replaceChildren(el('div', { class: 'hint', text: msg }));
  renderAll();
  toast(msg);
}

// Test de la cible loudness : 1,2 s de bruit rose dont la loudness est
// mesuree puis ramenee exactement au LUFS saisi — joue UNIQUEMENT sur
// l'ecoute locale, jamais sur le cable Discord (tes potes n'ont pas a
// entendre le test).
async function testNormLufs(targetLufs) {
  const out = audio.mon;
  if (!out) { toast('Choisis d\'abord une « écoute locale » dans les réglages.', 'warn'); return; }
  try {
    const ctx = out.ctx;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const target = Number.isFinite(+targetLufs) ? Math.min(0, Math.max(-40, +targetLufs)) : normLufsTarget();
    const dur = 1.2, n = Math.floor(dur * ctx.sampleRate);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Bruit rose approxime (filtre passe-bas) : plus representatif qu'une sine.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      const pink = b0 + b1 + b2 + w * 0.1848;
      const env = Math.min(1, i / (0.01 * ctx.sampleRate), (n - i) / (0.05 * ctx.sampleRate));
      d[i] = pink * env;
    }
    const L = window.SFUtils.loudnessFromPcm([buf.getChannelData(0)], ctx.sampleRate);
    if (Number.isFinite(L)) {
      // Gain borne x4 comme la normalisation : au-dela le signal
      // s'ecrêterait et la loudness percue ne correspondrait plus.
      const k = Math.min(4, Math.pow(10, (target - L) / 20));
      for (let i = 0; i < n; i++) d[i] *= k;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g); g.connect(out.bus);
    src.onended = () => { try { g.disconnect(); } catch {} };
    src.start();
    toast('Test : loudness ' + target + ' LUFS — écouté sur « ' + (cfg.settings.monLabel || 'écoute locale') + ' » uniquement.');
  } catch (e) { logErr('testNormLufs', e); toast('Test impossible : ' + (e && e.message || e), 'warn'); }
}
