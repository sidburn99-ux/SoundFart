// ================================================================
// import YouTube
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ import YouTube
const YT_RE = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//;

// yt-dlp/ffmpeg ecrivent leurs erreurs en anglais sur stderr — on traduit
// les cas courants pour l'utilisateur, le detail technique reste en log.
function ytErrFr(e) {
  const raw = String((e && e.message) || e || '');
  if (/annul/i.test(raw)) return 'Téléchargement annulé.';
  if (/délai dépassé|timed?\s*out/i.test(raw)) return 'Délai dépassé — la vidéo est peut-être trop longue ou YouTube est lent. Réessaie.';
  if (/private|sign in|login|authentication/i.test(raw)) return 'Vidéo privée ou connexion YouTube requise.';
  if (/unavailable|removed|deleted|does not exist|404/i.test(raw)) return 'Vidéo indisponible, supprimée ou introuvable.';
  if (/429|too many requests/i.test(raw)) return 'YouTube limite les requêtes — réessaie dans quelques minutes.';
  if (/403|forbidden/i.test(raw)) return 'YouTube a refusé l\'accès à cette vidéo.';
  if (/url|http|dns|network|connexion|getaddrinfo/i.test(raw) && /fail|error|refus/i.test(raw)) return 'Problème réseau — vérifie ta connexion et réessaie.';
  return raw || 'Erreur inconnue.';
}

// Fichiers imports/ non ajoutes a la bibliotheque : un download YouTube
// dont la modale de resultat est fermee sans « Ajouter » devient
// introuvable — cette liste permet de les recuperer (retour terrain).
async function orphanImportsModal() {
  const dirs = [...new Set([cfg.settings.storageDir || '', cfg.settings.lastDestDir || ''].filter(Boolean))];
  if (!dirs.length) dirs.push('');
  const seen = new Set(), files = [];
  for (const d of dirs) {
    try {
      for (const f of await window.sf.listImports(d)) {
        if (seen.has(f.path) || cfg.sounds.some((s) => s.path === f.path)) continue;
        seen.add(f.path); files.push(f);
      }
    } catch (e) { logErr('listImports', e); }
  }
  if (!files.length) { toast('Aucun fichier non ajouté dans imports/.', 'info'); return; }
  const checks = files.map((f) => {
    const cb = el('input', { type: 'checkbox', checked: true });
    const sz = f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' Mo' : Math.round(f.size / 1024) + ' Ko';
    return { f, cb, row: el('label', { class: 'check' }, cb,
      el('span', { text: f.name.replace(/^sf-[a-z0-9]+-?/i, '') + ' — ' + sz + ' — ' + new Date(f.mtime).toLocaleDateString('fr-FR') })) };
  });
  modal('Fichiers importés non ajoutés (' + files.length + ')', [
    el('div', { class: 'hint', style: { maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } },
      checks.map((c) => c.row)),
    el('div', { class: 'hint', text: 'Ce sont des fichiers téléchargés (YouTube) ou déposés dans imports/ qui ne sont pas encore dans ta bibliothèque. Coche ceux à ajouter.' }),
  ], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Ajouter la sélection', kind: 'primary', onclick: (c) => {
      let n = 0;
      for (const { f, cb } of checks) {
        if (!cb.checked) continue;
        const s = {
          id: uid(), name: f.name.replace(/^sf-[a-z0-9]+-?/i, '').replace(/\.[^.]+$/, '').slice(0, 80) || 'Import',
          path: f.path, categoryId: null, volume: 100, addedAt: Date.now(), plays: 0,
          favorite: false, norm: 1, shortcut: null, trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
        };
        if (pushSound(s)) n++;
      }
      save(); renderAll(); c();
      toast(n ? n + ' fichier(s) ajouté(s) à la bibliothèque.' : 'Aucun fichier ajouté.', n ? 'info' : 'warn');
    } },
  ], { wide: true });
}

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
  // Destination : le dossier de sons choisi (storageDir) est le defaut ;
  // lastDestDir/Changer… restent des exceptions par telechargement.
  // pickDir natif (jamais askDestDir/confirmBox : slot modal() unique,
  // detruirait cette modale — SF-REL-0067).
  let destDir = cfg.settings.storageDir || cfg.settings.lastDestDir || '';
  const destLabel = el('span', { class: 'hint', text: destDir || '(choisis un dossier)' });
  const destBtn = el('button', { text: 'Changer…', onclick: async () => {
    try {
      const d = await window.sf.pickDir();
      // Premier choix explicite = dossier de sons principal (coherence
      // avec askDestDir) — sinon la banniere resterait affichee.
      if (d) { destDir = d; cfg.settings.lastDestDir = d; if (!cfg.settings.storageDir) { cfg.settings.storageDir = d; updateStorageUi(); } save(); destLabel.textContent = d; }
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
      const md = +cfg.settings.maxSoundDur;
      if (md > 0 && info.duration > md) infoBox.textContent += ` ⚠ Plus long que la limite de lecture (${md} s) : seuls les ${md} premières secondes seront jouées.`;
      if (!nameIn.value) nameIn.value = String(info.title).slice(0, 80);
      endIn.placeholder = info.duration ? 'Fin (max ' + fmtTime(info.duration) + ')' : 'Fin';
    } catch (e) {
      info = null; analyzedUrl = null;
      infoBox.textContent = 'Analyse impossible : ' + ytErrFr(e);
    } finally {
      analyzeBusy = false;
    }
  } });

  const cancelBtn = el('button', { text: 'Annuler le téléchargement', disabled: true, onclick: async () => {
    // yt:cancel tue le process yt-dlp : runYt rejette « annulé », le catch
    // affiche le message traduit et finally reactive les boutons.
    try { await window.sf.ytCancel(); } catch (e) { logErr('ytCancel', e); }
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
    // Dossier de sons obligatoire : pickDir natif ne detruit pas la modale.
    if (!destDir) {
      try {
        const d = await window.sf.pickDir();
        if (!d) { prog.textContent = 'Téléchargement annulé : aucun dossier choisi.'; return; }
        destDir = d; cfg.settings.lastDestDir = d;
        if (!cfg.settings.storageDir) { cfg.settings.storageDir = d; updateStorageUi(); }
        save(); destLabel.textContent = d;
      } catch (e) { logErr('pickDir', e); prog.textContent = 'Choix du dossier impossible.'; return; }
    }
    busy = true;
    dl = null;
    cancelBtn.disabled = false;
    prog.textContent = 'Téléchargement…';
    barFill.style.width = '0%'; barFill.style.opacity = '1';
    try {
      // La modale est restee vivante (pickDir natif) : progression visible.
      if (offProg) offProg();
      offProg = window.sf.onYtProgress(setProg);
      const r = await window.sf.ytDownload({ url: urlIn.value.trim(), start: hasTimeline ? start : 0, end: hasTimeline ? end : 0, dir: destDir, full: !hasTimeline });
      // Contrat IPC : un path non-string creerait un son invalide silencieusement.
      if (!r || typeof r.path !== 'string' || !r.path) throw new Error('réponse yt:download invalide');
      dl = { path: r.path, sectioned: !!r.sectioned, start: hasTimeline ? start : 0, end: hasTimeline ? end : null };
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
      // Annulation explicite : on quitte la modale d'importation plutot
      // que d'afficher une « erreur » — demande utilisateur.
      if (/annul/i.test(String((e && e.message) || e))) {
        prog.textContent = 'Téléchargement annulé.';
        if (modalClose === ytModalClose) ytModalClose();
      } else {
        prog.textContent = 'Téléchargement impossible : ' + ytErrFr(e) + ' — vérifie le lien, ta connexion, et réessaie.';
      }
    } finally {
      busy = false;
      cancelBtn.disabled = true;
      if (offProg) { offProg(); offProg = null; } // ne jamais laisser fuir l'ecouteur ytprogress
    }
  } });

const previewSound = () => {
    if (!dl) return;
    play({
      id: uid(), name: (nameIn.value || '').trim() || 'YouTube', path: dl.path, volume: 100, plays: 0,
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
    el('div', { class: 'row' }, dlBtn, cancelBtn),
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
