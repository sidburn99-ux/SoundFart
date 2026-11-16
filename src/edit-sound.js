// ================================================================
// edition d un son
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ edition d'un son
function editSound(s) {
  const nameIn = el('input', { type: 'text', value: s.name, maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name, selected: c.id === s.categoryId })));
  const favChk = el('input', { type: 'checkbox', checked: !!s.favorite });
  const vol = el('input', { type: 'range', min: 0, max: 300, step: 5, value: s.volume });
  const volLbl = el('span', { class: 'vol-val', text: s.volume + '%' });
  vol.addEventListener('input', () => { volLbl.textContent = vol.value + '%'; });

  // ---- raccourci clavier global
  let sc = s.shortcut || '';
  const scBtn = el('button', { text: sc ? fmtAccel(sc) : 'Aucun — cliquer pour définir' });
  const scHint = el('div', { class: 'hint', text: 'Fonctionne même fenêtre minimisée, Discord ou jeu au premier plan. Ex : Ctrl+Alt+Q ou F6.' });
  let scCleanup = () => {};
  scBtn.addEventListener('click', () => {
    scCleanup();
    scBtn.textContent = 'Appuie sur le raccourci… (Échap pour annuler)';
    const disarm = () => {
      window.removeEventListener('keydown', onKey, true);
      scCleanup = () => {};
      scBtn.textContent = sc ? fmtAccel(sc) : 'Aucun — cliquer pour définir';
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { disarm(); return; }
      const acc = buildAccel(e);
      if (!acc) { scHint.textContent = 'Ajoute un modifieur (Ctrl, Alt, Maj) ou utilise une touche F.'; return; }
      const owner = findShortcutOwner(acc, s.id);
      if (owner) { scHint.textContent = 'Ce raccourci est déjà utilisé par ' + owner + '.'; return; }
      sc = acc;
      scBtn.textContent = fmtAccel(acc);
      scHint.textContent = '';
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    scCleanup = disarm;
  });

  // ---- normalisation
  let norm = s.norm ?? 1;
  const normVal = el('span', { class: 'vol-val', text: '×' + norm });
  const normBtn = el('button', { text: 'Normaliser ce son', onclick: async () => {
    try {
      norm = await computeNorm(s.path);
      normVal.textContent = '×' + norm;
      toast(`Volume normalisé : ×${norm}.`);
    } catch (e) { logErr('computeNorm', e); toast('Impossible d\'analyser ce fichier.', 'warn'); }
  } });

  // ---- decoupage non destructif (le fichier d'origine n'est jamais modifie)
  let dur = 0, peaks = null, drag = null, dragMoved = false, downX = 0, downT = 0;
  let pvVoice = null, pvPos = null;
  let ts = s.trimStart || 0;
  let te = s.trimEnd ?? 0;
  const canvas = el('canvas', { class: 'wave', height: 96 });
  const startIn = el('input', { type: 'number', min: 0, step: 0.01, value: ts.toFixed(2) });
  const endIn = el('input', { type: 'number', min: 0, step: 0.01, value: '' });
  const fiIn = el('input', { type: 'number', min: 0, max: 5000, step: 50, value: s.fadeIn || 0 });
  const foIn = el('input', { type: 'number', min: 0, max: 5000, step: 50, value: s.fadeOut || 0 });
  const info = el('div', { class: 'hint', text: "Chargement de l'onde…" });
  const outStart = () => (ts > 0.005 ? ts : 0);
  const outEnd = () => (dur ? (te < dur - 0.005 ? te : null) : (s.trimEnd ?? null));

  function sync() {
    startIn.value = ts.toFixed(2);
    endIn.value = dur ? te.toFixed(2) : '';
    if (dur) info.textContent = `Durée jouée : ${(te - ts).toFixed(2)} s sur ${dur.toFixed(2)} s`;
  }
  function draw() {
    const w = canvas.width, h = canvas.height, g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!peaks) return;
    const x0 = (ts / dur) * w, x1 = (te / dur) * w, n = peaks.length, bw = w / n;
    g.fillStyle = 'rgba(139,92,246,.18)';
    g.fillRect(x0, 0, x1 - x0, h);
    for (let i = 0; i < n; i++) {
      const x = i * bw;
      g.fillStyle = x >= x0 - bw && x <= x1 ? '#c4a8ff' : '#4a4870';
      const ph = Math.max(2, peaks[i] * h * 0.9);
      g.fillRect(x, (h - ph) / 2, Math.max(1, bw - 1), ph);
    }
    g.fillStyle = '#ec4899';
    g.fillRect(x0 - 1, 0, 3, h);
    g.fillRect(x1 - 2, 0, 3, h);
    if (pvPos != null && dur) {
      const xp = Math.min(w - 1, Math.max(0, (pvPos / dur) * w));
      g.fillStyle = '#ffffff';
      g.fillRect(xp - 1, 0, 2, h);
      g.beginPath();
      g.moveTo(xp - 5, 0); g.lineTo(xp + 5, 0); g.lineTo(xp, 7);
      g.closePath(); g.fill();
    }
  }
  const timeAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur)); };
  const applyMarker = (t) => {
    if (drag === 'start') ts = Math.min(t, te - 0.05); else te = Math.max(t, ts + 0.05);
    sync(); draw();
  };
  const move = (e) => {
    if (!drag || !dur) return;
    if (Math.abs(e.clientX - downX) > 6) dragMoved = true;
    applyMarker(timeAt(e));
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!dur) return;
    const t = timeAt(e);
    drag = Math.abs(t - ts) <= Math.abs(t - te) ? 'start' : 'end';
    dragMoved = false;
    downX = e.clientX;
    downT = t;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!dragMoved) {
      if (pvVoice) seekPreview(downT);
      else applyMarker(downT);
    }
    drag = null;
  });
  startIn.addEventListener('change', () => { if (dur) { ts = Math.min(Math.max(0, +startIn.value || 0), te - 0.05); sync(); draw(); } });
  endIn.addEventListener('change', () => { if (dur) { te = Math.max(Math.min(dur, +endIn.value || dur), ts + 0.05); sync(); draw(); } });

  const loadWave = () => getBuffer(s.path).then((buf) => {
    dur = buf.duration;
    const ch = buf.getChannelData(0);
    const N = 300, step = Math.max(1, Math.floor(ch.length / N));
    peaks = new Float32Array(N);
    let mx = 1e-4;
    // Borne le cout : sans stride, un fichier tres long (des heures)
    // faisait une boucle sur des centaines de millions d'echantillons
    // et gelait le renderer le temps du scan.
    const innerStride = Math.max(1, Math.ceil(step / 2000));
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let j = i * step, e = Math.min(ch.length, (i + 1) * step); j < e; j += innerStride) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      peaks[i] = m;
      if (m > mx) mx = m;
    }
    for (let i = 0; i < N; i++) peaks[i] /= mx;
    te = s.trimEnd ? Math.min(s.trimEnd, dur) : dur;
    ts = Math.min(s.trimStart || 0, te - 0.05);
    sync(); draw();
  }).catch(() => { info.textContent = 'Onde indisponible (fichier introuvable ou illisible).'; });
  loadWave();

  const pvTime = el('div', { class: 'hint pvtime' });
  let pvToken = 0;
  const stopPreview = () => {
    if (pvVoice) { const v = pvVoice; pvVoice = null; stopVoice(v, true); }
    pvPos = null; pvTime.textContent = ''; draw();
  };
  const startPreview = async (from) => {
    const tok = ++pvToken;
    stopPreview();
    const v = await play(s, {
      monitorOnly: true, preview: true,
      volume: +vol.value,
      trimStart: from ?? outStart(),
      trimEnd: outEnd(),
      fadeIn: Math.min(5000, Math.max(0, +fiIn.value || 0)), fadeOut: Math.min(5000, Math.max(0, +foIn.value || 0)),
      onProgress: (frac, absPos, regionDur, regionStart) => {
        if (frac == null) { pvPos = null; pvTime.textContent = ''; draw(); return; }
        pvPos = absPos;
        pvTime.textContent = fmtTime(absPos - regionStart) + ' / ' + fmtTime(regionDur);
        draw();
      },
    });
    if (tok !== pvToken) { if (v) stopVoice(v, true); return; }
    pvVoice = v && voices.has(v) ? v : null;
  };
  function seekPreview(t) {
    if (!dur || !pvVoice) return;
    startPreview(Math.min(Math.max(t, ts + 0.02), te - 0.02));
  }
  const preview = () => startPreview();
  const reset = () => { ts = 0; te = dur; fiIn.value = 0; foIn.value = 0; sync(); draw(); };
  // Applique les editions en cours au modele : partage entre « Enregistrer »
  // et l'export MP3 (qui rouvre l'editeur — sans ca les edits etaient perdus).
  const collectEdits = () => {
    s.name = nameIn.value.trim() || s.name;
    s.volume = +vol.value;
    s.categoryId = catSel.value || null;
    s.favorite = favChk.checked;
    s.shortcut = sc || null;
    s.norm = norm;
    s.trimStart = outStart();
    s.trimEnd = outEnd();
    // max=5000 est une indication UI : une saisie manuelle peut la
    // depasser — borner a la meme valeur pour ne pas stocker d'aberration.
    s.fadeIn = Math.min(5000, Math.max(0, +fiIn.value || 0));
    s.fadeOut = Math.min(5000, Math.max(0, +foIn.value || 0));
  };
  let exportBusy = false; // anti double-clic : N mediaCut concurrents + N confirmBox

  const scClear = el('button', { class: 'ghost', text: 'Effacer', onclick: () => { sc = ''; scBtn.textContent = 'Aucun — cliquer pour définir'; scHint.textContent = ''; } });
  const times = el('div', { class: 'times' },
    el('label', { text: 'Début (s)', title: 'Le son ne jouera qu\'à partir de cet instant. Le fichier d\'origine n\'est jamais modifié.' }), startIn,
    el('label', { text: 'Fin (s)', title: 'Le son s\'arrêtera à cet instant. Vide = jusqu\'à la fin du fichier.' }), endIn,
    el('label', { text: 'Fondu d\'entrée (ms)', title: 'Le volume monte progressivement de 0 au niveau normal sur cette durée.' }), fiIn,
    el('label', { text: 'Fondu de sortie (ms)', title: 'Le volume redescend à 0 sur cette durée avant la fin du son.' }), foIn);

  modal('Modifier le son', [
    field('Nom', nameIn),
    field('Catégorie', catSel),
    field('Favori', el('label', { class: 'check' }, favChk,
      el('span', { text: 'Visible dans la catégorie ★ Favoris, en haut de la barre latérale.' }))),
    field('Volume de ce son', el('div', { class: 'row' }, vol, volLbl),
      '100 % = volume d\'origine. Au-delà, le son est amplifié (un limiteur évite la saturation).'),
    field('Normalisation', el('div', { class: 'row' }, normBtn, normVal),
      `Ajuste le volume du son vers la loudness cible des réglages (${normLufsTarget()} LUFS) sans toucher au fichier. ×1 = inchangé.`),
    field('Raccourci clavier global', el('div', { class: 'row' }, scBtn, scClear), scHint),
    field('Découper (début / fin) et fondus', el('div', { class: 'trim' }, canvas, pvTime, info, times),
      'Glisse les repères roses sur l\'onde ou tape les temps. Clique sur l\'onde pendant l\'écoute pour déplacer la tête de lecture. Le fichier original n\'est jamais modifié.'),
    el('div', { class: 'row' },
      el('button', { text: '▶ Écouter (casque)', onclick: preview }),
      el('button', { text: 'MP3 de l\'extrait', title: 'Crée un petit fichier MP3 contenant uniquement l\'extrait choisi (ffmpeg est téléchargé au premier usage)', onclick: async () => {
        if (exportBusy) return;
        if (!dur) { toast('Attend le chargement de l\'onde.', 'warn'); return; }
        exportBusy = true;
        try {
          const out = await window.sf.mediaCut({ input: s.path, start: outStart(), end: outEnd() ?? dur, dir: cfg.settings.storageDir || '' });
          if (typeof out !== 'string' || !out) throw new Error('réponse media:cut invalide');
          // confirmBox DETRUIT cette modale (slot unique) : on persiste les
          // edits courants d'abord (collectEdits : les champs saisis, pas
          // seulement trim/fades), puis on rouvre l'editeur apres la decision
          // — sinon les modifications non enregistrees etaient perdues sans
          // avertissement et le code continuait sur des elements detaches.
          collectEdits(); save();
          if (await confirmBox('Extrait MP3 créé', 'Fichier : ' + out + '\n\nL\'utiliser à la place du fichier actuel ? La découpe et les fondus seront réinitialisés (le MP3 contient déjà l\'extrait).', 'Utiliser')) {
            const oldPath = s.path;
            s.path = out;
            cacheDelete(oldPath);
            s.trimStart = 0; s.trimEnd = null; s.fadeIn = 0; s.fadeOut = 0;
            save(); renderAll();
            toast('Fichier remplacé par l\'extrait MP3.');
          } else {
            toast('MP3 créé : ' + out);
          }
          editSound(s); // rouvre l'editeur (la modale a ete detruite par confirmBox)
        } catch (e) { toast('Export impossible : ' + e.message, 'warn'); }
        finally { exportBusy = false; }
      } }),
      el('button', { text: 'Tout réinitialiser', onclick: reset }),
      el('button', { text: 'Ouvrir l\'emplacement', onclick: () => window.sf.reveal(s.path).catch((e) => logErr('reveal', e)) })),
    field('Fichier', el('div', { class: 'path hint', text: s.path })),
  ], [
    { label: 'Annuler', onclick: (c) => c() },
    { label: 'Enregistrer', kind: 'primary', onclick: (c) => {
      collectEdits();
      save(); renderAll(); c();
      applyShortcuts();
    } },
  ], { wide: true, onClose: () => { pvToken++; stopPreview(); scCleanup(); } });
  requestAnimationFrame(() => { canvas.width = canvas.clientWidth || 600; draw(); });
}
