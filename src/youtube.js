// ================================================================
// import YouTube
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ import YouTube
const YT_RE = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//;

function youtubeModal() {
  const urlIn = el('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' });
  urlIn.style.flex = '1';
  const infoBox = el('div', { class: 'hint', text: 'Colle un lien YouTube puis « Analyser ».' });
  const startIn = el('input', { type: 'text', placeholder: '0 ou 02:15', value: '0' });
  const endIn = el('input', { type: 'text', placeholder: '13 ou 02:28', value: '' });
  startIn.style.flex = '1'; endIn.style.flex = '1';
  const nameIn = el('input', { type: 'text', placeholder: 'Nom du son (titre par défaut)', maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: 'Sans catégorie' }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name })));
  const prog = el('div', { class: 'hint' });
  const bar = el('div', { class: 'ytbar' }, el('i'));
  const barFill = bar.firstChild;
  // Destination choisie AVANT le telechargement via pickDir natif :
  // askDestDir utilise modal() (slot unique) et detruirait cette modale,
  // rendant la progression invisible et l'echec silencieux (SF-REL-0067).
  let destDir = cfg.settings.lastDestDir || cfg.settings.storageDir || '';
  const destLabel = el('span', { class: 'hint', text: destDir || '(dossier SoundFart par défaut)' });
  const destBtn = el('button', { text: 'Changer…', onclick: async () => {
    try {
      const d = await window.sf.pickDir();
      if (d) { destDir = d; cfg.settings.lastDestDir = d; save(); destLabel.textContent = d; }
    } catch (e) { logErr('pickDir', e); }
  } });

  let info = null, dl = null, offProg = null, busy = false, analyzeBusy = false, analyzedUrl = null;
  const setProg = (p) => {
    if (p === -1 || p == null) { prog.textContent = 'Téléchargement…'; barFill.style.width = '100%'; barFill.style.opacity = '.4'; }
    else { prog.textContent = 'Téléchargement… ' + p + ' %'; barFill.style.opacity = '1'; barFill.style.width = p + '%'; }
  };

  const analyzeBtn = el('button', { text: 'Analyser', onclick: async () => {
    const url = urlIn.value.trim();
    if (!YT_RE.test(url)) { infoBox.textContent = 'Ce lien ne ressemble pas à une URL YouTube.'; return; }
    // Pas d'analyse pendant un telechargement : yt:info emet ytProgress(-1)
    // qui ecraserait la barre du download, et les deux flaky flags
    // shared 'busy' permettaient un double yt:download.
    if (busy || analyzeBusy) return;
    analyzeBusy = true;
    infoBox.textContent = 'Vérification de l\'outil de téléchargement…';
    try {
      if (offProg) offProg(); // un seul ecouteur ytprogress a la fois
      offProg = window.sf.onYtProgress(setProg);
      await window.sf.ytEnsure();
      infoBox.textContent = 'Lecture des infos de la vidéo…';
      info = await window.sf.ytInfo(url);
      analyzedUrl = url;
      infoBox.textContent = `« ${info.title} » — durée ${fmtTime(info.duration)}.`;
      if (!nameIn.value) nameIn.value = String(info.title).slice(0, 80);
      endIn.placeholder = info.duration ? 'Fin (max ' + fmtTime(info.duration) + ')' : 'Fin';
    } catch (e) {
      info = null; analyzedUrl = null;
      infoBox.textContent = 'Analyse impossible : ' + e.message;
    } finally {
      analyzeBusy = false;
    }
  } });

  const dlBtn = el('button', { text: 'Télécharger l\'extrait', onclick: async () => {
    if (!info || busy || analyzeBusy) return;
    const curUrl = urlIn.value.trim();
    // info correspond a analyzedUrl : si le lien a change depuis
    // « Analyser », le nom/duree affiches ne decriraient pas le fichier.
    if (curUrl !== analyzedUrl) { prog.textContent = 'Le lien a changé : relance « Analyser ».'; return; }
    const start = parseTs(startIn.value);
    const hasTimeline = endIn.value.trim() !== '' && startIn.value.trim() !== '';
    const end = endIn.value.trim() === '' ? 0 : parseTs(endIn.value);
    if (endIn.value.trim() !== '' && startIn.value.trim() === '') {
      prog.textContent = 'Fin sans début : renseigne aussi le début, ou vide les deux pour le fichier complet.'; return;
    }
    if (!hasTimeline && startIn.value.trim() !== '0' && startIn.value.trim() !== '') {
      prog.textContent = 'Timeline incomplète : définis le début ET la fin, ou laisse les deux vides pour le fichier complet.'; return;
    }
    if (hasTimeline && (isNaN(start) || isNaN(end) || !(end > start))) {
      prog.textContent = 'Heure invalide : la fin doit être après le début.'; return;
    }
    busy = true;
    dl = null;
    prog.textContent = 'Téléchargement…';
    barFill.style.width = '0%'; barFill.style.opacity = '1';
    try {
      // La modale est restee vivante (pickDir natif) : progression visible.
      if (offProg) offProg();
      offProg = window.sf.onYtProgress(setProg);
      const r = await window.sf.ytDownload({ url: urlIn.value.trim(), start: hasTimeline ? start : 0, end: hasTimeline ? end : 0, dir: destDir, full: !hasTimeline });
      dl = { path: r.path, sectioned: r.sectioned, start: hasTimeline ? start : 0, end: hasTimeline ? end : null };
      // Une AUTRE modale est ouverte (pas la notre ni un residu askDestDir
      // deja ferme -> modalClose null) : ne pas la detruire. Le fichier est
      // dans imports/ — on donne le chemin.
      if (modalClose && modalClose !== ytModalClose) { toast('Téléchargement terminé : ' + r.path, 'info'); return; }
      // askDestDir a detruit la modale YouTube : sans modale de resultat, le
      // fichier reste orphelin dans imports/ et « Ajouter » est inaccessible.
      modal('Téléchargement terminé', [
        el('div', { class: 'hint', text: (r.sectioned ? 'Extrait MP3' : 'Audio complet') + ' — ' + r.path }),
        field('Nom', nameIn),
        field('Catégorie', catSel),
      ], [
        { label: 'Fermer', onclick: (c) => c() },
        { label: 'Écouter', onclick: () => previewSound() },
        { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
          if (!dl) return;
          const s = {
            id: uid(),
            name: nameIn.value.trim() || (info && info.title) || 'YouTube',
            path: dl.path,
            categoryId: catSel.value || null,
            volume: 100, addedAt: Date.now(), plays: 0,
            favorite: false, norm: 1, shortcut: null,
            trimStart: dl.sectioned ? 0 : dl.start,
            trimEnd: dl.sectioned ? null : dl.end,
            fadeIn: 0, fadeOut: 0,
          };
          dl = null;
          if (!pushSound(s)) { c(); return; }
          save(); renderAll(); c();
          toast('Son YouTube ajouté : ' + s.path);
        } },
      ]);
      prog.textContent = r.sectioned
        ? 'Extrait MP3 prêt (' + fmtTime(end - start) + ').'
        : hasTimeline
          ? 'Audio complet téléchargé ; seul l\'extrait choisi sera joué (' + fmtTime(end - start) + ' sur ' + fmtTime(info.duration) + ').'
          : 'Fichier audio complet téléchargé — ajuste le début/fin dans l\'éditeur si besoin.';
    } catch (e) {
      prog.textContent = 'Téléchargement impossible : ' + e.message + ' — vérifie le lien, ta connexion, et réessaie.';
    } finally {
      busy = false;
      if (offProg) { offProg(); offProg = null; } // ne jamais laisser fuir l'ecouteur ytprogress
    }
  } });

  const previewSound = () => {
    if (!dl) return;
    play({
      id: uid(), name: nameIn.value || 'YouTube', path: dl.path, volume: 100, plays: 0,
      norm: 1, favorite: false, shortcut: null,
      trimStart: dl.sectioned ? 0 : dl.start,
      trimEnd: dl.sectioned ? null : dl.end,
      fadeIn: 0, fadeOut: 0, addedAt: 0, categoryId: null,
    }, { monitorOnly: true, preview: true });
  };

  const ytModalClose = modal('Importer depuis YouTube', [
    field('Lien YouTube', el('div', { class: 'row' }, urlIn, analyzeBtn)),
    infoBox,
    field('Extrait (secondes ou hh:mm:ss)', el('div', { class: 'row' },
      el('span', { class: 'hint', text: 'Début' }), startIn,
      el('span', { class: 'hint', text: 'Fin' }), endIn),
      'Ex. début « 02:15 », fin « 02:28 » pour un extrait de 13 s.'),
    field('Dossier', el('div', { class: 'row' }, destLabel, destBtn), 'Le fichier audio est enregistré dans « imports » de ce dossier.'),
    el('div', { class: 'row' }, dlBtn),
    prog, bar,
    field('Nom', nameIn),
    field('Catégorie', catSel),
    el('div', { class: 'hint', text: 'Le fichier audio est enregistré dans le dossier « imports » du dossier choisi ci-dessus. Respecte les droits d\'auteur et les conditions de YouTube.' }),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Ajouter à la bibliothèque', kind: 'primary', onclick: (c) => {
      if (!dl) { toast('Télécharge d\'abord l\'extrait.', 'warn'); return; }
      const s = {
        id: uid(),
        name: nameIn.value.trim() || (info && info.title) || 'YouTube',
        path: dl.path,
        categoryId: catSel.value || null,
        volume: 100, addedAt: Date.now(), plays: 0,
        favorite: false, norm: 1, shortcut: null,
        trimStart: dl.sectioned ? 0 : dl.start,
        trimEnd: dl.sectioned ? null : dl.end,
        fadeIn: 0, fadeOut: 0,
      };
      if (!pushSound(s)) { c(); return; }
      save(); renderAll(); c();
      toast('Son YouTube ajouté : ' + dl.path);
    } },
  ], { onClose: () => { if (offProg) { offProg(); offProg = null; } } });
}
