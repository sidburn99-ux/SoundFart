// ================================================================
// reglages + sauvegarde
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ reglages audio
// ================================================================ sauvegarde (export/import)
// IS_LINUX : declare dans app.js (charge en dernier) — un seul const
// global, les scripts partagent le meme scope lexical.
function exportConfig() {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soundfart-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(t('Configuration exportée (références uniquement, pas les fichiers audio).'));
}

// Propose le dossier de destination avant un ajout (YouTube, enregistrement).
// Pre-rempli avec le dernier choix (lastDestDir) ou le dossier de stockage.
function askDestDir(extraButtons, extraNodes) {
  return new Promise((resolve) => {
    const inp = el('input', { type: 'text', value: cfg.settings.storageDir || cfg.settings.lastDestDir || '' });
    // input DOIT etre dans .field : sinon il garde le style natif (fond
    // blanc) avec le texte clair herite -> illisible (retour terrain).
    inp.style.width = '100%';
    modal(t('Dossier de destination'), [
      field(t('Dossier'), inp, cfg.settings.storageDir
        ? t('Laisse vide pour utiliser ton dossier de sons principal.')
        : t('Choisis le dossier où le fichier sera enregistré — ce sera aussi ton dossier de sons principal.')),
      ...(extraNodes || []),
    ], [
      ...(extraButtons || []),
      { label: t('Annuler'), onclick: (c) => { resolve(null); c(); } },
      { label: t('Choisir…'), onclick: async () => { try { const d = await window.sf.pickDir(); if (d) inp.value = d; } catch (e) { logErr('pickDir', e); } } },
      { label: 'OK', kind: 'primary', onclick: (c) => {
        const d = inp.value.trim();
        // storageRoot() ignore silencieusement les chemins relatifs :
        // mieux vaut refuser ici que d'enregistrer « ailleurs » que l'UI.
        // Sans dossier choisi ET sans dossier principal : refuser — sinon
        // storageRoot('') enverrait le fichier dans %APPDATA% (hors modele).
        if (!d && !cfg.settings.storageDir) {
          inp.style.borderColor = 'var(--danger, #ef4444)';
          return;
        }
        if (d && !/^[a-zA-Z]:[\\/]/.test(d) && !d.startsWith('\\\\')) {
          inp.style.borderColor = 'var(--danger, #ef4444)';
          return; // reste dans la modale, pas de resolve
        }
        if (d) {
          cfg.settings.lastDestDir = d;
          // Premier choix explicite = le dossier de sons principal (modele
          // « un seul dossier ») ; ensuite lastDestDir reste un simple dernier
          // choix sans ecraser storageDir.
          if (!cfg.settings.storageDir) { cfg.settings.storageDir = d; updateStorageUi(); }
        } else { delete cfg.settings.lastDestDir; }
        save();
        resolve(d || ''); c();
      } },
    ], { resolve, resolveValue: null });
  });
}

function importConfig(onDone) {
  const inp = el('input', { type: 'file', accept: '.json,application/json' });
  inp.style.display = 'none';
  document.body.append(inp);
  inp.addEventListener('cancel', () => inp.remove()); // l'utilisateur a ferme le selecteur sans choisir
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    inp.remove();
    if (!f) return;
    try {
      // Borner la lecture : un JSON geant gele le parse et peut dépasser
      // la limite config:save (5 Mo) -> import ensuite impossible a sauver.
      if (f.size > 8 * 1024 * 1024) throw new Error(t('fichier trop volumineux (> 8 Mo)'));
      const parsed = JSON.parse(await f.text());
      if (!parsed || !Array.isArray(parsed.sounds)) throw new Error(t('fichier invalide'));
      // confirmBox DETUIT le panneau (slot modal unique) AVANT la reponse :
      // sur « Annuler » on rouvre les reglages — mais SEULEMENT si
      // l'import venait du panneau (onDone fourni) ; depuis le menu F11 il
      // n'y avait pas de panneau a restaurer.
      if (!(await confirmBox(t('Importer la configuration ?'), t('La configuration actuelle (sons, catégories, réglages, raccourcis) sera remplacée. Les fichiers audio ne sont pas modifiés.'), t('Importer')))) { if (onDone) settingsModal(); return; }
      // Pas de teardownAudio() direct ici : applyAudio() passe par
      // audioApplyChain et fait deja le teardown — un appel direct
      // pendant qu'un applyAudioInner est en vol pouvait etre suivi
      // d'une recreation avec l'ANCIENNE config (SF-REL-0619).
      // Une config importee sans settings.lang herite de la langue
      // courante : sinon elle redeclencherait l'ecran de choix.
      const prevLang = cfg.settings.lang;
      cfg = normalizeCfg(parsed);
      if (cfg.settings.lang === undefined && prevLang !== undefined) cfg.settings.lang = prevLang;
      // Les voix en cours referenciaient l'ancienne config (chemins
      // potentiellement differents) : on les arrete comme removeSound.
      stopAll(true);
      missing.clear();
      // Un checkMissing() demarre AVANT l'import peut se terminer APRES :
      // sans invalider son jeton, il reecrivait missingPaths avec les
      // chemins MANQUANTS de l'ANCIENNE config — getBuffer refusait alors
      // de cacher des sons importes presents jusqu'au prochain scan.
      missingPaths = new Set(); checkSeq++;
      // Purge le cache decode : les AudioBuffer des anciens chemins ne
      // servent plus (jusqu'a 256 Mo d'orphelins sinon).
      bufCache.clear(); bufCacheBytes = 0; longWarned.clear(); bufInflight.clear(); truncWarned.clear();
      save();
      updateStorageUi(); // la banniere dossier de sons depend de storageDir importe
      await refreshDevices(false);
      resolveDevices();
      // catch isole : une rejection sauterait renderAll/syncTopbarControls/
      // onDone et laisserait l'UI sur l'ancienne config alors que cfg est deja remplace.
      await applyAudio().catch((e) => logErr('applyAudio import', e));
      applyShortcuts();
      renderAll();
      syncTopbarControls();
      // autoSwitchMic/cableLabel peuvent avoir change : rejouer la bascule
      // comme le fait « Appliquer » des reglages, sinon elle attend le
      // prochain evenement (SF-REL revue import).
      if (cablePresent()) window.sf.audioAutoSetup({ enabled: cfg.settings.autoSwitchMic, cableLabel: cfg.settings.cableLabel }).then((r) => {
        if (r && r.changed) toast(t('Entrée micro basculée sur {dev} (restaurée à la fermeture).', { dev: r.device }));
        else if (r && !r.ok) toast(t('Bascule micro auto impossible : {err}', { err: r.err }), 'warn');
      }).catch((e) => logErr('audioAutoSetup', e));
      checkMissing().catch((e) => logErr('checkMissing', e)); // re-verifie les chemins des sons importes
      toast(t('Configuration importée.'));
      if (onDone) onDone();
    } catch (e) { toast(t('Import impossible : {err}', { err: e.message }), 'warn'); }
  });
  inp.click();
}

function settingsModal() {
  const s = cfg.settings;
  const opts = (list, selected, withNone) => [
    withNone ? el('option', { value: '', text: t('(aucune)') }) : null,
    list.map((d) => el('option', { value: d.deviceId, text: d.label || d.deviceId, selected: d.deviceId === selected })),
  ];
  const cableSel = el('select', {}, el('option', { value: '', text: t('(choisir…)') }), opts(audio.devices.out, s.cableId, false));
  const monSel = el('select', {}, opts(audio.devices.out, s.monId, true));
  // Placeholder « (choisir…) » comme cableSel : sans lui, un micId vide
  // selecionnait silencieusement le 1er peripherique (eventuellement un
  // virtuel) a l'application des reglages.
  const micSel = el('select', {}, el('option', { value: '', text: t('(auto — premier vrai micro)') }), opts(audio.devices.inp, s.micId, false));
  // '' = placeholder « auto » : sans ce drapeau, choisir « auto » puis
  // Appliquer conservait l'ANCIEN micId (le placeholder s'affiche aussi
  // quand le peripherique configure a disparu — la distinction « choisi
  // par l'utilisateur » vs « affiche par defaut » exige un event change).
  let micAutoPicked = false;
  micSel.addEventListener('change', () => { micAutoPicked = micSel.value === ''; });
  const mix = el('input', { type: 'checkbox', checked: s.micMix });
  // Surbrillance des choix recommandes : ★ = a privilegier, ⚠ = a eviter.
  // dataset.label garde le libelle propre (sans prefixe) pour le stockage.
  const markSel = (sel, test) => {
    for (const o of sel.options) {
      o.dataset.label = o.text;
      const m = test(o.text);
      if (m === 1) o.text = '★ ' + o.text;
      else if (m === -1) o.text = '⚠ ' + o.text;
    }
    const refresh = () => {
      const o = sel.selectedOptions[0];
      sel.classList.toggle('rec', !!o && o.text.startsWith('★'));
      sel.classList.toggle('warn', !!o && o.text.startsWith('⚠'));
    };
    sel.addEventListener('change', refresh);
    refresh();
    return sel;
  };
  markSel(cableSel, (t) => (/cable input/i.test(t) ? 1 : /cable/i.test(t) ? -1 : 0));
  markSel(monSel, (t) => (/cable/i.test(t) ? -1 : 0)); // ecoute locale sur le cable = boucle
  markSel(micSel, (t) => (VIRTUAL_RE.test(t) ? -1 : 1)); // vrai micro recommande, virtuel evite
  const lbl = (sel) => { const o = sel.selectedOptions[0]; return o ? (o.dataset.label || o.textContent) : ''; };

  // raccourci global STOP
  let stopSc = s.stopShortcut || '';
  const stopBtn = el('button', { text: stopSc ? fmtAccel(stopSc) : t('Aucun — cliquer pour définir'), title: t('Raccourci clavier GLOBAL : interrompt tous les sons en cours, même fenêtre minimisée ou dans une autre application.') });
  const stopHint = el('div', { class: 'hint', text: t('Interrompt immédiatement tous les sons en cours, même fenêtre minimisée.') });
  let stopCleanup = () => {};
  stopBtn.addEventListener('click', () => {
    stopCleanup();
    stopBtn.textContent = t('Appuie sur le raccourci… (Échap pour annuler)');
    const disarm = () => {
      window.removeEventListener('keydown', onKey, true);
      stopCleanup = () => {};
      stopBtn.textContent = stopSc ? fmtAccel(stopSc) : t('Aucun — cliquer pour définir');
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { disarm(); return; }
      const acc = buildAccel(e);
      if (!acc) { stopHint.textContent = t('Ajoute un modifieur (Ctrl, Alt, Maj) ou utilise une touche F.'); return; }
      // Meme source de verite que les raccourcis de sons : couvre les sons,
      // le STOP existant ET les accesseurs du menu (Ctrl+F/O, F12).
      if (normAccel(acc) !== normAccel(stopSc || '')) {
        const owner = findShortcutOwner(acc);
        if (owner) { stopHint.textContent = t('Ce raccourci est déjà attribué à {owner}.', { owner }); return; }
      }
      stopSc = acc;
      stopBtn.textContent = fmtAccel(acc);
      stopHint.textContent = '';
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    stopCleanup = disarm;
  });

  // dossier de stockage des fichiers crees par l'app (sons copies, imports
  // YouTube, enregistrements, extraits) — obligatoire des la 1re creation.
  // userData = %APPDATA%\SoundFart (reglages/outils), independent du dossier sons.
  // resetStorageDir unique : le handler dans getDataDir().then ecrasait
  // l'onclick initial avec une version sans save() — deux handlers
  // divergents selon que getDataDir resout ou non.
  const resetStorageDir = () => { s.storageDir = ''; dirLbl.textContent = t('Non choisi — sera demandé à la prochaine création de fichier'); updateStorageUi(); save(); };
  window.sf.getDataDir().then((d) => {
    const lbl = t('Réglages et outils : {dir}', { dir: d });
    if (!s.storageDir) dirLbl.textContent = t('Non choisi — sera demandé à la prochaine création de fichier');
  }).catch((e) => logErr('getDataDir', e));
  const dirLbl = el('div', { class: 'hint path', text: (s.storageDir || t('Non choisi — sera demandé à la prochaine création de fichier')) + t(' — sons ajoutés dans sons/, YouTube dans imports/, micro dans recordings/, extraits dans cuts/') });
  const openDirBtn = el('button', { class: 'ghost', text: t('Ouvrir'), title: t('Ouvre le dossier de stockage dans l\'Explorateur'), onclick: () => window.sf.openDir(s.storageDir || '').catch((e) => logErr('openDir', e)) });
  const pickDirBtn = el('button', { text: t('Choisir…'), title: t('Choisit le dossier racine où SoundFart range ses fichiers (imports/, recordings/, cuts/).'), onclick: async () => {
    try {
      const d = await window.sf.pickDir();
      // save() des maintenant : sans lui, un crash avant le prochain
      // save() perdaient le choix (seul beforeunload couvrait).
      if (d) { s.storageDir = d; dirLbl.textContent = d; updateStorageUi(); save(); }
    } catch (e) { logErr('pickDir', e); }
  } });
  const resetDirBtn = el('button', { class: 'ghost', text: t('Réinitialiser'), title: t('Oublie le dossier choisi : il sera redemandé à la prochaine création de fichier.'), onclick: resetStorageDir });
  const orphanBtn2 = el('button', { text: t('Parcourir les fichiers non ajoutés…'), onclick: () => orphanImportsModal().catch((e) => logErr('orphanImports', e)) });
  const voiceDsp = el('input', { type: 'checkbox', checked: s.voiceDsp !== false, title: t('Applique aux sons de la VOIX uniquement (jamais aux sons de la soundboard) : annulation d\'écho, suppression de bruit et filtre de souffle. Décoche si ta voix sonne étouffée ou si tu utilises déjà un filtre Discord/Teams.') });
  const voiceLvl = el('select', {},
    el('option', { value: '1', text: t('Léger') }),
    el('option', { value: '2', text: t('Normal') }),
    el('option', { value: '3', text: t('Fort') }),
    el('option', { value: '4', text: t('Max') }));
  voiceLvl.value = String(s.voiceDspLvl ?? 2);
  voiceLvl.title = t('Intensité du traitement vocal : Léger = peu de coupe, Normal = équilibré, Fort = clavier/fond atténué, Max = bande passante très resserrée (la voix peut paraître plus étouffée/filtrée).');
  // Pas de listener 'change' -> save() : le worklet n'est reconstruit que
  // par « Appliquer » (applyAudio). Persister ici enregistrait une valeur
  // SANS effet jusqu'au prochain apply — no-op silencieux. Appliquer
  // relit voiceLvl.value (ligne ~380).
  const autoMic = el('input', { type: 'checkbox', checked: !!s.autoSwitchMic, title: t('Au lancement, l\'entrée micro Windows bascule sur « CABLE Output » (pour que Discord capte ta voix via le câble), puis revient à ton vrai micro à la fermeture ou en cas de crash.') });
  const watchMic = el('input', { type: 'checkbox', checked: s.watchdogMic !== false, title: t('Revérifie périodiquement que l\'entrée micro est toujours sur le câble. Se met en pause pour la session si tu changes le micro toi-même (Discord inclus).') });

  const normLufsIn = el('input', { type: 'number', min: -40, max: 0, step: 1, value: normLufsTarget(), title: t('Loudness cible en LUFS (volume perçu, pas le pic). -18 LUFS par défaut. Plus haut (proche de 0) = plus fort, plus bas = plus doux. Le limiteur en aval absorbe les dépassements.') });
  // Persiste la valeur des que le champ est valide — sinon « Normaliser
  // ce son » (editeur) ou un « Fermer » utilisaient l'ancienne cible.
  // Champ vide : +'' === 0 -> persistait normLufs = 0 (normalisation a
  // fond de TOUTE la bibliotheque au prochain « Normaliser »). '' = NaN
  // = invalide -> la valeur affichee revient a la cible reelle.
  const lufsField = () => { const r = normLufsIn.value.trim(); return r === '' ? NaN : +r; };
  normLufsIn.addEventListener('change', () => {
    const nl = lufsField();
    if (Number.isFinite(nl) && nl <= 0) { s.normLufs = Math.max(-40, nl); save(); }
    else normLufsIn.value = normLufsTarget(); // valeur refusee : re-affiche la cible reelle
  });
  const maxDurIn = el('input', { type: 'number', min: 0, max: 86400, step: 5, value: s.maxSoundDur ?? 45, title: t('Durée max jouée d\'un son en secondes (0 = illimité). Le fichier n\'est jamais coupé — seules les N premières secondes sont jouées. Une notification prévient la première fois qu\'un son est tronqué.') });
  maxDurIn.addEventListener('change', () => {
    // '' = NaN : +'' valait 0 = illimite, persiste silencieusement.
    const raw = maxDurIn.value.trim();
    const v = raw === '' ? NaN : +raw;
    if (Number.isFinite(v) && v >= 0) { s.maxSoundDur = Math.min(86400, v); save(); }
    else maxDurIn.value = s.maxSoundDur ?? 45;
  });
  const normTestBtn = el('button', { class: 'ghost', text: t('Tester'), title: t('Joue 1,2 s de bruit dont la loudness est exactement au niveau saisi — sur ton écoute locale uniquement (pas sur Discord).'), onclick: () => testNormLufs(normLufsIn.value) });
  const normProg = el('div', {});
  const normAllBtn = el('button', { text: t('Normaliser toute la bibliothèque'), title: t('Ramène la loudness perçue de chaque son au niveau LUFS ci-contre (la valeur saisie est appliquée d\'abord). Les fichiers audio ne sont jamais modifiés — seul le gain en lecture change. La progression s\'affiche ici, le panneau reste ouvert.'), onclick: async () => {
    // La valeur tapee est appliquee d'abord (le panneau ne se ferme plus) ;
    // la progression s'affiche en ligne dans normProg, « Appliquer » reste
    // utilisable pendant la normalisation.
    const nl = lufsField(); // '' = NaN : jamais 0 LUFS par coercion
    if (Number.isFinite(nl) && nl <= 0) { s.normLufs = Math.max(-40, nl); save(); }
    normAllBtn.disabled = true;
    try { await normalizeAll(normProg); }
    catch (e) { logErr('normalizeAll', e); toast(t('Normalisation interrompue : {err}', { err: (e && e.message || e) }), 'warn'); }
    finally { normAllBtn.disabled = false; }
  } });
  // Reset volume+normalisation : confirmation en deux clics (pas de
  // confirmBox : modal() fermerait le panneau des reglages).
  let resetArmed = false, resetArmTimer = null;
  const resetSoundsBtn = el('button', { class: 'ghost', text: t('Remettre volume et normalisation à zéro'), title: t('Chaque son revient à volume 100 % et normalisation ×1. Découpes, fondus, favoris, catégories et raccourcis ne sont pas touchés.'), onclick: () => {
    if (!resetArmed) {
      resetArmed = true;
      resetSoundsBtn.textContent = t('Confirmer : tous les sons → 100 % / ×1');
      resetSoundsBtn.classList.add('danger');
      resetArmTimer = setTimeout(() => { resetArmed = false; resetSoundsBtn.textContent = t('Remettre volume et normalisation à zéro'); resetSoundsBtn.classList.remove('danger'); }, 4000);
      return;
    }
    clearTimeout(resetArmTimer); resetArmed = false;
    resetSoundsBtn.textContent = t('Remettre volume et normalisation à zéro');
    resetSoundsBtn.classList.remove('danger');
    let n = 0;
    for (const snd of cfg.sounds) { if (snd.volume !== 100 || (snd.norm ?? 1) !== 1) { snd.volume = 100; snd.norm = 1; n++; } }
    save(); renderAll();
    toast(n ? t('{n} son(s) remis à 100 % / ×1.', { n }) : t('Tous les sons sont déjà à 100 % / ×1.'));
  } });

  const exportBtn = el('button', { text: t('Exporter la configuration'), onclick: exportConfig });
  const importBtn = el('button', { text: t('Importer une configuration'), onclick: () => importConfig(closeSettings) });

  // ---- rapports d'erreurs (opt-in, crashs/erreurs uniquement) ----
  const crashLbl = el('span', { class: 'hint', text: '' });
  const refreshCrashLbl = () => {
    crashLbl.textContent = s.crashReport === 'yes'
      ? t('Activé — les rapports anonymisés sont envoyés en cas de plantage.')
      : s.crashReport === 'no'
        ? t('Désactivé — aucun rapport n\'est collecté ni envoyé.')
        : t('Pas encore choisi — la demande apparaît à chaque lancement tant qu\'aucun choix n\'est fait.');
  };
  const setCrash = (v) => {
    if (v === 'yes' || v === 'no') s.crashReport = v; else delete s.crashReport;
    save();
    // Le main purge la file locale immediatement si le choix n'est plus 'yes'.
    try { window.sf.reportConsent(v === 'yes' ? 'yes' : v === 'no' ? 'no' : ''); } catch {}
    refreshCrashLbl();
  };
  const crashYesBtn = el('button', { text: t('Accepter'), title: t('Envoie des rapports de diagnostic anonymisés en cas de plantage.'), onclick: () => { setCrash('yes'); toast(t('Rapports d\'erreurs activés.'), 'info'); } });
  const crashNoBtn = el('button', { class: 'ghost', text: t('Refuser'), title: t('Aucun rapport collecté ni envoyé — la file locale est purgée.'), onclick: () => { setCrash('no'); toast(t('Rapports d\'erreurs désactivés.'), 'info'); } });
  const crashLaterBtn = el('button', { class: 'ghost', text: t('Plus tard'), title: t('Redemande le choix au prochain lancement.'), onclick: () => setCrash('') });
  refreshCrashLbl();

  const cableVerifyBtn = el('button', { class: 'ghost', text: t('Vérifier'), onclick: async () => {
    cableVerifyBtn.disabled = true; cableVerifyBtn.textContent = t('Vérification…');
    try {
      await refreshDevices(false); resolveDevices(); updateCableUi();
      await applyAudio().catch((e) => logErr('applyAudio', e));
    } finally {
      cableVerifyBtn.disabled = false; cableVerifyBtn.textContent = t('Vérifier');
    }
    if (!cablePresent()) toast(t('VB-CABLE toujours absent — si tu viens de l\'installer, redémarre Windows.'), 'warn');
    else toast(t('VB-CABLE détecté — périphériques prêts.'));
  } });
  const cableInstallBtn = el('button', { class: 'ghost', text: t('Installer VB-CABLE…'), onclick: () => showCableScreen() });

  // Panneau « Paramètres » style Discord : navigation laterale groupee
  // par categorie + sections detaillees (titre + description + champs).
  // Selecteur de langue : applique immediatement (applyLanguage re-rend
  // grille + textes statiques sans reload ; ce panneau reste ouvert avec
  // ses textes d'origine jusqu'a sa prochaine ouverture).
  const langSel = el('select', {}, SFI18n.langs().map((code) =>
    el('option', { value: code, text: LANG_NAMES[code] || code, selected: code === (s.lang || 'fr') })));
  langSel.addEventListener('change', () => { applyLanguage(langSel.value); });

  const groups = [
    { cat: t('Audio'), icon: '🔊', label: t('Sortie audio'), desc: t('Par où sortent les sons de la soundboard : la sortie Discord (câble virtuel VB-CABLE) et ton écoute locale. La voix du micro a son propre chemin — voir « Micro & voix ».'), nodes: [
      ...(IS_LINUX ? [] : [
        el('div', { class: 'hint', text: t('★ = choix recommandé (bordure rose) · ⚠ = à éviter (bordure rouge). Pour faire fonctionner la soundboard : sortie Discord = CABLE Input, écoute locale = ton casque, micro = ton vrai micro.') }),
        field(t('Sortie vers Discord (micro virtuel)'), el('div', { class: 'row' }, cableSel, cableVerifyBtn, cableInstallBtn),
          cablePresent() ? t('Choisis « CABLE Input ». Dans Discord, mets « CABLE Output » comme micro.')
            : t('Aucun câble virtuel détecté : la diffusion vers Discord est désactivée. VB-CABLE est un pilote gratuit de VB-Audio, à installer toi-même (vb-audio.com/Cable), puis redémarre le PC.')),
      ]),
      field(t('Écoute locale (ton casque)'), monSel, s.monId && s.monId === s.cableId
        ? t('⚠ Écoute locale = sortie Discord : tu risks une boucle/écho — choisis un périphérique différent.')
        : t('Choisis ton casque/écoute habituelle — pas un périphérique « CABLE » (boucle).')),
    ]},
    { cat: t('Audio'), icon: '🎙', label: t('Micro & voix'), desc: t('Le micro est capté séparément des sons : son volume ne suit PAS le curseur master (réglage Windows/Discord). Le traitement vocal n\'agit que sur ta voix, jamais sur les sons.'), nodes: [
      field(t('Mon micro'), micSel, t('Le vrai micro est ★ ; les périphériques virtuels (CABLE Output, Voicemeeter…) sont ⚠ déconseillés ici.')),
      el('label', { class: 'check' }, mix,
        el('span', { text: t('Mixer mon micro dans la sortie Discord (sinon tes potes n\'entendent que les sons). Décoche si tu utilises « Écouter ce périphérique » de Windows.') })),
      ...(IS_LINUX ? [] : [
        field(t('Bascule micro automatique'), el('label', { class: 'check' }, autoMic,
          el('span', { text: t('Au lancement, SEUL le micro (entrée Windows) passe sur « CABLE Output » et revient à ton micro à la fermeture — tes sorties (Discord, écoute locale) restent sur tes périphériques habituels. Dans Discord, choisis « Défaut » comme périphérique d\'entrée pour que ça suive.') }))),
        field(t('Surveillance micro automatique'), el('label', { class: 'check' }, watchMic,
          el('span', { text: t('Pendant que SoundFart tourne, revérifie régulièrement que l\'entrée micro est toujours sur le câble. Si tu changes le micro toi-même (ou qu\'une app le change), la surveillance se met en pause jusqu\'au prochain lancement.') }))),
        field(t('Récupération micro'), el('button', { class: 'ghost', text: t('Restaurer mon micro Windows'), title: t('Force le retour de l\'entrée micro Windows sur ton vrai micro — à utiliser si elle est restée bloquée sur « CABLE Output » (crash, coupure).'), onclick: () => {
            window.sf.restoreMic(true);
            toast(t('Restauration du micro demandée — si l\'entrée était bloquée sur le câble, elle revient sur ton micro.'), 'info');
          } }),
          t('À utiliser si ton micro Windows est resté bloqué sur « CABLE Output » (coupure, crash). Ramène l\'entrée sur ton vrai micro.')),
      ]),
      field(t('Traitement vocal'), el('label', { class: 'check' }, voiceDsp,
        el('span', { text: t('Réduction de bruit et écho sur la voix uniquement — n\'affecte pas les sons. Le gain micro reste indépendant du volume general.') })),
        t('Agit sur le micro envoyé à Discord : annulation d\'écho, suppression de bruit et filtre passe-bande (coupe les graves de clavier et le souffle). Décoche si ta voix sonne étouffée ou si tu utilises déjà un filtre Discord/Teams.')),
      field(t('Intensité'), el('div', { class: 'row' }, voiceLvl),
        t('Léger = peu de coupe · Normal = équilibré · Fort = clavier/fond atténué · Max = voix très filtrée (bande passante étroite — testez sur Discord).')),
    ]},
    { cat: t('Bibliothèque'), icon: '📚', label: t('Bibliothèque'), desc: t('Niveaux de lecture des sons : normalisation loudness (mesurée en interne, fichiers jamais modifiés) et durée maximale jouée.'), nodes: [
      field(t('Niveaux audio'), el('div', {},
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: t('Cible loudness (LUFS) :') }), normLufsIn, el('span', { class: 'hint', text: 'LUFS' }), normTestBtn, normAllBtn),
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: t('Durée max par son (s, 0 = illimité) :') }), maxDurIn),
        normProg),
        t('Ramène la loudness perçue de chaque son au niveau cible sans dépasser le plafond de pic (-1 dBFS). Mesure 100 % interne (BS.1770), aucun téléchargement — les fichiers ne sont pas modifiés.')),
      field(t('Réinitialiser'), el('div', { class: 'row' }, resetSoundsBtn),
        t('Remet chaque son à volume 100 % et normalisation ×1 (cliquer deux fois pour confirmer).')),
      field(t('Imports non ajoutés'), orphanBtn2,
        t('Fichiers présents dans imports/ mais pas encore dans ta bibliothèque (téléchargements YouTube dont la fenêtre a été fermée sans « Ajouter »).')),
    ]},
    { cat: t('Bibliothèque'), icon: '🗄', label: t('Données & stockage'), desc: t('Où SoundFart range les fichiers qu\'il crée et où sont ses réglages. Ton dossier de sons est choisi une fois ; les réglages restent dans %APPDATA%\\SoundFart.'), nodes: [
      field(t('Dossier de sons'), el('div', { class: 'row' }, dirLbl, pickDirBtn, openDirBtn, resetDirBtn),
        t('Tous les fichiers créés par SoundFart vont dans ce dossier : sons ajoutés copiés dans sons/, imports YouTube dans imports/, enregistrements dans recordings/, extraits MP3 dans cuts/. Obligatoire dès le premier ajout — un choix est aussi proposé à chaque action.')),
    ]},
    { cat: t('Général'), icon: '⚙', label: t('Général'), desc: t('Langue de l\'interface, raccourcis globaux, rapports d\'erreurs et sauvegarde de la configuration.'), nodes: [
      field(t('Langue / Language'), langSel,
        t('Langue de l\'interface — appliquée immédiatement.')),
      field(t('Raccourci global STOP'), el('div', { class: 'row' }, stopBtn), stopHint),
      field(t('Sauvegarde'), el('div', { class: 'row' }, exportBtn, importBtn),
        t('La configuration contient les références aux fichiers, catégories, découpes, raccourcis et favoris — pas les fichiers audio eux-mêmes.')),
      field(t('Rapports d\'erreurs'), el('div', {},
        el('div', { class: 'row' }, crashYesBtn, crashNoBtn, crashLaterBtn),
        crashLbl),
        t('Envoie uniquement des diagnostics de plantage (version, OS, erreur, stack) à un serveur privé en HTTPS — jamais tes sons, chemins ni réglages (remplacés par des placeholders). Révocable à tout moment ; « Plus tard » redemande au prochain lancement.')),
    ]},
  ];
  const layout = el('div', { class: 'settings-layout' });
  const nav = el('div', { class: 'set-nav' });
  const panes = el('div', { class: 'set-panes' });
  const paneList = [];
  let lastCat = null;
  for (const g of groups) {
    if (g.cat !== lastCat) { lastCat = g.cat; nav.append(el('div', { class: 'set-nav-cat', text: g.cat })); }
    const btn = el('button', { class: 'ghost' },
      el('span', { class: 'set-ico', text: g.icon || '' }), g.label);
    const pane = el('div', { class: 'set-pane', hidden: true },
      el('h3', {}, el('span', { class: 'set-ico', text: g.icon || '' }), g.label),
      el('div', { class: 'hint set-desc', text: g.desc }),
      ...g.nodes);
    panes.append(pane); paneList.push({ btn, pane });
    nav.append(btn);
  }
  const activatePane = (i) => paneList.forEach((p, j) => { p.btn.classList.toggle('on', i === j); p.pane.hidden = i !== j; });
  paneList.forEach((p, i) => { p.btn.onclick = () => activatePane(i); });
  if (paneList.length) activatePane(0);
  layout.append(nav, panes);

  const closeSettings = modal(t('Paramètres'), [layout], [
    { label: t('Fermer'), onclick: (c) => c() },
    { label: t('Appliquer'), kind: 'primary', onclick: async (c) => {
      // Enumeration degradee ou liste vide (permission refusee, transitoire) :
      // un select sans option pour l'id courant renverrait '' et effacerait
      // le reglage — on conserve l'existant dans ce cas seulement.
      const pickVal = (sel, list, curId, curLabel) => {
        const noEnum = audio.devicesDegraded || !list || !list.length;
        if (noEnum && curId && ![...sel.options].some((o) => o.value === curId)) return { id: curId, label: curLabel };
        const id = sel.value;
        // Select fige a l'ouverture du panneau : si l'id choisi n'existe
        // plus dans la liste a jour (devicechange pendant le panneau
        // ouvert), on retombe sur '' plutot que de persister un
        // peripherique disparu — sinon Appliquer annulait la
        // re-resolution automatique de resolveDevices().
        if (id && list && list.length && !list.some((d) => d.deviceId === id)) return { id: '', label: '' };
        return { id, label: lbl(sel) };
      };
      const cv = pickVal(cableSel, audio.devices.out, s.cableId, s.cableLabel);
      s.cableId = cv.id; s.cableLabel = cv.label;
      const mv = pickVal(monSel, audio.devices.out, s.monId, s.monLabel);
      s.monId = mv.id; s.monLabel = mv.label;
      const iv = pickVal(micSel, audio.devices.inp, s.micId, s.micLabel);
      // micAutoPicked : l'utilisateur a EXPLICITEMENT choisi « (auto) » —
      // seul cas ou micId est efface. Sinon '' preserve l'existant car le
      // placeholder s'affiche aussi quand le peripherique configure a
      // disparu de la liste (effacer ici perdrait le reglage sans action).
      // MicId vide -> applyAudioInner prend le premier vrai micro non
      // virtuel ; pas de label '(choisir…)' stocke.
      if (micAutoPicked) { s.micId = ''; s.micLabel = ''; }
      else { s.micId = iv.id || s.micId || ''; s.micLabel = iv.id ? iv.label : s.micLabel; }
      s.micMix = mix.checked;
      s.stopShortcut = stopSc || '';
      s.storageDir = s.storageDir || '';
      s.autoSwitchMic = autoMic.checked;
      s.watchdogMic = watchMic.checked;
      s.voiceDsp = voiceDsp.checked;
      s.voiceDspLvl = Math.min(4, Math.max(1, +voiceLvl.value || 2));
      const nl = +normLufsIn.value;
      s.normLufs = (Number.isFinite(nl) && nl <= 0) ? Math.max(-40, nl) : defaults().settings.normLufs;
      const md = +maxDurIn.value;
      if (Number.isFinite(md) && md >= 0) s.maxSoundDur = Math.min(86400, md);
      save(); c();
      if (await applyAudio().catch((e) => { logErr('applyAudio', e); return false; })) toast(t('Réglages audio appliqués.'));
      applyShortcuts();
      if (cablePresent()) window.sf.audioAutoSetup({ enabled: s.autoSwitchMic, cableLabel: s.cableLabel }).then((r) => {
        if (r && r.changed) toast(t('Entrée micro basculée sur {dev} (restaurée à la fermeture).', { dev: r.device }));
        else if (r && !r.ok) toast(t('Bascule micro auto impossible : {err}', { err: r.err }), 'warn');
      }).catch((e) => logErr('audioAutoSetup', e));
    } },
  ], { wide: true, cls: 'settings', onClose: () => { stopCleanup(); if (resetArmTimer) { clearTimeout(resetArmTimer); resetArmTimer = null; resetArmed = false; } } });
}
