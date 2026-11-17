'use strict';
// Tests unitaires du module i18n partage (lib/i18n.js) : fallback francais,
// interpolation {var}, setLang en memoire, liste des langues, pluriel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SFI18n = require('../lib/i18n.js');

test('langs() retourne les 4 langues supportees', () => {
  assert.deepEqual(SFI18n.langs(), ['fr', 'en', 'de', 'es']);
  // langs() doit renvoyer une copie (pas la constante interne)
  const l = SFI18n.langs();
  l.push('xx');
  assert.deepEqual(SFI18n.langs(), ['fr', 'en', 'de', 'es']);
});

test('langue par defaut = fr (identite)', () => {
  assert.equal(SFI18n.lang(), 'fr');
  assert.equal(SFI18n.t('Annuler'), 'Annuler');
});

test('setLang accepte une langue supportee et persiste en memoire', () => {
  SFI18n.setLang('en');
  assert.equal(SFI18n.lang(), 'en');
  assert.equal(SFI18n.t('Annuler'), 'Cancel');
  assert.equal(SFI18n.t('Fermer'), 'Close');
  SFI18n.setLang('fr');
});

test('setLang avec une langue inconnue retombe sur fr sans exception', () => {
  assert.equal(SFI18n.setLang('xx'), 'fr');
  assert.equal(SFI18n.lang(), 'fr');
  assert.equal(SFI18n.setLang(null), 'fr');
  assert.equal(SFI18n.setLang(undefined), 'fr');
  assert.equal(SFI18n.setLang(42), 'fr');
});

test('cle manquante -> retourne la cle FRANCAISE source', () => {
  SFI18n.setLang('en');
  assert.equal(SFI18n.t('Ceci n\'existe pas dans le dictionnaire'), 'Ceci n\'existe pas dans le dictionnaire');
  SFI18n.setLang('de');
  assert.equal(SFI18n.t('Ceci n\'existe pas dans le dictionnaire'), 'Ceci n\'existe pas dans le dictionnaire');
  SFI18n.setLang('fr');
});

test('interpolation {var} dans toutes les langues', () => {
  SFI18n.setLang('en');
  assert.equal(SFI18n.t('Version {v}', { v: '1.2.3' }), 'Version 1.2.3');
  SFI18n.setLang('de');
  assert.equal(SFI18n.t('Dossier de sons : {dir}', { dir: 'E:\\Sons' }), 'Sound-Ordner: E:\\Sons');
  SFI18n.setLang('es');
  assert.equal(SFI18n.t('Raccourci : {acc}', { acc: 'Ctrl+Alt+Q' }), 'Atajo: Ctrl+Alt+Q');
  SFI18n.setLang('fr');
  // vars manquants : le placeholder reste tel quel, pas de crash
  assert.equal(SFI18n.t('Version {v}'), 'Version {v}');
  assert.equal(SFI18n.t('Version {v}', null), 'Version {v}');
});

test('t() ne leve jamais d\'exception sur des entrees aberrantes', () => {
  SFI18n.setLang('en');
  assert.doesNotThrow(() => SFI18n.t(null));
  assert.doesNotThrow(() => SFI18n.t(undefined));
  assert.doesNotThrow(() => SFI18n.t(42));
  assert.doesNotThrow(() => SFI18n.t({}));
  assert.equal(SFI18n.t(null), 'null');
  SFI18n.setLang('fr');
});

test('les 3 dictionnaires couvrent les memes cles que en', () => {
  const en = Object.keys(SFI18n.DICT.en);
  for (const l of ['de', 'es']) {
    const missing = en.filter((k) => !(k in SFI18n.DICT[l]));
    assert.deepEqual(missing, [], `cles manquantes en ${l} : ${missing.join(', ')}`);
  }
});

test('aucune traduction ne contient de placeholder {x} non present dans la cle FR', () => {
  // Garde-fou : une traduction qui oublierait {n} casserait l'interpolation.
  for (const l of ['en', 'de', 'es']) {
    for (const [k, v] of Object.entries(SFI18n.DICT[l])) {
      const varsInKey = (k.match(/\{[a-zA-Z_]+\}/g) || []).sort();
      const varsInVal = (v.match(/\{[a-zA-Z_]+\}/g) || []).sort();
      assert.deepEqual(varsInVal, varsInKey, `${l} : placeholders differentes pour « ${k.slice(0, 60)} »`);
    }
  }
});

test('plural() choisit la forme FR puis t() la traduit', () => {
  SFI18n.setLang('fr');
  assert.equal(SFI18n.t(SFI18n.plural(1, '{n} son', '{n} sons'), { n: 1 }), '1 son');
  assert.equal(SFI18n.t(SFI18n.plural(3, '{n} son', '{n} sons'), { n: 3 }), '3 sons');
  SFI18n.setLang('en');
  assert.equal(SFI18n.t(SFI18n.plural(1, '{n} son', '{n} sons'), { n: 1 }), '1 sound');
  assert.equal(SFI18n.t(SFI18n.plural(5, '{n} son', '{n} sons'), { n: 5 }), '5 sounds');
  SFI18n.setLang('es');
  assert.equal(SFI18n.t(SFI18n.plural(1, '{n} son', '{n} sons'), { n: 1 }), '1 sonido');
  assert.equal(SFI18n.t(SFI18n.plural(2, '{n} son', '{n} sons'), { n: 2 }), '2 sonidos');
  SFI18n.setLang('fr');
});

test('t() est idempotent et multi-appels rapides', () => {
  SFI18n.setLang('en');
  assert.equal(SFI18n.t('Annuler'), 'Cancel');
  assert.equal(SFI18n.t('Annuler'), 'Cancel');
  SFI18n.setLang('de');
  assert.equal(SFI18n.t('Annuler'), 'Abbrechen');
  SFI18n.setLang('fr');
});
