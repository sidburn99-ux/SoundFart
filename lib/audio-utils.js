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
    const nameOf = (id) => { const e = endpoints.find((x) => x.id === id); return e ? e.name : ''; };
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
    let n = String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!n) n = 'son';
    if (RESERVED_RE.test(n.split('.')[0])) n = '_' + n;
    return n;
  }

  function parseTs(v) {
    const t = String(v || '').trim();
    if (!t) return 0;
    const parts = t.split(':');
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((a, b) => a * 60 + parseFloat(b), 0);
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + s.toFixed(1).padStart(4, '0');
  }

  // Remplace main.js expand() : parcourt fichiers+dossiers (profondeur 3 max),
  // garde-fou 5000 entrees, ne retourne que les extensions audio.
  function expandPaths(paths, depth = 0, seen = { n: 0, v: 0 }) {
    const out = [];
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
          catch (e2) { if (e2 && e2.code === 'EEXIST') continue; throw e2; }
        }
        throw e;
      }
      try { await fs.promises.unlink(tmp); } catch {}
      return cand;
    }
  }

  function cbOrNoop(cb) { return typeof cb === 'function' ? cb : () => {}; }

  return { AUDIO_EXT, cbOrNoop, VIRTUAL_RE, parseEndpoints, parseGet, hasVirtualCable, findCableCapture, chooseRestoreIds, safeName, parseTs, fmtTime, expandPaths, expandPathsAsync, realDevices, writeRecording };
});
