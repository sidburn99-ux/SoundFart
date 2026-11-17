// ================================================================
// reglages + sauvegarde
// Extrait de app.js — depend des globals du script principal (chargé en dernier).
// ================================================================ reglages audio
// ================================================================ sauvegarde (export/import)
function exportConfig() {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soundfart-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Configuration exportée (références uniquement, pas les fichiers audio).');
}

// Propose le dossier de destination avant un ajout (YouTube, enregistrement).
// Pre-rempli avec le dernier choix (lastDestDir) ou le dossier de stockage.
function askDestDir(extraButtons, extraNodes) {
  return new Promise((resolve) => {
    const inp = el('input', { type: 'text', value: cfg.settings.storageDir || cfg.settings.lastDestDir || '' });
    // input DOIT etre dans .field : sinon il garde le style natif (fond
    // blanc) avec le texte clair herite -> illisible (retour terrain).
    inp.style.width = '100%';
    modal('Dossier de destination', [
      field('Dossier', inp, cfg.settings.storageDir
        ? 'Laisse vide pour utiliser ton dossier de sons principal.'
        : 'Choisis le dossier où le fichier sera enregistré — ce sera aussi ton dossier de sons principal.'),
      ...(extraNodes || []),
    ], [
      ...(extraButtons || []),
      { label: 'Annuler', onclick: (c) => { resolve(null); c(); } },
      { label: 'Choisir…', onclick: async () => { try { const d = await window.sf.pickDir(); if (d) inp.value = d; } catch (e) { logErr('pickDir', e); } } },
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
      if (f.size > 8 * 1024 * 1024) throw new Error('fichier trop volumineux (> 8 Mo)');
      const parsed = JSON.parse(await f.text());
      if (!parsed || !Array.isArray(parsed.sounds)) throw new Error('fichier invalide');
      // confirmBox DETUIT le panneau (slot modal unique) AVANT la reponse :
      // sur « Annuler » on rouvre les reglages — mais SEULEMENT si
      // l'import venait du panneau (onDone fourni) ; depuis le menu F11 il
      // n'y avait pas de panneau a restaurer.
      if (!(await confirmBox('Importer la configuration ?', 'La configuration actuelle (sons, catégories, réglages, raccourcis) sera remplacée. Les fichiers audio ne sont pas modifiés.', 'Importer'))) { if (onDone) settingsModal(); return; }
      // Pas de teardownAudio() direct ici : applyAudio() passe par
      // audioApplyChain et fait deja le teardown — un appel direct
      // pendant qu'un applyAudioInner est en vol pouvait etre suivi
      // d'une recreation avec l'ANCIENNE config (SF-REL-0619).
      cfg = normalizeCfg(parsed);
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
        if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
        else if (r && !r.ok) toast('Bascule micro auto impossible : ' + r.err, 'warn');
      }).catch((e) => logErr('audioAutoSetup', e));
      checkMissing().catch((e) => logErr('checkMissing', e)); // re-verifie les chemins des sons importes
      toast('Configuration importée.');
      if (onDone) onDone();
    } catch (e) { toast('Import impossible : ' + e.message, 'warn'); }
  });
  inp.click();
}

function settingsModal() {
  const s = cfg.settings;
  const opts = (list, selected, withNone) => [
    withNone ? el('option', { value: '', text: '(aucune)' }) : null,
    list.map((d) => el('option', { value: d.deviceId, text: d.label || d.deviceId, selected: d.deviceId === selected })),
  ];
  const cableSel = el('select', {}, el('option', { value: '', text: '(choisir…)' }), opts(audio.devices.out, s.cableId, false));
  const monSel = el('select', {}, opts(audio.devices.out, s.monId, true));
  // Placeholder « (choisir…) » comme cableSel : sans lui, un micId vide
  // selecionnait silencieusement le 1er peripherique (eventuellement un
  // virtuel) a l'application des reglages.
  const micSel = el('select', {}, el('option', { value: '', text: '(auto — premier vrai micro)' }), opts(audio.devices.inp, s.micId, false));
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
  const stopBtn = el('button', { text: stopSc ? fmtAccel(stopSc) : 'Aucun — cliquer pour définir', title: 'Raccourci clavier GLOBAL : interrompt tous les sons en cours, même fenêtre minimisée ou dans une autre application.' });
  const stopHint = el('div', { class: 'hint', text: 'Interrompt immédiatement tous les sons en cours, même fenêtre minimisée.' });
  let stopCleanup = () => {};
  stopBtn.addEventListener('click', () => {
    stopCleanup();
    stopBtn.textContent = 'Appuie sur le raccourci… (Échap pour annuler)';
    const disarm = () => {
      window.removeEventListener('keydown', onKey, true);
      stopCleanup = () => {};
      stopBtn.textContent = stopSc ? fmtAccel(stopSc) : 'Aucun — cliquer pour définir';
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { disarm(); return; }
      const acc = buildAccel(e);
      if (!acc) { stopHint.textContent = 'Ajoute un modifieur (Ctrl, Alt, Maj) ou utilise une touche F.'; return; }
      // Meme source de verite que les raccourcis de sons : couvre les sons,
      // le STOP existant ET les accesseurs du menu (Ctrl+F/O, F12).
      if (normAccel(acc) !== normAccel(stopSc || '')) {
        const owner = findShortcutOwner(acc);
        if (owner) { stopHint.textContent = 'Ce raccourci est déjà attribué à ' + owner + '.'; return; }
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
  const resetStorageDir = () => { s.storageDir = ''; dirLbl.textContent = 'Non choisi — sera demandé à la prochaine création de fichier'; updateStorageUi(); save(); };
  window.sf.getDataDir().then((d) => {
    const lbl = 'Réglages et outils : ' + d;
    if (!s.storageDir) dirLbl.textContent = 'Non choisi — sera demandé à la prochaine création de fichier';
  }).catch((e) => logErr('getDataDir', e));
  const dirLbl = el('div', { class: 'hint path', text: (s.storageDir || 'Non choisi — sera demandé à la prochaine création de fichier') + ' — sons ajoutés dans sons/, YouTube dans imports/, micro dans recordings/, extraits dans cuts/' });
  const openDirBtn = el('button', { class: 'ghost', text: 'Ouvrir', title: 'Ouvre le dossier de stockage dans l\'Explorateur', onclick: () => window.sf.openDir(s.storageDir || '').catch((e) => logErr('openDir', e)) });
  const pickDirBtn = el('button', { text: 'Choisir…', title: 'Choisit le dossier racine où SoundFart range ses fichiers (imports/, recordings/, cuts/).', onclick: async () => {
    try {
      const d = await window.sf.pickDir();
      // save() des maintenant : sans lui, un crash avant le prochain
      // save() perdaient le choix (seul beforeunload couvrait).
      if (d) { s.storageDir = d; dirLbl.textContent = d; updateStorageUi(); save(); }
    } catch (e) { logErr('pickDir', e); }
  } });
  const resetDirBtn = el('button', { class: 'ghost', text: 'Réinitialiser', title: 'Oublie le dossier choisi : il sera redemandé à la prochaine création de fichier.', onclick: resetStorageDir });
  const orphanBtn2 = el('button', { text: 'Parcourir les fichiers non ajoutés…', onclick: () => orphanImportsModal().catch((e) => logErr('orphanImports', e)) });
  const voiceDsp = el('input', { type: 'checkbox', checked: s.voiceDsp !== false, title: 'Applique aux sons de la VOIX uniquement (jamais aux sons de la soundboard) : annulation d\'écho, suppression de bruit et filtre de souffle. Décoche si ta voix sonne étouffée ou si tu utilises déjà un filtre Discord/Teams.' });
  const voiceLvl = el('select', {},
    el('option', { value: '1', text: 'Léger' }),
    el('option', { value: '2', text: 'Normal' }),
    el('option', { value: '3', text: 'Fort' }),
    el('option', { value: '4', text: 'Max' }));
  voiceLvl.value = String(s.voiceDspLvl ?? 2);
  voiceLvl.title = 'Intensité du traitement vocal : Léger = peu de coupe, Normal = équilibré, Fort = clavier/fond atténué, Max = bande passante très resserrée (la voix peut paraître plus étouffée/filtrée).';
  // Pas de listener 'change' -> save() : le worklet n'est reconstruit que
  // par « Appliquer » (applyAudio). Persister ici enregistrait une valeur
  // SANS effet jusqu'au prochain apply — no-op silencieux. Appliquer
  // relit voiceLvl.value (ligne ~380).
  const autoMic = el('input', { type: 'checkbox', checked: !!s.autoSwitchMic, title: 'Au lancement, l\'entrée micro Windows bascule sur « CABLE Output » (pour que Discord capte ta voix via le câble), puis revient à ton vrai micro à la fermeture ou en cas de crash.' });
  const watchMic = el('input', { type: 'checkbox', checked: s.watchdogMic !== false, title: 'Revérifie périodiquement que l\'entrée micro est toujours sur le câble. Se met en pause pour la session si tu changes le micro toi-même (Discord inclus).' });

  const normLufsIn = el('input', { type: 'number', min: -40, max: 0, step: 1, value: normLufsTarget(), title: 'Loudness cible en LUFS (volume perçu, pas le pic). -18 LUFS par défaut. Plus haut (proche de 0) = plus fort, plus bas = plus doux. Le limiteur en aval absorbe les dépassements.' });
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
  const maxDurIn = el('input', { type: 'number', min: 0, max: 86400, step: 5, value: s.maxSoundDur ?? 45, title: 'Durée max jouée d\'un son en secondes (0 = illimité). Le fichier n\'est jamais coupé — seules les N premières secondes sont jouées. Une notification prévient la première fois qu\'un son est tronqué.' });
  maxDurIn.addEventListener('change', () => {
    // '' = NaN : +'' valait 0 = illimite, persiste silencieusement.
    const raw = maxDurIn.value.trim();
    const v = raw === '' ? NaN : +raw;
    if (Number.isFinite(v) && v >= 0) { s.maxSoundDur = Math.min(86400, v); save(); }
    else maxDurIn.value = s.maxSoundDur ?? 45;
  });
  const normTestBtn = el('button', { class: 'ghost', text: 'Tester', title: 'Joue 1,2 s de bruit dont la loudness est exactement au niveau saisi — sur ton écoute locale uniquement (pas sur Discord).', onclick: () => testNormLufs(normLufsIn.value) });
  const normProg = el('div', {});
  const normAllBtn = el('button', { text: 'Normaliser toute la bibliothèque', title: 'Ramène la loudness perçue de chaque son au niveau LUFS ci-contre (la valeur saisie est appliquée d\'abord). Les fichiers audio ne sont jamais modifiés — seul le gain en lecture change. La progression s\'affiche ici, le panneau reste ouvert.', onclick: async () => {
    // La valeur tapee est appliquee d'abord (le panneau ne se ferme plus) ;
    // la progression s'affiche en ligne dans normProg, « Appliquer » reste
    // utilisable pendant la normalisation.
    const nl = lufsField(); // '' = NaN : jamais 0 LUFS par coercion
    if (Number.isFinite(nl) && nl <= 0) { s.normLufs = Math.max(-40, nl); save(); }
    normAllBtn.disabled = true;
    try { await normalizeAll(normProg); }
    catch (e) { logErr('normalizeAll', e); toast('Normalisation interrompue : ' + (e && e.message || e), 'warn'); }
    finally { normAllBtn.disabled = false; }
  } });
  // Reset volume+normalisation : confirmation en deux clics (pas de
  // confirmBox : modal() fermerait le panneau des reglages).
  let resetArmed = false, resetArmTimer = null;
  const resetSoundsBtn = el('button', { class: 'ghost', text: 'Remettre volume et normalisation à zéro', title: 'Chaque son revient à volume 100 % et normalisation ×1. Découpes, fondus, favoris, catégories et raccourcis ne sont pas touchés.', onclick: () => {
    if (!resetArmed) {
      resetArmed = true;
      resetSoundsBtn.textContent = 'Confirmer : tous les sons → 100 % / ×1';
      resetSoundsBtn.classList.add('danger');
      resetArmTimer = setTimeout(() => { resetArmed = false; resetSoundsBtn.textContent = 'Remettre volume et normalisation à zéro'; resetSoundsBtn.classList.remove('danger'); }, 4000);
      return;
    }
    clearTimeout(resetArmTimer); resetArmed = false;
    resetSoundsBtn.textContent = 'Remettre volume et normalisation à zéro';
    resetSoundsBtn.classList.remove('danger');
    let n = 0;
    for (const snd of cfg.sounds) { if (snd.volume !== 100 || (snd.norm ?? 1) !== 1) { snd.volume = 100; snd.norm = 1; n++; } }
    save(); renderAll();
    toast(n ? `${n} son(s) remis à 100 % / ×1.` : 'Tous les sons sont déjà à 100 % / ×1.');
  } });

  const exportBtn = el('button', { text: 'Exporter la configuration', onclick: exportConfig });
  const importBtn = el('button', { text: 'Importer une configuration', onclick: () => importConfig(closeSettings) });

  // ---- rapports d'erreurs (opt-in, crashs/erreurs uniquement) ----
  const crashLbl = el('span', { class: 'hint', text: '' });
  const refreshCrashLbl = () => {
    crashLbl.textContent = s.crashReport === 'yes'
      ? 'Activé — les rapports anonymisés sont envoyés en cas de plantage.'
      : s.crashReport === 'no'
        ? 'Désactivé — aucun rapport n\'est collecté ni envoyé.'
        : 'Pas encore choisi — la demande apparaît à chaque lancement tant qu\'aucun choix n\'est fait.';
  };
  const setCrash = (v) => {
    if (v === 'yes' || v === 'no') s.crashReport = v; else delete s.crashReport;
    save();
    // Le main purge la file locale immediatement si le choix n'est plus 'yes'.
    try { window.sf.reportConsent(v === 'yes' ? 'yes' : v === 'no' ? 'no' : ''); } catch {}
    refreshCrashLbl();
  };
  const crashYesBtn = el('button', { text: 'Accepter', title: 'Envoie des rapports de diagnostic anonymisés en cas de plantage.', onclick: () => { setCrash('yes'); toast('Rapports d\'erreurs activés.', 'info'); } });
  const crashNoBtn = el('button', { class: 'ghost', text: 'Refuser', title: 'Aucun rapport collecté ni envoyé — la file locale est purgée.', onclick: () => { setCrash('no'); toast('Rapports d\'erreurs désactivés.', 'info'); } });
  const crashLaterBtn = el('button', { class: 'ghost', text: 'Plus tard', title: 'Redemande le choix au prochain lancement.', onclick: () => setCrash('') });
  refreshCrashLbl();

  const cableVerifyBtn = el('button', { class: 'ghost', text: 'Vérifier', onclick: async () => {
    cableVerifyBtn.disabled = true; cableVerifyBtn.textContent = 'Vérification…';
    try {
      await refreshDevices(false); resolveDevices(); updateCableUi();
      await applyAudio().catch((e) => logErr('applyAudio', e));
    } finally {
      cableVerifyBtn.disabled = false; cableVerifyBtn.textContent = 'Vérifier';
    }
    if (!cablePresent()) toast('VB-CABLE toujours absent — si tu viens de l\'installer, redémarre Windows.', 'warn');
    else toast('VB-CABLE détecté — périphériques prêts.');
  } });
  const cableInstallBtn = el('button', { class: 'ghost', text: 'Installer VB-CABLE…', onclick: () => showCableScreen() });

  // Panneau « Paramètres » style Discord : navigation laterale groupee
  // par categorie + sections detaillees (titre + description + champs).
  const groups = [
    { cat: 'Audio', icon: '🔊', label: 'Sortie audio', desc: 'Par où sortent les sons de la soundboard : la sortie Discord (câble virtuel VB-CABLE) et ton écoute locale. La voix du micro a son propre chemin — voir « Micro & voix ».', nodes: [
      el('div', { class: 'hint', text: '★ = choix recommandé (bordure rose) · ⚠ = à éviter (bordure rouge). Pour faire fonctionner la soundboard : sortie Discord = CABLE Input, écoute locale = ton casque, micro = ton vrai micro.' }),
      field('Sortie vers Discord (micro virtuel)', el('div', { class: 'row' }, cableSel, cableVerifyBtn, cableInstallBtn),
        cablePresent() ? 'Choisis « CABLE Input ». Dans Discord, mets « CABLE Output » comme micro.'
          : 'Aucun câble virtuel détecté : la diffusion vers Discord est désactivée. VB-CABLE est un pilote gratuit de VB-Audio, à installer toi-même (vb-audio.com/Cable), puis redémarre le PC.'),
      field('Écoute locale (ton casque)', monSel, s.monId && s.monId === s.cableId
        ? '⚠ Écoute locale = sortie Discord : tu risks une boucle/écho — choisis un périphérique différent.'
        : 'Choisis ton casque/écoute habituelle — pas un périphérique « CABLE » (boucle).'),
    ]},
    { cat: 'Audio', icon: '🎙', label: 'Micro & voix', desc: 'Le micro est capté séparément des sons : son volume ne suit PAS le curseur master (réglage Windows/Discord). Le traitement vocal n\'agit que sur ta voix, jamais sur les sons.', nodes: [
      field('Mon micro', micSel, 'Le vrai micro est ★ ; les périphériques virtuels (CABLE Output, Voicemeeter…) sont ⚠ déconseillés ici.'),
      el('label', { class: 'check' }, mix,
        el('span', { text: 'Mixer mon micro dans la sortie Discord (sinon tes potes n\'entendent que les sons). Décoche si tu utilises « Écouter ce périphérique » de Windows.' })),
      field('Bascule micro automatique', el('label', { class: 'check' }, autoMic,
        el('span', { text: 'Au lancement, SEUL le micro (entrée Windows) passe sur « CABLE Output » et revient à ton micro à la fermeture — tes sorties (Discord, écoute locale) restent sur tes périphériques habituels. Dans Discord, choisis « Défaut » comme périphérique d\'entrée pour que ça suive.' }))),
      field('Surveillance micro automatique', el('label', { class: 'check' }, watchMic,
        el('span', { text: 'Pendant que SoundFart tourne, revérifie régulièrement que l\'entrée micro est toujours sur le câble. Si tu changes le micro toi-même (ou qu\'une app le change), la surveillance se met en pause jusqu\'au prochain lancement.' }))),
      field('Récupération micro', el('button', { class: 'ghost', text: 'Restaurer mon micro Windows', title: 'Force le retour de l\'entrée micro Windows sur ton vrai micro — à utiliser si elle est restée bloquée sur « CABLE Output » (crash, coupure).', onclick: () => {
          window.sf.restoreMic(true);
          toast('Restauration du micro demandée — si l\'entrée était bloquée sur le câble, elle revient sur ton micro.', 'info');
        } }),
        'À utiliser si ton micro Windows est resté bloqué sur « CABLE Output » (coupure, crash). Ramène l\'entrée sur ton vrai micro.'),
      field('Traitement vocal', el('label', { class: 'check' }, voiceDsp,
        el('span', { text: 'Réduction de bruit et écho sur la voix uniquement — n\'affecte pas les sons. Le gain micro reste indépendant du volume general.' })),
        'Agit sur le micro envoyé à Discord : annulation d\'écho, suppression de bruit et filtre passe-bande (coupe les graves de clavier et le souffle). Décoche si ta voix sonne étouffée ou si tu utilises déjà un filtre Discord/Teams.'),
      field('Intensité', el('div', { class: 'row' }, voiceLvl),
        'Léger = peu de coupe · Normal = équilibré · Fort = clavier/fond atténué · Max = voix très filtrée (bande passante étroite — testez sur Discord).'),
    ]},
    { cat: 'Bibliothèque', icon: '📚', label: 'Bibliothèque', desc: 'Niveaux de lecture des sons : normalisation loudness (mesurée en interne, fichiers jamais modifiés) et durée maximale jouée.', nodes: [
      field('Niveaux audio', el('div', {},
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: 'Cible loudness (LUFS) :' }), normLufsIn, el('span', { class: 'hint', text: 'LUFS' }), normTestBtn, normAllBtn),
        el('div', { class: 'row' },
          el('span', { class: 'hint', text: 'Durée max par son (s, 0 = illimité) :' }), maxDurIn),
        normProg),
        'Ramène la loudness perçue de chaque son au niveau cible sans dépasser le plafond de pic (-1 dBFS). Mesure 100 % interne (BS.1770), aucun téléchargement — les fichiers ne sont pas modifiés.'),
      field('Réinitialiser', el('div', { class: 'row' }, resetSoundsBtn),
        'Remet chaque son à volume 100 % et normalisation ×1 (cliquer deux fois pour confirmer).'),
      field('Imports non ajoutés', orphanBtn2,
        'Fichiers présents dans imports/ mais pas encore dans ta bibliothèque (téléchargements YouTube dont la fenêtre a été fermée sans « Ajouter »).'),
    ]},
    { cat: 'Bibliothèque', icon: '🗄', label: 'Données & stockage', desc: 'Où SoundFart range les fichiers qu\'il crée et où sont ses réglages. Ton dossier de sons est choisi une fois ; les réglages restent dans %APPDATA%\\SoundFart.', nodes: [
      field('Dossier de sons', el('div', { class: 'row' }, dirLbl, pickDirBtn, openDirBtn, resetDirBtn),
        'Tous les fichiers créés par SoundFart vont dans ce dossier : sons ajoutés copiés dans sons/, imports YouTube dans imports/, enregistrements dans recordings/, extraits MP3 dans cuts/. Obligatoire dès le premier ajout — un choix est aussi proposé à chaque action.'),
    ]},
    { cat: 'Général', icon: '⚙', label: 'Général', desc: 'Raccourcis globaux et sauvegarde de la configuration.', nodes: [
      field('Raccourci global STOP', el('div', { class: 'row' }, stopBtn), stopHint),
      field('Sauvegarde', el('div', { class: 'row' }, exportBtn, importBtn),
        'La configuration contient les références aux fichiers, catégories, découpes, raccourcis et favoris — pas les fichiers audio eux-mêmes.'),
      field('Rapports d\'erreurs', el('div', {},
        el('div', { class: 'row' }, crashYesBtn, crashNoBtn, crashLaterBtn),
        crashLbl),
        'Envoie uniquement des diagnostics de plantage (version, OS, erreur, stack) à un serveur privé en HTTPS — jamais tes sons, chemins ni réglages (remplacés par des placeholders). Révocable à tout moment ; « Plus tard » redemande au prochain lancement.'),
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

  const closeSettings = modal('Paramètres', [layout], [
    { label: 'Fermer', onclick: (c) => c() },
    { label: 'Appliquer', kind: 'primary', onclick: async (c) => {
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
      if (await applyAudio().catch((e) => { logErr('applyAudio', e); return false; })) toast('Réglages audio appliqués.');
      applyShortcuts();
      if (cablePresent()) window.sf.audioAutoSetup({ enabled: s.autoSwitchMic, cableLabel: s.cableLabel }).then((r) => {
        if (r && r.changed) toast('Entrée micro basculée sur ' + r.device + ' (restaurée à la fermeture).');
        else if (r && !r.ok) toast('Bascule micro auto impossible : ' + r.err, 'warn');
      }).catch((e) => logErr('audioAutoSetup', e));
    } },
  ], { wide: true, cls: 'settings', onClose: () => { stopCleanup(); if (resetArmTimer) { clearTimeout(resetArmTimer); resetArmTimer = null; resetArmed = false; } } });
}
