// Runes pendant la sélection des champions (chargé après champselect.js : $, el, csImg, action, setPanel…).
const runeUi = { data: null, draft: null, target: null, older: 4, recoSpells: null, summaryKey: null, hoverId: 0 };
const RUNE_POSITIONS = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'ADC', utility: 'Support' };
// Couleur de chaque arbre, comme dans le client (Précision, Domination, Sorcellerie, Volonté, Inspiration).
const RUNE_COLORS = { 8000: '#c8aa6e', 8100: '#d44242', 8200: '#9faafc', 8400: '#a1d586', 8300: '#49aab9' };
const runeColor = id => RUNE_COLORS[id] || '#c8aa6e';

const runeStyle = id => runeUi.data?.styles.find(style => style.id === id);
const runePerk = id => runeUi.data?.perks[id];
const runeRowOf = (style, id) => (style?.rows || []).findIndex(row => row.includes(id));
const runeComplete = draft => Boolean(draft) && draft.selectedPerkIds.length === 9 && draft.selectedPerkIds.every(id => id > 0) && draft.subStyleId > 0;

function blankDraft() {
  const first = runeUi.data.styles[0];
  return { name: 'Ward', primaryStyleId: first.id, subStyleId: first.allowedSubStyles[0], selectedPerkIds: Array(9).fill(-1) };
}
function editPage(page) {
  runeUi.target = page?.editable ? page.id : null;
  runeUi.recoSpells = null;
  runeUi.draft = page && page.primaryStyleId > 0
    ? { name: page.name || '', primaryStyleId: page.primaryStyleId, subStyleId: page.subStyleId, selectedPerkIds: [...page.selectedPerkIds, ...Array(9).fill(-1)].slice(0, 9) }
    : blankDraft();
}
async function loadRunes() {
  runeUi.data = await window.league.getRunes();
  return runeUi.data;
}

function perkButton(id, pressed, onClick, className = 'rune-perk') {
  const perk = runePerk(id);
  const button = el('button', className);
  button.setAttribute('aria-pressed', String(pressed));
  button.setAttribute('aria-label', perk?.name || '');
  button.append(csImg(perk?.iconPath));
  button.addEventListener('mouseenter', () => { runeUi.hoverId = id; renderRuneInfo(); });
  button.addEventListener('mouseleave', () => { if (runeUi.hoverId === id) { runeUi.hoverId = 0; renderRuneInfo(); } });
  button.addEventListener('click', () => { onClick(); renderRunes(); });
  return button;
}
function styleButton(style, pressed, onClick) {
  const button = el('button', 'rune-style');
  button.setAttribute('aria-pressed', String(pressed));
  button.style.setProperty('--tree', runeColor(style.id));
  button.title = style.name;
  button.append(csImg(style.iconPath));
  button.addEventListener('click', () => { onClick(); renderRunes(); });
  return button;
}
// Une ligne de l'arbre : les runes, puis le nom de celle qui est choisie.
function runeRow(ids, isPressed, pick, className = 'rune-perk', extra = '') {
  const line = el('div', `rune-row${extra}`);
  const icons = el('div', 'rune-icons');
  icons.append(...ids.map(id => perkButton(id, isPressed(id), () => pick(id), className)));
  const chosen = ids.find(isPressed);
  line.append(icons, el('span', `rune-chosen${chosen ? '' : ' empty'}`, chosen ? runePerk(chosen)?.name || '' : '—'));
  return line;
}
// Zone de description : rune survolée, sinon la clé de voûte choisie.
function renderRuneInfo() {
  const box = $('rune-info');
  if (!box || !runeUi.draft) return;
  const id = runeUi.hoverId || runeUi.draft.selectedPerkIds[0];
  const perk = runePerk(id);
  if (!perk) { box.replaceChildren(el('span', 'rune-info-empty', 'Survole une rune pour lire sa description')); return; }
  const text = el('div', 'rune-info-text');
  text.append(el('b', '', perk.name), el('p', '', perk.description || ''));
  box.replaceChildren(csImg(perk.iconPath), text);
}

function setPrimary(id) {
  const draft = runeUi.draft;
  if (draft.primaryStyleId === id) return;
  draft.primaryStyleId = id;
  for (let i = 0; i < 4; i++) draft.selectedPerkIds[i] = -1;
  if (draft.subStyleId === id || !runeStyle(id).allowedSubStyles.includes(draft.subStyleId)) {
    draft.subStyleId = runeStyle(id).allowedSubStyles[0];
    draft.selectedPerkIds[4] = draft.selectedPerkIds[5] = -1;
  }
}
function pickSecondary(id) {
  const ids = runeUi.draft.selectedPerkIds, style = runeStyle(runeUi.draft.subStyleId);
  const row = runeRowOf(style, id);
  // Même ligne qu'une rune déjà choisie : on la remplace ; sinon on remplace la plus ancienne des deux.
  const slot = runeRowOf(style, ids[4]) === row ? 4 : runeRowOf(style, ids[5]) === row ? 5 : ids[4] < 0 ? 4 : ids[5] < 0 ? 5 : runeUi.older;
  ids[slot] = id;
  runeUi.older = slot === 4 ? 5 : 4;
}

function renderRuneEditor() {
  const draft = runeUi.draft, ids = draft.selectedPerkIds;
  const primary = runeStyle(draft.primaryStyleId), secondary = runeStyle(draft.subStyleId);
  $('rune-primary-col').style.setProperty('--tree', runeColor(primary.id));
  $('rune-secondary-col').style.setProperty('--tree', runeColor(secondary?.id));
  $('rune-primary-styles').replaceChildren(...runeUi.data.styles.map(style => styleButton(style, style.id === primary.id, () => setPrimary(style.id))));
  $('rune-primary').replaceChildren(
    el('span', 'rune-tree-name', primary.name),
    runeRow(primary.keystones, id => ids[0] === id, id => { ids[0] = id; }, 'rune-perk keystone', ' keystones'),
    ...primary.rows.map((row, index) => runeRow(row, id => ids[index + 1] === id, id => { ids[index + 1] = id; })));
  $('rune-secondary-styles').replaceChildren(...runeUi.data.styles.filter(style => primary.allowedSubStyles.includes(style.id))
    .map(style => styleButton(style, style.id === secondary?.id, () => {
      if (draft.subStyleId !== style.id) { draft.subStyleId = style.id; ids[4] = ids[5] = -1; }
    })));
  $('rune-secondary').replaceChildren(el('span', 'rune-tree-name', secondary?.name || 'Secondaire'),
    ...(secondary?.rows || []).map(row => runeRow(row, id => ids[4] === id || ids[5] === id, pickSecondary)));
  $('rune-shards').replaceChildren(el('span', 'rune-label', 'Fragments'),
    ...primary.shards.map((row, index) => runeRow(row, id => ids[6 + index] === id, id => { ids[6 + index] = id; }, 'rune-perk shard', ' shards')));
}

function renderRunes() {
  const data = runeUi.data;
  if (!data || !runeUi.draft) return;
  const current = data.pages.find(page => page.current);
  $('runes-sub').textContent = runeUi.target === 'new' ? 'Nouvelle page' : runeUi.target ? 'Page modifiable' : 'Page non modifiable';
  $('rune-page-label').textContent = runeUi.target === 'new' ? 'Nouvelle page' : current?.name || 'Pages';
  const pages = data.pages.map(page => {
    const option = el('button', 'rune-page', page.name || 'Sans nom');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-pressed', String(page.id === current?.id && runeUi.target !== 'new'));
    option.title = page.editable ? 'Choisir cette page' : 'Page non modifiable';
    option.classList.toggle('locked', !page.editable);
    option.addEventListener('click', () => action(async () => {
      togglePageMenu(false);
      await window.league.selectRunePage(page.id);
      await loadRunes();
      editPage(runeUi.data.pages.find(item => item.id === page.id));
      renderRunes(); refreshRuneSummary(true);
    }));
    return option;
  });
  if (data.canAdd) {
    const option = el('button', 'rune-page new', '+ Nouvelle');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-pressed', String(runeUi.target === 'new'));
    option.addEventListener('click', () => { togglePageMenu(false); runeUi.draft = blankDraft(); runeUi.target = 'new'; renderRunes(); });
    pages.push(option);
  }
  $('rune-pages').replaceChildren(...pages);

  const { championId, position } = data.context;
  const champion = csChampion(championId)?.name;
  const recos = data.recommendations.map((reco, index) => {
    const card = el('button', 'rune-reco');
    const keystone = runePerk(reco.keystoneId);
    card.style.setProperty('--tree', runeColor(reco.primaryStyleId));
    card.style.setProperty('--tree-2', runeColor(reco.subStyleId));
    card.title = `Appliquer : ${keystone?.name || ''}`;
    const text = el('span', 'rune-reco-text');
    text.append(el('b', '', keystone?.name || `Page ${index + 1}`), el('small', '', `${runeStyle(reco.primaryStyleId)?.name || ''} · ${runeStyle(reco.subStyleId)?.name || ''}`));
    card.append(csImg(keystone?.iconPath), text);
    card.addEventListener('click', () => {
      runeUi.draft = { name: [champion, RUNE_POSITIONS[position]].filter(Boolean).join(' · ') || 'Recommandée', primaryStyleId: reco.primaryStyleId, subStyleId: reco.subStyleId, selectedPerkIds: [...reco.perks] };
      if (!runeUi.target && current?.editable) runeUi.target = current.id;
      runeUi.recoSpells = reco.spells;
      renderRunes();
      feedback(`Recommandation ${index + 1} prête : enregistre pour l’appliquer`);
    });
    return card;
  });
  $('rune-recos').replaceChildren(el('span', 'rune-label', champion ? `Recommandées · ${champion}${RUNE_POSITIONS[position] ? ` ${RUNE_POSITIONS[position]}` : ''}` : 'Survole un champion pour voir les recommandations'), ...recos);
  $('rune-recos').classList.toggle('empty', !recos.length);

  renderRuneEditor();
  renderRuneInfo();
  if (document.activeElement !== $('rune-name')) $('rune-name').value = runeUi.draft.name;
  const canSave = runeComplete(runeUi.draft) && Boolean(runeUi.target) && !busy;
  $('rune-save').disabled = !canSave;
  $('rune-save').textContent = runeUi.target === 'new' ? 'Créer la page' : 'Enregistrer';
  $('rune-hint').textContent = !runeUi.target ? 'Choisis une de tes pages pour la modifier'
    : !runeComplete(runeUi.draft) ? 'Complète la page' : runeUi.recoSpells ? 'Runes et sorts recommandés' : '';
}

function togglePageMenu(open = $('rune-pages').hidden) {
  $('rune-pages').hidden = !open;
  $('rune-page-button').setAttribute('aria-expanded', String(open));
}

async function openRunes() {
  togglePageMenu(false);
  runeUi.hoverId = 0;
  await setPanel('runes');
  $('runes-sub').textContent = 'Chargement…';
  try {
    await loadRunes();
    editPage(runeUi.data.pages.find(page => page.current) || runeUi.data.pages[0]);
    renderRunes();
  } catch (error) {
    $('runes-sub').textContent = 'Runes indisponibles';
    feedback(cleanError(error), true);
  }
}

// Sorts recommandés, en gardant Flash sur la même touche qu'avant.
function recommendedSpells(spells, cs) {
  if (!Array.isArray(spells) || spells.length !== 2 || !cs) return null;
  let [one, two] = spells;
  if ((cs.spell2Id === 4 && one === 4) || (cs.spell1Id === 4 && two === 4)) [one, two] = [two, one];
  return [one, two];
}

// Bouton du bas : clé de voûte et nom de la page active.
function refreshRuneSummary(force = false) {
  const cs = state.champSelect;
  const key = cs ? `${cs.queueId}:${cs.localCellId}` : null;
  if (!key || (!force && runeUi.summaryKey === key)) return;
  runeUi.summaryKey = key;
  loadRunes().then(renderRuneButton).catch(() => {});
}
function renderRuneButton() {
  const page = runeUi.data?.pages.find(item => item.current);
  const button = $('cs-runes');
  const icon = runePerk(page?.selectedPerkIds?.[0])?.iconPath;
  button.replaceChildren(...(icon ? [csImg(icon)] : []), el('span', '', page?.name || 'Runes'));
  button.title = page ? `Runes : ${page.name || 'page sans nom'}` : 'Runes';
}

$('cs-runes').addEventListener('click', openRunes);
$('close-runes').addEventListener('click', () => setPanel(null));
$('rune-page-button').addEventListener('click', event => { event.stopPropagation(); togglePageMenu(); });
$('runes-panel').addEventListener('click', event => { if (!event.target.closest('.rune-page-picker')) togglePageMenu(false); });
$('rune-name').addEventListener('input', () => { if (runeUi.draft) runeUi.draft.name = $('rune-name').value; });
$('rune-save').addEventListener('click', () => action(async () => {
  const draft = { ...runeUi.draft, name: $('rune-name').value.trim() || runeUi.draft.name };
  await window.league.saveRunePage(draft, runeUi.target);
  const spells = recommendedSpells(runeUi.recoSpells, state.champSelect);
  if (spells) await window.league.setSpells(...spells).catch(() => {});
  await loadRunes();
  renderRuneButton();
  await setPanel(null);
  feedback(spells ? 'Runes et sorts appliqués' : 'Runes enregistrées');
}));
