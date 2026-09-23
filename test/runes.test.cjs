const test = require('node:test');
const assert = require('node:assert/strict');
const { describeStyles, validatePage, fromRecommendation, plain } = require('../electron/runes.cjs');

// Extrait réel de /lol-perks/v1/styles (Précision, Domination), septembre 2026.
const STAT = [{ perks: [5008, 5005, 5007], type: 'kStatMod' }, { perks: [5008, 5010, 5001], type: 'kStatMod' }, { perks: [5011, 5013, 5001], type: 'kStatMod' }];
const RAW = [
  { id: 8000, name: 'Precision', iconPath: '/p.png', allowedSubStyles: [8100, 8200], slots: [
    { perks: [8005, 8008, 8021, 8010], type: 'kKeyStone' }, { perks: [9101, 9111, 8009], type: 'kMixedRegularSplashable' },
    { perks: [9104, 9105, 9103], type: 'kMixedRegularSplashable' }, { perks: [8014, 8017, 8299], type: 'kMixedRegularSplashable' }, ...STAT] },
  { id: 8100, name: 'Domination', iconPath: '/d.png', allowedSubStyles: [8000, 8200], slots: [
    { perks: [8112, 8128, 9923], type: 'kKeyStone' }, { perks: [8126, 8139, 8143], type: 'kMixedRegularSplashable' },
    { perks: [8137, 8140, 8141], type: 'kMixedRegularSplashable' }, { perks: [8135, 8105, 8106], type: 'kMixedRegularSplashable' }, ...STAT] }
];
const { styles, perks } = describeStyles(RAW, [{ id: 8112, name: 'Electrocute', iconPath: '/e.png', shortDesc: 'Hitting a champion with <b>3</b> attacks<br>deals damage.' }]);

test('décrit les arbres : clés de voûte, lignes, fragments', () => {
  assert.deepEqual(styles[1].keystones, [8112, 8128, 9923]);
  assert.equal(styles[1].rows.length, 3);
  assert.equal(styles[1].shards.length, 3);
  assert.equal(perks[8112].description, 'Hitting a champion with 3 attacks deals damage.');
  assert.equal(plain('<font color="#fff">a</font>  b'), 'a b');
});

test('valide une page complète et nomme par défaut', () => {
  const page = { name: '  ', primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001] };
  assert.deepEqual(validatePage(page, styles), { name: 'Ward', primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: page.selectedPerkIds });
});

test('refuse les pages incohérentes', () => {
  const ok = [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001];
  const check = (changes, message) => assert.throws(() => validatePage({ primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: ok, ...changes }, styles), message);
  check({ subStyleId: 8100 }, /arbre secondaire/);
  check({ primaryStyleId: 1 }, /arbre principal/);
  check({ selectedPerkIds: ok.slice(0, 8) }, /incomplète/);
  check({ selectedPerkIds: [8005, ...ok.slice(1)] }, /clé de voûte/);
  check({ selectedPerkIds: [8112, 8137, ...ok.slice(2)] }, /ligne 2/);
  check({ selectedPerkIds: [...ok.slice(0, 4), 9111, 9101, ...ok.slice(6)] }, /lignes différentes/);
  check({ selectedPerkIds: [...ok.slice(0, 4), 8112, 8014, ...ok.slice(6)] }, /deux runes/);
  check({ selectedPerkIds: [...ok.slice(0, 6), 5001, 5008, 5001] }, /fragments/);
});

test('convertit une recommandation du client en page', () => {
  const rec = { primaryPerkStyleId: 8100, secondaryPerkStyleId: 8000, perks: [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001].map(id => ({ id })) };
  const page = fromRecommendation(rec, 'Ahri · Mid');
  assert.deepEqual(validatePage(page, styles).selectedPerkIds, [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001]);
  assert.equal(page.name, 'Ahri · Mid');
});
