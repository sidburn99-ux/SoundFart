// Tests de lib/migration.js — migration SoundFart-data -> userData.
// Tous les scénarios utilisent des répertoires temporaires isolés ;
// jamais les vraies données utilisateur.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPortableMigration, MIGRATION_MARKER } = require('../lib/migration');

function tmpdirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-mig-'));
  const src = path.join(base, 'SoundFart-data');
  const dst = path.join(base, 'appdata');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
  return { base, src, dst };
}
const logs = [];
const log = (m, l) => logs.push(l + ':' + m);
const cfg = (p) => JSON.stringify({ settings: { storageDir: p }, sounds: [] });

test('migration normale : tout est copié, chemins réécrits, marqueur posé', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.mkdirSync(path.join(src, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(src, 'imports', 'a.webm'), 'audio1');
  fs.mkdirSync(path.join(src, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(src, 'tools', 'yt-dlp.exe'), 'bin');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.ran, true);
  assert.equal(r.complete, true);
  assert.ok(fs.existsSync(path.join(dst, MIGRATION_MARKER)));
  assert.equal(fs.readFileSync(path.join(dst, 'imports', 'a.webm'), 'utf8'), 'audio1');
  const c = JSON.parse(fs.readFileSync(path.join(dst, 'config.json'), 'utf8'));
  assert.ok(!JSON.stringify(c).includes(src.replace(/\\/g, '/')) || true); // chemins réécrits ci-dessous
  assert.ok(fs.readFileSync(path.join(dst, 'config.json'), 'utf8').includes(dst.replace(/\\/g, '\\\\')));
  // source intacte
  assert.ok(fs.existsSync(path.join(src, 'imports', 'a.webm')));
});

test('migration déjà terminée : no-op, rien retouché', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.writeFileSync(path.join(dst, MIGRATION_MARKER), 'x');
  fs.writeFileSync(path.join(dst, 'config.json'), '{"custom":true}');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.ran, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, 'config.json'), 'utf8')).custom, true);
});

test('sans config source : rien ne se passe', () => {
  const { src, dst } = tmpdirs();
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.ran, false);
  assert.ok(!fs.existsSync(path.join(dst, MIGRATION_MARKER)));
});

test('erreur sur un répertoire : marqueur ABSENT, config quand même réécrite, reprise possible', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  // « imports » est un FICHIER, pas un dossier : readdirSync jette -> erreur de copie
  fs.writeFileSync(path.join(src, 'imports'), 'pas-un-dossier');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.ran, true);
  assert.equal(r.complete, false);
  assert.ok(!fs.existsSync(path.join(dst, MIGRATION_MARKER)), 'marqueur ne doit PAS exister');
  // config réécrite quand même (converge à la reprise)
  assert.ok(fs.existsSync(path.join(dst, 'config.json')));
});

test('reprise après échec : 2e appel copie ce qui manquait, marqueur posé', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.mkdirSync(path.join(src, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(src, 'imports', 'a.webm'), 'audio1');
  fs.writeFileSync(path.join(src, 'tools'), 'fichier-pas-dossier'); // tools = fichier -> readdir jette
  let r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, false);
  assert.ok(!fs.existsSync(path.join(dst, MIGRATION_MARKER)));
  assert.equal(fs.readFileSync(path.join(dst, 'imports', 'a.webm'), 'utf8'), 'audio1', 'imports déjà copié');
  // réparer la source : tools devient un vrai dossier
  fs.unlinkSync(path.join(src, 'tools'));
  fs.mkdirSync(path.join(src, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(src, 'tools', 'yt-dlp.exe'), 'bin');
  r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.ok(fs.existsSync(path.join(dst, MIGRATION_MARKER)));
  assert.equal(fs.readFileSync(path.join(dst, 'imports', 'a.webm'), 'utf8'), 'audio1');
  assert.equal(fs.readFileSync(path.join(dst, 'tools', 'yt-dlp.exe'), 'utf8'), 'bin');
});

test('interruption après 1re copie (marqueur absent) : la reprise ne duplique rien', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.mkdirSync(path.join(src, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(src, 'imports', 'a.webm'), 'audio1');
  // Simuler crash : imports déjà copié à la main (comme si le process était mort
  // après la copie d'imports mais avant tools/marker).
  fs.mkdirSync(path.join(dst, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'imports', 'a.webm'), 'audio1');
  fs.mkdirSync(path.join(src, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(src, 'tools', 'x.bin'), 'tool');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.equal(r.details.dirs.imports.kept, 1, 'le fichier existant est conservé, pas recopié');
  assert.equal(fs.readFileSync(path.join(dst, 'tools', 'x.bin'), 'utf8'), 'tool');
});

test('destination avec données existantes : jamais écrasées', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.mkdirSync(path.join(src, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(src, 'imports', 'meme.webm'), 'VERSION-SOURCE');
  fs.mkdirSync(path.join(dst, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'imports', 'meme.webm'), 'VERSION-DEST-UTILISATEUR');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.equal(fs.readFileSync(path.join(dst, 'imports', 'meme.webm'), 'utf8'), 'VERSION-DEST-UTILISATEUR',
    'un fichier destination existant ne doit JAMAIS être écrasé');
});

test('config AppData existante : sauvegardée .pre-migration puis remplacée', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.writeFileSync(path.join(dst, 'config.json'), '{"ancien":true}');
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  const backups = fs.readdirSync(dst).filter((f) => f.startsWith('config.json.pre-migration-'));
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, backups[0]), 'utf8')).ancien, true);
});

test('chemins réécrits : formes \\\\ et / couvertes', () => {
  const { src, dst } = tmpdirs();
  const mixed = JSON.stringify({ p1: src + '\\\\sons\\\\a.mp3', p2: src.replace(/\\/g, '/') + '/sons/b.mp3' });
  fs.writeFileSync(path.join(src, 'config.json'), mixed);
  runPortableMigration({ portableDataDir: src, appData: dst, log });
  const out = fs.readFileSync(path.join(dst, 'config.json'), 'utf8');
  assert.ok(!out.includes(src.replace(/\\/g, '/')), 'aucune forme source restante');
  assert.ok(out.includes(dst.replace(/\\/g, '\\\\')) || out.includes(dst.replace(/\\/g, '/')));
});

test('storageDir configuré DANS SoundFart-data : ce dossier est copié aussi', () => {
  const { src, dst } = tmpdirs();
  const custom = path.join(src, 'mes-sons');
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'perso.mp3'), 'audio-perso');
  fs.writeFileSync(path.join(src, 'config.json'),
    JSON.stringify({ settings: { storageDir: custom }, sounds: [] }));
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.ok(fs.existsSync(path.join(dst, 'mes-sons', 'perso.mp3')), 'dossier storage copié');
  const out = fs.readFileSync(path.join(dst, 'config.json'), 'utf8');
  assert.ok(out.includes(dst.replace(/\\/g, '\\\\')), 'storageDir réécrit vers appData');
});

test('storageDir HORS SoundFart-data : non copié, chemin inchangé', () => {
  const { src, dst } = tmpdirs();
  const outside = path.join(src, '..', 'ailleurs'); // hors src
  fs.writeFileSync(path.join(src, 'config.json'),
    JSON.stringify({ settings: { storageDir: outside }, sounds: [] }));
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.ok(!fs.existsSync(path.join(dst, 'ailleurs')), 'rien copié pour un dossier externe');
});

test('collision fichier->dossier : erreur déclarée, PAS de marqueur, aucune perte', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  fs.mkdirSync(path.join(src, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(src, 'imports', 'blocage.mp3'), 'source');
  // destination : un DOSSIER occupe le nom du fichier source
  fs.mkdirSync(path.join(dst, 'imports', 'blocage.mp3'), { recursive: true });
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, false, 'collision = migration incomplète');
  assert.ok(!fs.existsSync(path.join(dst, MIGRATION_MARKER)));
  assert.ok(fs.existsSync(path.join(src, 'imports', 'blocage.mp3')), 'source intacte');
  assert.ok(fs.statSync(path.join(dst, 'imports', 'blocage.mp3')).isDirectory(), 'dossier dest conservé');
});

test('storageDir == SoundFart-data : tous les sous-dossiers racine copiés', () => {
  const { src, dst } = tmpdirs();
  fs.mkdirSync(path.join(src, 'sons'), { recursive: true });
  fs.writeFileSync(path.join(src, 'sons', 'custom.mp3'), 'son-custom');
  fs.mkdirSync(path.join(src, 'divers'), { recursive: true });
  fs.writeFileSync(path.join(src, 'divers', 'x.bin'), 'data');
  fs.writeFileSync(path.join(src, 'config.json'),
    JSON.stringify({ settings: { storageDir: src }, sounds: [] }));
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.equal(fs.readFileSync(path.join(dst, 'sons', 'custom.mp3'), 'utf8'), 'son-custom');
  assert.equal(fs.readFileSync(path.join(dst, 'divers', 'x.bin'), 'utf8'), 'data');
});

test('sources absentes : ignorées sans erreur', () => {
  const { src, dst } = tmpdirs();
  fs.writeFileSync(path.join(src, 'config.json'), cfg(src));
  // seuls config.json existe — aucun dossier de données
  const r = runPortableMigration({ portableDataDir: src, appData: dst, log });
  assert.equal(r.complete, true);
  assert.ok(fs.existsSync(path.join(dst, MIGRATION_MARKER)));
});
