// Fonctions pures SoundFart — testables via node:test (Node) et exposees au
// renderer via window.SFUtils (script classic, CSP 'self').
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SFUtils = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const fs = typeof require === 'function' ? require('fs') : null;
  const path = typeof require === 'function' ? require('path') : null;

  const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.webm', '.mp4', '.mkv', '.mov', '.m4v'];
  const VIRTUAL_RE = /cable|virtual|voicemeeter|vb-audio/i;

  // Filtre « vrais peripheriques » : sans permission audio, Chromium
  // retourne des entrees generiques avec deviceId='' — pas une liste vide,
  // une detection degradee. Utilisee par refreshDevices (renderer).
  function realDevices(list) {
    return (Array.isArray(list) ? list : []).filter((d) => d && d.deviceId);
  }

  function parseEndpoints(out) {
    return String(out).split(/\r?\n/).filter(Boolean).map((l) => {
      const [flow, id, ...rest] = l.split('|');
      // Ligne malformee ('|' seule, texte sans separateur) : id/name
      // anonymes mais toujours des chaines — findCableCapture fait
      // name.toLowerCase() et plantait sur undefined.
      return { flow: flow || '', id: id || '', name: rest.join('|') || id || '' };
    });
  }

  function parseGet(out) {
    const r = { console: '', comm: '', multi: '' };
    for (const line of String(out).split(/\r?\n/)) {
      const m = /^(console|comm|multi)=(.*)$/.exec(line.trim());
      if (m) r[m[1]] = m[2];
    }
    return r;
  }

  function hasVirtualCable(endpoints) {
    return endpoints.some((e) => e.flow === 'render' && /cable/i.test(e.name) && VIRTUAL_RE.test(e.name));
  }

  function findCableCapture(endpoints, cableLabel) {
    const caps = endpoints.filter((e) => e.flow === 'capture');
    if (!caps.length) return null;
    const base = String(cableLabel || '');
    const candidates = [];
    if (base) {
      candidates.push(base.replace(/input/ig, 'Output'));
      candidates.push(base.replace(/input/ig, 'output'));
      candidates.push(base);
    }
    for (const cand of candidates) {
      const hit = caps.find((e) => e.name.toLowerCase().includes(cand.toLowerCase()));
      if (hit) return hit;
    }
    return caps.find((e) => /output/i.test(e.name) && VIRTUAL_RE.test(e.name))
      || caps.find((e) => /cable/i.test(e.name))
      || null; // contrat : null explicite (jamais undefined)
  }

  // Choisit les ids de restauration micro : priorite au peripherique par defaut
  // Windows non virtuel (role multi), puis aux ids d'origine par role, puis au
  // 1er peripherique non virtuel. Retourne '' pour un role sans candidat.
  function chooseRestoreIds(endpoints, prev, cur) {
    const nameOf = (id) => { const e = endpoints.find((x) => x.id === id && x.flow === 'capture'); return e ? e.name : ''; };
    const nonVirtual = (id) => !!id && !!nameOf(id) && !VIRTUAL_RE.test(nameOf(id));
    // Exiger un nom non vide : un endpoint dont DeviceName a echoue
    // (name='') passait VIRTUAL_RE.test('') et etait traite comme
    // « non virtuel » -> restauration possible sur un peripherique faux.
    const fb = endpoints.find((e) => e.flow === 'capture' && e.name && !VIRTUAL_RE.test(e.name));
    const fallbackId = fb ? fb.id : '';
    const defId = cur && nonVirtual(cur.multi) ? cur.multi : '';
    const consoleId = defId || (nonVirtual(prev && prev.console) ? prev.console : '') || fallbackId;
    const commId = defId || (nonVirtual(prev && prev.comm) ? prev.comm : '') || fallbackId;
    return { consoleId, commId, multiId: defId || (nonVirtual(prev && prev.multi) ? prev.multi : '') || consoleId || commId, fallbackId };
  }

  // Noms reserves Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9) : Windows refuse
  // de creer un fichier avec ces noms de base, extension ou non.
  const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  function safeName(s) {
    let n = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
    // Windows retire aussi les points finaux : « ... » -> « ...webm »
    // et « nom. » -> nom tronque de facon inattendue.
    n = n.replace(/[. ]+$/, '');
    if (!n) n = 'son';
    // Windows retire espaces/points finaux du nom de base AVANT de comparer
    // aux noms reserves : « con .take » devenait « con.take » -> refuse.
    if (RESERVED_RE.test(n.split('.')[0].replace(/[. ]+$/, ''))) n = '_' + n;
    return n;
  }

  function parseTs(v) {
    const t = String(v || '').trim();
    if (!t) return 0;
    const parts = t.split(':');
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    // Parties non leaders = minutes/secondes : « 1:99 » ou « 0:0:90 »
    // etaient acceptes et produisaient un timestamp silencieusement faux.
    if (parts.length > 1 && parts.slice(1).some((p) => parseFloat(p) >= 60)) return NaN;
    return parts.reduce((a, b) => a * 60 + parseFloat(b), 0);
  }

  function fmtTime(sec) {
    sec = Math.round(Math.max(0, sec || 0) * 10) / 10; // arrondi AVANT le split : « 1:60.0 » impossible
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + s.toFixed(1).padStart(4, '0');
  }

  // Remplace main.js expand() : parcourt fichiers+dossiers (profondeur 3 max),
  // garde-fou 5000 entrees, ne retourne que les extensions audio.
  function expandPaths(paths, depth = 0, seen = { n: 0, v: 0 }) {
    const out = [];
    // Une string est iterable (ses caracteres) : un appelant passant un
    // chemin seul verrait [] silencieux — on l'accepte comme [path].
    if (typeof paths === 'string') paths = [paths];
    if (!paths || typeof paths[Symbol.iterator] !== 'function') return out;
    for (const p of paths) {
      // n = sons retenus (plafond utile) ; v = entrees visitees (borne le
      // parcours pour qu'un dossier de 5000 non-audio n'affame pas les sons).
      if (seen.n >= 5000 || seen.v >= 50000) break;
      seen.v++;
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          if (depth < 3) out.push(...expandPaths(fs.readdirSync(p).map((n) => path.join(p, n)), depth + 1, seen));
        } else if (AUDIO_EXT.includes(path.extname(p).toLowerCase())) {
          out.push(p); seen.n++;
        }
      } catch {}
    }
    return out;
  }

  // Version async : les memes regles que expandPaths mais sans bloquer le
  // thread main — un chemin UNC/de reseau injoignable gele sinon l'UI,
  // les raccourcis globaux et le watchdog micro pendant le timeout SMB.
  async function expandPathsAsync(paths, depth = 0, seen = { n: 0, v: 0 }) {
    const out = [];
    if (typeof paths === 'string') paths = [paths];
    if (!paths || typeof paths[Symbol.iterator] !== 'function') return out;
    for (const p of paths) {
      if (seen.n >= 5000 || seen.v >= 50000) break;
      seen.v++;
      try {
        const st = await fs.promises.stat(p);
        if (st.isDirectory()) {
          if (depth < 3) {
            const names = await fs.promises.readdir(p);
            out.push(...await expandPathsAsync(names.map((n) => path.join(p, n)), depth + 1, seen));
          }
        } else if (AUDIO_EXT.includes(path.extname(p).toLowerCase())) {
          out.push(p); seen.n++;
        }
      } catch {}
    }
    return out;
  }

  // Ecriture atomique d'un enregistrement dans dir/ : 'wx' cree+ecrit en une
  // seule operation ; le premier nom libre gagne (base.ext, puis base-N.ext).
  // Extraite de main.js (SF-REL-0058 : ReferenceError 'p' dans la boucle
  // rendue invisible car les handlers ne sont pas couverts par node:test).
  // Compteur de .part : le nom doit etre unique par ECRITURE, pas par
  // process — deux writeRecording concurrents dans le meme process
  // partageaient le meme tmp (unlink de l'un -> link ENOENT de l'autre).
  let partSeq = 0;

  async function writeRecording(dir, name, ext, buf) {
    const base = safeName(name);
    const extOk = ['.webm', '.m4a', '.mp4', '.ogg', '.wav', '.opus'].includes(ext) ? ext : '.webm';
    for (let i = 0; ; i++) {
      const cand = path.join(dir, i === 0 ? `${base}${extOk}` : `${base}-${i}${extOk}`);
      // Ecriture dans un .part puis hardlink : link() est atomique et
      // echoue si cand existe -> claim du nom ET contenu complet en une
      // operation. Un crash laisse un .part orphelin (nettoyable), jamais
      // un .webm tronque au nom final (SF-REL-0089).
      const tmp = `${cand}.${process.pid}.${partSeq++}.part`;
      try {
        await fs.promises.writeFile(tmp, buf);
        await fs.promises.link(tmp, cand);
      } catch (e) {
        try { await fs.promises.unlink(tmp); } catch {}
        if (e && e.code === 'EEXIST') continue;
        // FS sans hardlinks (FAT32, certains partages reseau) : repli sur
        // l'ecriture wx directe — meme garantie de nom, contenu non atomique.
        if (e && ['EPERM', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(e.code)) {
          try { await fs.promises.writeFile(cand, buf, { flag: 'wx' }); return cand; }
          // Echec apres creation (disque plein, SMB coupe, AV) : sans unlink,
          // un .webm tronque restait sous le nom final et ressemblait valide.
          catch (e2) { if (e2 && e2.code === 'EEXIST') continue; try { await fs.promises.unlink(cand); } catch {} throw e2; }
        }
        throw e;
      }
      try { await fs.promises.unlink(tmp); } catch {}
      return cand;
    }
  }

  function cbOrNoop(cb) { return typeof cb === 'function' ? cb : () => {}; }

  // ---------- loudness BS.1770 (mesure en JS pur, sans outil externe) ----------
  // Coefficients EXACTS ITU-R BS.1770, identiques a libebur128 : etage 1
  // high-shelf +4 dB @ ~1682 Hz, etage 2 high-pass ~38 Hz, combines en un
  // IIR 4e ordre (forme transposee directe II, etat v[5] par canal).
  function kWeightingCoeffs(sr) {
    const K1 = Math.tan(Math.PI * 1681.974450955533 / sr);
    const Vh = Math.pow(10, 3.999843853973347 / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a01 = 1 + K1 / 0.7071752369554196 + K1 * K1;
    const pb = [(Vh + Vb * K1 / 0.7071752369554196 + K1 * K1) / a01,
      2 * (K1 * K1 - Vh) / a01,
      (Vh - Vb * K1 / 0.7071752369554196 + K1 * K1) / a01];
    const pa = [1, 2 * (K1 * K1 - 1) / a01, (1 - K1 / 0.7071752369554196 + K1 * K1) / a01];
    const rb = [1, -2, 1];
    const K2 = Math.tan(Math.PI * 38.13547087602444 / sr);
    const a02 = 1 + K2 / 0.5003270373238773 + K2 * K2;
    const ra = [1, 2 * (K2 * K2 - 1) / a02, (1 - K2 / 0.5003270373238773 + K2 * K2) / a02];
    const b = [0, 0, 0, 0, 0], a = [0, 0, 0, 0, 0];
    b[0] = pb[0] * rb[0];
    b[1] = pb[0] * rb[1] + pb[1] * rb[0];
    b[2] = pb[0] * rb[2] + pb[1] * rb[1] + pb[2] * rb[0];
    b[3] = pb[1] * rb[2] + pb[2] * rb[1];
    b[4] = pb[2] * rb[2];
    a[0] = pa[0] * ra[0];
    a[1] = pa[0] * ra[1] + pa[1] * ra[0];
    a[2] = pa[0] * ra[2] + pa[1] * ra[1] + pa[2] * ra[0];
    a[3] = pa[1] * ra[2] + pa[2] * ra[1];
    a[4] = pa[2] * ra[2];
    return { b, a };
  }

  // Poids par canal BS.1770 : stereo/mono = 1 ; centre = 1 ; surrounds
  // (positions 3-4 et au-dela) = 1.41 ; LFE (dernier canal si >= 6) = 0.
  // Approximation documentee pour les layouts exotiques — les fichiers
  // soundboard sont quasi toujours stereo/mono.
  function channelWeights(nch) {
    const w = new Array(nch).fill(1);
    if (nch >= 3) {
      w[2] = 1;
      for (let i = 3; i < nch; i++) w[i] = (nch >= 6 && i === nch - 1) ? 0 : 1.41;
    }
    return w;
  }

  // Loudness integree facon BS.1770 sur des Float32Array deja decodees.
  // Fenetres 400 ms / pas 100 ms, double porte (-70 LUFS absolue puis
  // -10 LUFS relative). Fichier < 400 ms : une seule zone = tout le
  // buffer (sinon il n'y aurait aucune zone complete a mesurer).
  // Retourne -Infinity pour un signal silencieux.
  function loudnessFromPcm(channels, sampleRate) {
    const list = (Array.isArray(channels) ? channels : [channels])
      .filter((d) => d && d.length)
      .map((d) => ({ d, n: d.length }));
    if (!list.length || !sampleRate) return -Infinity;
    const n = Math.min(...list.map((x) => x.n));
    if (!n) return -Infinity;
    const { b, a } = kWeightingCoeffs(sampleRate);
    const hop = Math.max(1, Math.floor((sampleRate + 5) / 10));
    const blockFrames = hop * 4;
    const w = channelWeights(list.length);
    const absGate = Math.pow(10, (-70 + 0.691) / 10);
    const states = list.map(() => ({ v: [0, 0, 0, 0, 0], ring: new Float64Array(blockFrames), ri: 0, win: 0 }));
    const zs = [];
    const shortFile = n < blockFrames;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < list.length; c++) {
        const st = states[c], x = list[c].d[i];
        const v0 = x - a[1] * st.v[1] - a[2] * st.v[2] - a[3] * st.v[3] - a[4] * st.v[4];
        const y = b[0] * v0 + b[1] * st.v[1] + b[2] * st.v[2] + b[3] * st.v[3] + b[4] * st.v[4];
        st.v[4] = st.v[3]; st.v[3] = st.v[2]; st.v[2] = st.v[1]; st.v[1] = v0;
        const y2 = y * y;
        st.win += y2 - st.ring[st.ri];
        st.ring[st.ri] = y2;
        st.ri = (st.ri + 1) % blockFrames;
      }
      // Bloc complet : fin de fenetre 400 ms multiple de 100 ms.
      if (!shortFile && (i + 1) % hop === 0 && i + 1 >= blockFrames) {
        let z = 0;
        for (let c = 0; c < list.length; c++) z += w[c] * states[c].win;
        zs.push(z / blockFrames);
      }
    }
    if (shortFile) {
      let z = 0;
      for (let c = 0; c < list.length; c++) z += w[c] * states[c].win;
      zs.push(z / n);
    }
    const gated = zs.filter((z) => z >= absGate);
    if (!gated.length) return -Infinity;
    const zAbs = gated.reduce((x, y) => x + y, 0) / gated.length;
    const rel = zAbs * 0.1; // -10 LUFS sous le niveau absolu
    const fin = gated.filter((z) => z >= rel);
    const zFin = fin.length ? fin.reduce((x, y) => x + y, 0) / fin.length : zAbs;
    return zFin > 0 ? 10 * Math.log10(zFin) - 0.691 : -Infinity;
  }

  // Gain de normalisation : ramene la loudness a targetLufs SANS
  // depasser tpCeilDb en pic. Sans mesure True Peak (interpolation
  // 4x), on utilise le pic echantillon comme approximation par le bas :
  // le vrai pic peut etre ~1 dB au-dessus, d'ou un plafond a -1 dBFS.
  // floor au centieme : un arrondi vers le haut pourrait pousser le pic
  // au-dessus du plafond. null si loudness inexploitable.
  function normGain(o) {
    o = o || {};
    // null/undefined -> NaN : +null vaudrait 0 (True Peak "0 dBFS" ou
    // loudness "0 LUFS" inventes -> gain aberrant silencieux).
    const num = (v) => (v == null ? NaN : +v);
    const lufs = num(o.lufs);
    const tp = num(o.truePeakDb);
    const target = Number.isFinite(num(o.targetLufs)) ? num(o.targetLufs) : -18;
    const ceil = Number.isFinite(num(o.tpCeilDb)) ? num(o.tpCeilDb) : -1;
    const maxGain = Number.isFinite(num(o.maxGain)) ? num(o.maxGain) : 4;
    if (!Number.isFinite(lufs)) return null;
    // Pic infini = signal deja au-dela de toute mesure : ne pas amplifier.
    if (tp === Infinity) return null;
    let g = Math.pow(10, (target - lufs) / 20);
    if (Number.isFinite(tp)) g = Math.min(g, Math.pow(10, (ceil - tp) / 20));
    g = Math.min(g, maxGain);
    if (!Number.isFinite(g) || g <= 0) return null;
    const r = Math.floor(g * 100) / 100;
    return r >= 0.01 ? r : g;
  }

  // Config d'avant la normalisation LUFS : les s.norm stockees etaient
  // des gains de PIC — pas interpretables comme gains loudness.
  function isPreLufsConfig(version) { return !(+version >= 2); }

  return { AUDIO_EXT, cbOrNoop, VIRTUAL_RE, parseEndpoints, parseGet, hasVirtualCable, findCableCapture, chooseRestoreIds, safeName, parseTs, fmtTime, expandPaths, expandPathsAsync, realDevices, writeRecording, kWeightingCoeffs, channelWeights, loudnessFromPcm, normGain, isPreLufsConfig };
});
