// ================================================================
// import YouTube
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ import YouTube
// flag i : hote/scheme sont insensibles a la casse en pratique (HTTPS://,
// WWW.YOUTUBE.COM colles ainsi sont rejetes a tort) — et le validateur
// main (YT_HOST_RE, /i) les accepterait : le renderer etait plus strict
// que le contrat IPC. youtube-nocookie aligne sur le main.
const YT_RE = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com|youtube-nocookie\.com)\//i;

// yt-dlp/ffmpeg ecrivent leurs erreurs en anglais sur stderr — on traduit
// les cas courants pour l'utilisateur, le detail technique reste en log.
// Les retours passent par t() : la langue courante est appliquee.
function ytErrFr(e) {
  const raw = String((e && e.message) || e || '');
  if (/annul/i.test(raw)) return t('Téléchargement annulé.');
  if (/délai dépassé|timed?\s*out/i.test(raw)) return t('Délai dépassé — la vidéo est peut-être trop longue ou YouTube est lent. Réessaie.');
  if (/private|sign in|login|authentication/i.test(raw)) return t('Vidéo privée ou connexion YouTube requise.');
  if (/unavailable|removed|deleted|does not exist|404/i.test(raw)) return t('Vidéo indisponible, supprimée ou introuvable.');
  if (/429|too many requests/i.test(raw)) return t('YouTube limite les requêtes — réessaie dans quelques minutes.');
  if (/403|forbidden/i.test(raw)) return t('YouTube a refusé l\'accès à cette vidéo.');
  if (/url|http|dns|network|connexion|getaddrinfo/i.test(raw) && /fail|error|refus/i.test(raw)) return t('Problème réseau — vérifie ta connexion et réessaie.');
  return raw || t('Erreur inconnue.');
}

// Fichiers imports/ non ajoutes a la bibliotheque : un download YouTube
// dont la modale de resultat est fermee sans « Ajouter » devient
// introuvable — cette liste permet de les recuperer (retour terrain).
async function orphanImportsModal() {
  // '' (userData/imports = destination par defaut des downloads YouTube)
  // doit TOUJOURS etre scanne : un storageDir/lastDestDir renseigne
  // reduisait la liste a ces seuls dossiers — les orphelins du dossier
  // par defaut (downloads d'avant le choix du dossier, imports legacy)
  // devenaient invisibles. Le dedup par path (seen) couvre les doublons.
  const dirs = [...new Set(['', cfg.settings.storageDir || '', cfg.settings.lastDestDir || ''])];
  const seen = new Set(), files = [];
  for (const d of dirs) {
    try {
      for (const f of await window.sf.listImports(d)) {
        // Comparaison insensible a la casse (normalization de normalizeCfg
        // deduplique en toLowerCase — Windows) + categorie courante comme
        // addPaths, au lieu de toujours « sans categorie ».
        if (seen.has(f.path.toLowerCase()) || cfg.sounds.some((s) => s.path.toLowerCase() === f.path.toLowerCase())) continue;
        seen.add(f.path.toLowerCase()); files.push(f);
      }
    } catch (e) { logErr('listImports', e); }
  }
  if (!files.length) { toast(t('Aucun fichier non ajouté dans imports/.'), 'info'); return; }
  const checks = files.map((f) => {
    const cb = el('input', { type: 'checkbox', checked: true });
    const sz = f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' Mo' : Math.round(f.size / 1024) + ' Ko';
    return { f, cb, row: el('label', { class: 'check' }, cb,
      el('span', { text: f.name.replace(/^sf-[a-z0-9]+-?/i, '') + ' — ' + sz + ' — ' + new Date(f.mtime).toLocaleDateString(SFI18n.lang() === 'fr' ? 'fr-FR' : SFI18n.lang()) })) };
  });
  modal(t('Fichiers importés non ajoutés ({n})', { n: files.length }), [
    el('div', { class: 'hint', style: { maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } },
      checks.map((c) => c.row)),
    el('div', { class: 'hint', text: t('Ce sont des fichiers téléchargés (YouTube) ou déposés dans imports/ qui ne sont pas encore dans ta bibliothèque. Coche ceux à ajouter.') }),
  ], [
    { label: t('Fermer'), onclick: (c) => c() },
    { label: t('Ajouter la sélection'), kind: 'primary', onclick: (c) => {
      let n = 0;
      for (const { f, cb } of checks) {
        if (!cb.checked) continue;
        const s = {
          id: uid(), name: f.name.replace(/^sf-[a-z0-9]+-?/i, '').replace(/\.[^.]+$/, '').slice(0, 80) || 'Import',
          path: f.path, categoryId: catById(cfg.ui.cat) ? cfg.ui.cat : null, volume: 100, addedAt: Date.now(), plays: 0,
          favorite: false, norm: 1, shortcut: null, trimStart: 0, trimEnd: null, fadeIn: 0, fadeOut: 0,
        };
        if (pushSound(s)) n++;
      }
      save(); renderAll(); c();
      toast(n ? t('{n} fichier(s) ajouté(s) à la bibliothèque.', { n }) : t('Aucun fichier ajouté.'), n ? 'info' : 'warn');
    } },
  ], { wide: true });
}

function youtubeModal() {
  const urlIn = el('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' });
  urlIn.style.flex = '1';
  const infoBox = el('div', { class: 'hint', text: t('Colle un lien YouTube puis « Analyser ».') });
  const startIn = el('input', { type: 'text', placeholder: '0 ou 02:15', value: '0' });
  const endIn = el('input', { type: 'text', placeholder: '13 ou 02:28', value: '' });
  startIn.style.flex = '1'; endIn.style.flex = '1';
  const nameIn = el('input', { type: 'text', placeholder: t('Nom du son (titre par défaut)'), maxlength: 80 });
  const catSel = el('select', {},
    el('option', { value: '', text: t('Sans catégorie') }),
    sortedCategories().map((c) => el('option', { value: c.id, text: c.name })));
  const prog = el('div', { class: 'hint' });
  const bar = el('div', { class: 'ytbar' }, el('i'));
  const barFill = bar.firstChild;
  // Destination : le dossier de sons choisi (storageDir) est le defaut ;
  // lastDestDir/Changer… restent des exceptions par telechargement.
  // pickDir natif (jamais askDestDir/confirmBox : slot modal() unique,
  // detruirait cette modale — SF-REL-0067).
  let destDir = cfg.settings.storageDir || cfg.settings.lastDestDir || '';
  const destLabel = el('span', { class: 'hint', text: destDir || t('(choisis un dossier)') });
  const destBtn = el('button', { text: t('Changer…'), onclick: async () => {
    try {
      const d = await window.sf.pickDir();
      // Premier choix explicite = dossier de sons principal (coherence
      // avec askDestDir) — sinon la banniere resterait affichee.
      if (d) { destDir = d; cfg.settings.lastDestDir = d; if (!cfg.settings.storageDir) { cfg.settings.storageDir = d; updateStorageUi(); } save(); destLabel.textContent = d; }
    } catch (e) { logErr('pickDir', e); }
  } });

  let info = null, dl = null, offProg = null, busy = false, analyzeBusy = false, analyzedUrl = null;
  // ytGone : la modale YouTube a ete fermee par l'utilisateur PENDANT le
  // download — a la fin, la modale de resultat ne doit PAS se reouvrir
  // sans demande (volerait le focus des minutes plus tard). Toast a la
  // place ; le fichier reste recuperable via imports/ (orphelins).
  let ytGone = false;
  const setProg = (p, label) => {
    const what = label || t('Téléchargement…');
    if (p === -1 || p == null) { prog.textContent = what; barFill.style.width = '100%'; barFill.style.opacity = '.4'; }
    else { prog.textContent = what + ' ' + p + ' %'; barFill.style.opacity = '1'; barFill.style.width = p + '%'; }
  };

  const analyzeBtn = el('button', { text: t('Analyser'), onclick: async () => {
    const url = urlIn.value.trim();
    if (!YT_RE.test(url)) { infoBox.textContent = t('Ce lien ne ressemble pas à une URL YouTube.'); return; }
    // Pas d'analyse pendant un telechargement : yt:info emet ytProgress(-1)
    // qui ecraserait la barre du download, et les deux flaky flags
    // shared 'busy' permettaient un double yt:download.
    if (busy || analyzeBusy) return;
    analyzeBusy = true;
    infoBox.textContent = t('Vérification de l\'outil de téléchargement…');
    try {
      if (offProg) offProg(); // un seul ecouteur ytprogress a la fois
      // « Préparation… » pendant ensure/info : ytProgress(-1) y est emis
      // aussi — « Téléchargement… » induirait en erreur pendant l'analyse.
      offProg = window.sf.onYtProgress((p) => setProg(p, t('Préparation…')));
      await window.sf.ytEnsure();
      infoBox.textContent = t('Lecture des infos de la vidéo…');
      info = await window.sf.ytInfo(url);
      analyzedUrl = url;
      infoBox.textContent = t('« {title} » — durée {dur}.', { title: info.title, dur: fmtTime(info.duration) });
      const md = +cfg.settings.maxSoundDur;
      if (md > 0 && info.duration > md) infoBox.textContent += t(' ⚠ Plus long que la limite de lecture ({n} s) : seuls les {n} premières secondes seront jouées.', { n: md });
      if (!nameIn.value) nameIn.value = String(info.title).slice(0, 80);
      endIn.placeholder = info.duration ? t('Fin (max {dur})', { dur: fmtTime(info.duration) }) : t('Fin');
    } catch (e) {
      info = null; analyzedUrl = null;
      infoBox.textContent = t('Analyse impossible : {err}', { err: ytErrFr(e) });
    } finally {
      analyzeBusy = false;
    }
  } });

  const cancelBtn = el('button', { text: t('Annuler le téléchargement'), disabled: true, onclick: async () => {
    // yt:cancel tue le process yt-dlp : runYt rejette « annulé », le catch
    // affiche le message traduit et finally reactive les boutons.
    try { await window.sf.ytCancel(); } catch (e) { logErr('ytCancel', e); }
  } });

  const dlBtn = el('button', { text: t('Télécharger l\'extrait'), onclick: async () => {
    if (!info || busy || analyzeBusy) return;
    const curUrl = urlIn.value.trim();
    // info correspond a analyzedUrl : si le lien a change depuis
    // « Analyser », le nom/duree affiches ne decriraient pas le fichier.
    if (curUrl !== analyzedUrl) { prog.textContent = t('Le lien a changé : relance « Analyser ».'); return; }
    const start = parseTs(startIn.value);
    const hasTimeline = endIn.value.trim() !== '' && startIn.value.trim() !== '';
    const end = endIn.value.trim() === '' ? 0 : parseTs(endIn.value);
    if (endIn.value.trim() !== '' && startIn.value.trim() === '') {
      prog.textContent = t('Fin sans début : renseigne aussi le début, ou vide les deux pour le fichier complet.'); return;
    }
    // « 00 »/« 0:00 » = debut nul (parseTs -> 0), pas une timeline
    // incomplete — comparaison sur la valeur parsee, pas la saisie brute.
    if (!hasTimeline && startIn.value.trim() !== '' && start !== 0) {
      prog.textContent = t('Timeline incomplète : définis le début ET la fin, ou laisse les deux vides pour le fichier complet.'); return;
    }
    if (hasTimeline && (isNaN(start) || isNaN(end) || !(end > start))) {
      prog.textContent = t('Heure invalide : la fin doit être après le début.'); return;
    }
    // Dossier de sons obligatoire : pickDir natif ne detruit pas la modale.
    if (!destDir) {
      try {
        const d = await window.sf.pickDir();
        if (!d) { prog.textContent = t('Téléchargement annulé : aucun dossier choisi.'); return; }
        destDir = d; cfg.settings.lastDestDir = d;
        if (!cfg.settings.storageDir) { cfg.settings.storageDir = d; updateStorageUi(); }
        save(); destLabel.textContent = d;
      } catch (e) { logErr('pickDir', e); prog.textContent = t('Choix du dossier impossible.'); return; }
    }
    busy = true;
    dl = null;
    cancelBtn.disabled = false;
    prog.textContent = t('Téléchargement…');
    barFill.style.width = '0%'; barFill.style.opacity = '1';
    try {
      // La modale est restee vivante (pickDir natif) : progression visible.
      if (offProg) offProg();
      offProg = window.sf.onYtProgress(setProg);
      const r = await window.sf.ytDownload({ url: urlIn.value.trim(), start: hasTimeline ? start : 0, end: hasTimeline ? end : 0, dir: destDir, full: !hasTimeline });
      // Contrat IPC : un path non-string creerait un son invalide silencieusement.
      if (!r || typeof r.path !== 'string' || !r.path) throw new Error(t('réponse yt:download invalide'));
      dl = { path: r.path, sectioned: !!r.sectioned, start: hasTimeline ? start : 0, end: hasTimeline ? end : null };
      // Une AUTRE modale est ouverte (pas la notre) OU l'utilisateur a
      // ferme la modale YouTube pendant le download (ytGone via onClose,
      // modalClose redevenu null) : ne pas la detruire ni la rouvrir.
      // Le fichier est dans imports/ — toast avec le chemin.
      if (ytGone || (modalClose && modalClose !== ytModalClose)) { toast(t('Téléchargement terminé : {path}', { path: r.path }), 'info'); return; }
      modal(t('Téléchargement terminé'), [
        el('div', { class: 'hint', text: (r.sectioned ? t('Extrait MP3') : t('Audio complet')) + ' — ' + r.path }),
        field(t('Nom'), nameIn),
        field(t('Catégorie'), catSel),
      ], [
        { label: t('Fermer'), onclick: (c) => c() },
        { label: t('Écouter'), onclick: () => previewSound() },
        { label: t('Ajouter à la bibliothèque'), kind: 'primary', onclick: (c) => {
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
          toast(t('Son YouTube ajouté : {path}', { path: dl.path }));
        } },
      ]);
      prog.textContent = r.sectioned
        ? t('Extrait MP3 prêt ({dur}).', { dur: fmtTime(end - start) })
        : hasTimeline
          ? t('Audio complet téléchargé ; seul l\'extrait choisi sera joué ({sel} sur {tot}).', { sel: fmtTime(end - start), tot: fmtTime(info.duration) })
          : t('Fichier audio complet téléchargé — ajuste le début/fin dans l\'éditeur si besoin.');
    } catch (e) {
      // Annulation explicite : on quitte la modale d'importation plutot
      // que d'afficher une « erreur » — demande utilisateur.
      if (/annul/i.test(String((e && e.message) || e))) {
        prog.textContent = t('Téléchargement annulé.');
        if (modalClose === ytModalClose) ytModalClose();
      } else {
        prog.textContent = t('Téléchargement impossible : {err} — vérifie le lien, ta connexion, et réessaie.', { err: ytErrFr(e) });
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

  const ytModalClose = modal(t('Importer depuis YouTube'), [
    field(t('Lien YouTube'), el('div', { class: 'row' }, urlIn, analyzeBtn)),
    infoBox,
    field(t('Extrait (secondes ou hh:mm:ss)'), el('div', { class: 'row' },
      el('span', { class: 'hint', text: t('Début') }), startIn,
      el('span', { class: 'hint', text: t('Fin') }), endIn),
      t('Ex. début « 02:15 », fin « 02:28 » pour un extrait de 13 s.')),
    field(t('Dossier'), el('div', { class: 'row' }, destLabel, destBtn), t('Le fichier audio est enregistré dans « imports » de ce dossier.')),
    el('div', { class: 'row' }, dlBtn, cancelBtn),
    prog, bar,
    field(t('Nom'), nameIn),
    field(t('Catégorie'), catSel),
    el('div', { class: 'hint', text: t('Le fichier audio est enregistré dans le dossier « imports » du dossier choisi ci-dessus. Respecte les droits d\'auteur et les conditions de YouTube.') }),
  ], [
    { label: t('Fermer'), onclick: (c) => c() },
    { label: t('Ajouter à la bibliothèque'), kind: 'primary', onclick: (c) => {
      if (!dl) { toast(t('Télécharge d\'abord l\'extrait.'), 'warn'); return; }
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
      toast(t('Son YouTube ajouté : {path}', { path: dl.path }));
    } },
  // Fermeture pendant un download : sans yt:cancel le process tournait
  // jusqu'a 2 min (voire ~15 min si une maj d'outil etait en vol) sans
  // aucun moyen de l'arreter — la modale etait le seul bouton Annuler.
  ], { onClose: () => { ytGone = true; if (offProg) { offProg(); offProg = null; } if (busy) window.sf.ytCancel().catch((e) => logErr('ytCancel', e)); } });
}
