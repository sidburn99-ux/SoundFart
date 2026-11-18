'use strict';
// Tests unitaires main/media-tools.js — deps injectees, aucun reseau.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMediaTools } = require('../main/media-tools');

function makeDeps(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mt-'));
  const logs = [];
  const handlers = {};
  const deps = {
    log: (m) => logs.push(m),
    execFileTracked: over.execFileTracked || (() => Promise.reject(new Error('execFileTracked non mocke'))),
    trackChild: (p) => p,
    killTree: () => {},
    H: (ch, fn) => { handlers[ch] = fn; },
    toolSane: over.toolSane || (() => true),
    discardCorruptTool: over.discardCorruptTool || (() => {}),
    toolsDir: () => path.join(dir, 'tools'),
    storageRoot: (d) => d || dir,
    getWin: () => null,
    ...over.deps,
  };
  return { deps, dir, logs, handlers };
}

test('H enregistre les canaux media', () => {
  const { deps, handlers } = makeDeps();
  createMediaTools(deps);
  for (const ch of ['media:cut', 'yt:info', 'yt:download', 'yt:cancel']) {
    assert.equal(typeof handlers[ch], 'function', ch);
  }
});

test('chemins outils : suffixe .exe sous Windows, nu sous Linux', () => {
  const w = makeDeps();
  const mtWin = createMediaTools({ ...w.deps, IS_WIN: true });
  assert.ok(mtWin.ffmpegPath().endsWith(path.join('ffmpeg', 'ffmpeg.exe')));
  assert.ok(mtWin.ytdlpPath().endsWith('yt-dlp.exe'));

  const l = makeDeps();
  const mtLin = createMediaTools({ ...l.deps, IS_WIN: false });
  assert.ok(mtLin.ffmpegPath().endsWith(path.join('ffmpeg', 'ffmpeg')));
  assert.ok(!mtLin.ffmpegPath().endsWith('.exe'));
  assert.ok(mtLin.ytdlpPath().endsWith('yt-dlp'));
  assert.ok(!mtLin.ytdlpPath().endsWith('.exe'));
});

test('findFile : trouve un fichier niche, null si absent', () => {
  const { deps, dir } = makeDeps();
  const deep = path.join(dir, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  const target = path.join(deep, 'ffmpeg');
  fs.writeFileSync(target, 'x');
  const mt = createMediaTools(deps);
  assert.equal(mt.findFile(dir, 'ffmpeg'), target);
  assert.equal(mt.findFile(dir, 'introuvable'), null);
  assert.equal(mt.findFile(path.join(dir, 'nexiste-pas'), 'ffmpeg'), null);
});

test('ensureYtDlp : outil sain + version OK + meta fraiche -> pas de reseau', async () => {
  const execCalls = [];
  const { deps, dir } = makeDeps({
    toolSane: (p, min) => {
      // Le binaire doit exister et depasser min : on cree un faux yt-dlp.
      const f = deps2toolsYtdlp(dir);
      return fs.existsSync(f) && fs.statSync(f).size >= min;
    },
    execFileTracked: (bin, args) => {
      execCalls.push(args.join(' '));
      if (args[0] === '--version') return Promise.resolve({ stdout: '2026.10.26\n', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    },
  });
  function deps2toolsYtdlp(d) { return path.join(d, 'tools', 'yt-dlp'); }
  // meta fraiche -> maybeUpdateYtDlp sort sans appel reseau
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(deps2toolsYtdlp(dir), 'x'.repeat(2 * 1024 * 1024));
  fs.writeFileSync(path.join(dir, 'tools', 'yt-dlp.json'), JSON.stringify({ version: '2026.10.26', at: Date.now() }));
  const mt = createMediaTools(deps);
  await mt.ensureYtDlp();
  assert.ok(execCalls.some((c) => c.startsWith('--version')));
});
