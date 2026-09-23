// Sélection des champions dans le widget (chargé après app.js, partage ses fonctions : $, el, state, action…).
const CS_ROLES = [['ALL', 'Tous les rôles'], ['TOP', 'Top'], ['JUNGLE', 'Jungle'], ['MIDDLE', 'Mid'], ['BOTTOM', 'ADC'], ['UTILITY', 'Support']];
const CS_POSITION_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const CS_PHASES = { PLANNING: 'Déclaration', BAN_PICK: 'Sélection', FINALIZATION: 'Finalisation', GAME_STARTING: 'Lancement' };
const csImages = new Map();
const csState = { sessionKey: null, data: null, loading: null, role: 'ALL', text: '', gridKey: '', spellSlot: 0, timer: { key: '', total: 0 } };

// Images du jeu : file d'attente (6 à la fois) pour ne pas envoyer 170 requêtes d'un coup au client.
// Les éléments demandés en premier (sorts, alliés) passent avant la grille.
const csQueue = [];
let csLoading = 0;
function csPump() {
  while (csLoading < 6 && csQueue.length) {
    const { assetPath, resolve } = csQueue.shift();
    csLoading++;
    window.league.getAsset(assetPath).catch(() => null).then(resolve).finally(() => { csLoading--; csPump(); });
  }
}
function csImage(assetPath) {
  if (!assetPath) return Promise.resolve(null);
  if (!csImages.has(assetPath)) {
    csImages.set(assetPath, new Promise(resolve => { csQueue.push({ assetPath, resolve }); csPump(); })
      .then(src => { if (!src) csImages.delete(assetPath); return src; }));
  }
  return csImages.get(assetPath);
}
const championIcon = id => `/lol-game-data/assets/v1/champion-icons/${id}.png`;
function csImg(assetPath) {
  const img = el('img');
  img.alt = ''; img.hidden = true;
  csImage(assetPath).then(src => { if (src) { img.src = src; img.hidden = false; } });
  return img;
}
function csChampion(id) {
  return csState.data?.champions.find(champion => champion.id === id);
}
const normalize = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Libellé d'en-tête pendant la sélection.
function champSelectNote(cs) {
  if (cs.locked && cs.phase === 'BAN_PICK') return 'Verrouillé · en attente des autres joueurs';
  if (cs.action?.inProgress) return cs.action.type === 'ban' ? 'À toi de bannir' : 'À toi de choisir';
  return CS_PHASES[cs.phase] || 'Sélection des champions';
}
function champSelectSecondsLeft(cs) {
  if (!cs || cs.infinite) return null;
  return Math.max(0, Math.ceil((cs.timeLeftMs - (Date.now() - cs.sampledAt)) / 1000));
}

function loadChampSelectData(cs) {
  const key = `${cs.queueId}:${cs.localCellId}`;
  if (csState.sessionKey === key && (csState.data || csState.loading)) return;
  csState.sessionKey = key; csState.data = null; csState.gridKey = ''; csState.role = 'ALL'; csState.text = '';
  $('cs-search').value = '';
  csState.loading = window.league.getChampSelectData()
    .then(data => { if (csState.sessionKey === key) { csState.data = data; render(); } })
    .catch(error => feedback(`Sélection indisponible : ${error.message}`, true))
    .finally(() => { csState.loading = null; });
}

const roleIcon = position => `assets/roles/${CS_POSITION_LABELS[position] ? position.toLowerCase() : 'unselected'}.png`;

// Une ligne de joueur, façon client : portrait rond + icône de poste, nom, champion, sorts.
function playerRow(player, ally) {
  const shown = player.championId || player.hoverId;
  const champion = shown ? csChampion(shown)?.name : '';
  const row = el('div', `cs-player${player.isLocal ? ' local' : ''}${player.acting ? ' acting' : ''}${player.locked ? ' locked' : ''}`);
  const portrait = el('span', `cs-portrait${!player.locked && shown ? ' hover' : ''}`);
  if (shown) portrait.append(csImg(championIcon(shown)));
  if (CS_POSITION_LABELS[player.position]) {
    const badge = el('img', 'cs-role-badge');
    badge.src = roleIcon(player.position); badge.alt = ''; badge.title = CS_POSITION_LABELS[player.position];
    portrait.append(badge);
  }
  const text = el('span', 'cs-player-text');
  const title = ally ? (player.isLocal ? 'Toi' : player.name) : (champion || 'Ennemi');
  const sub = player.acting ? 'choisit…'
    : ally ? (champion || CS_POSITION_LABELS[player.position] || '—') : (CS_POSITION_LABELS[player.position] || '');
  text.append(el('b', '', title), el('small', '', sub));
  row.append(portrait, text);
  if (ally) {
    const spells = el('span', 'cs-player-spells');
    for (const id of [player.spell1Id, player.spell2Id]) {
      const slot = el('span', 'cs-mini-spell');
      const spell = spellIcon(id);
      if (spell) { slot.append(csImg(spell.iconPath)); slot.title = spell.name; }
      spells.append(slot);
    }
    row.append(spells);
  }
  return row;
}
function renderBans(list, ids, count) {
  const key = JSON.stringify([ids, count, Boolean(csState.data)]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  const slots = Math.max(ids.length, Math.ceil((count || 0) / 2));
  list.hidden = !slots;
  list.replaceChildren(...Array.from({ length: slots }, (_, i) => {
    const ban = el('span', `cs-ban${ids[i] ? '' : ' empty'}`);
    if (ids[i]) { ban.title = `${csChampion(ids[i])?.name || 'Champion'} banni`; ban.append(csImg(championIcon(ids[i]))); }
    return ban;
  }));
}
function renderAllies(cs) {
  const list = $('cs-allies');
  const key = JSON.stringify([cs.myTeam, Boolean(csState.data)]); // Redessine quand les noms des champions arrivent.
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(...cs.myTeam.map(player => playerRow(player, true)));
  }
  renderBans($('cs-bans-mine'), cs.bans.mine, cs.bans.count);
}
function renderEnemies(cs) {
  const list = $('cs-enemies');
  const key = JSON.stringify([cs.theirTeam, Boolean(csState.data)]);
  // ARAM ou partie perso : équipe adverse cachée → colonne masquée, la grille prend la place.
  const hidden = !cs.theirTeam.length;
  $('cs-enemy-side').hidden = hidden;
  $('cs-body').classList.toggle('solo', hidden);
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren(...cs.theirTeam.map(player => playerRow(player, false)));
  }
  renderBans($('cs-bans-theirs'), cs.bans.theirs, cs.bans.count);
}

// Barre de temps sur toute la largeur (durée de la phase, ou premier temps restant vu).
function renderCsTimer(cs) {
  const fill = $('cs-timer-fill');
  const left = champSelectSecondsLeft(cs);
  const key = `${cs.phase}:${cs.action?.id || ''}:${cs.action?.inProgress || false}`;
  if (csState.timer.key !== key) csState.timer = { key, total: cs.totalMs || cs.timeLeftMs };
  const total = Math.max(csState.timer.total, cs.timeLeftMs, 1);
  fill.style.width = left === null ? '100%' : `${Math.min(100, (left * 1000 / total) * 100)}%`;
  const bar = fill.parentElement;
  bar.dataset.state = cs.action?.inProgress && !cs.locked ? (cs.action.type === 'ban' ? 'ban' : 'mine') : 'idle';
  bar.classList.toggle('urgent', left !== null && left <= 5);
}

// Carte du champion choisi, à côté du bouton.
function renderPick(cs) {
  const me = cs.myTeam.find(player => player.isLocal) || {};
  const banning = cs.action?.type === 'ban' && cs.action.inProgress && !cs.locked;
  const id = banning ? cs.action.championId
    : cs.locked ? me.championId : (cs.action?.type === 'pick' && cs.action.championId) || me.championId || me.hoverId || 0;
  const portrait = $('cs-pick-portrait');
  if (portrait.dataset.id !== String(id) || (id && !portrait.querySelector('img'))) {
    portrait.dataset.id = String(id);
    portrait.replaceChildren(...(id ? [csImg(championIcon(id))] : []));
  }
  const name = csChampion(id)?.name;
  $('cs-pick').classList.toggle('ban', banning);
  $('cs-pick').classList.toggle('locked', cs.locked);
  $('cs-pick-name').textContent = name || (banning ? 'Aucun ban' : 'Aucun champion');
  $('cs-pick-sub').textContent = banning ? 'À bannir'
    : [CS_POSITION_LABELS[cs.position], cs.locked ? 'Verrouillé' : name ? 'Survolé' : ''].filter(Boolean).join(' · ') || 'Sélection';
}

function unavailableChampions(cs) {
  const taken = new Set([...cs.bans.mine, ...cs.bans.theirs]);
  for (const player of [...cs.myTeam, ...cs.theirTeam]) if (player.locked && !player.isLocal) taken.add(player.championId);
  return taken;
}
function renderGrid(cs) {
  const data = csState.data, grid = $('cs-grid');
  if (!data) { if (!grid.querySelector('.empty-list')) grid.replaceChildren(el('p', 'empty-list', 'Chargement des champions…')); return; }
  const banning = cs.action?.type === 'ban';
  const allowed = new Set(banning ? data.bannable : data.pickable);
  const taken = unavailableChampions(cs);
  const selected = cs.action?.championId || 0;
  const position = cs.position;
  const text = normalize(csState.text);
  // Champions jouables (ou bannissables) dans cette sélection : écarte les variantes d'autres modes (« Jade_… »).
  const pool = new Set(banning ? data.bannable : data.pickable);
  const visible = data.champions
    .filter(champion => !pool.size || pool.has(champion.id))
    .filter(champion => csState.role === 'ALL' || champion.positions.includes(csState.role))
    .filter(champion => !text || normalize(champion.name).includes(text) || normalize(champion.alias).includes(text))
    .sort((a, b) => Number(b.favorites.includes(position)) - Number(a.favorites.includes(position)));
  const canAct = Boolean(cs.action) && !cs.locked && !busy;
  const key = JSON.stringify([visible.map(c => c.id), [...taken], selected, banning, canAct, position]);
  if (csState.gridKey === key) return;
  csState.gridKey = key;
  if (!visible.length) { grid.replaceChildren(el('p', 'empty-list', 'Aucun champion')); return; }
  grid.replaceChildren(...visible.map(champion => {
    const button = el('button', 'cs-champ');
    const blocked = taken.has(champion.id) || (allowed.size > 0 && !allowed.has(champion.id));
    button.dataset.id = champion.id;
    button.title = champion.name + (champion.favorites.includes(position) ? ' · favori' : '');
    button.disabled = !canAct || blocked;
    button.classList.toggle('taken', blocked);
    button.classList.toggle('selected', champion.id === selected);
    button.classList.toggle('favorite', champion.favorites.includes(position));
    button.setAttribute('aria-pressed', String(champion.id === selected));
    button.setAttribute('aria-label', champion.name);
    button.append(csImg(championIcon(champion.id)));
    button.addEventListener('click', () => {
      window.league.champHover(champion.id).then(refresh, error => feedback(cleanError(error), true));
    });
    return button;
  }));
}
function cleanError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function spellIcon(id) {
  return csState.data?.spells.find(spell => spell.id === id);
}
function renderSpells(cs) {
  for (const [slot, id] of [[1, cs.spell1Id], [2, cs.spell2Id]]) {
    const button = $(`cs-spell${slot}`);
    const spell = spellIcon(id);
    if (button.dataset.spell !== String(id) || (spell && !button.querySelector('img'))) {
      button.dataset.spell = String(id);
      button.replaceChildren(...(spell ? [csImg(spell.iconPath)] : []));
      button.title = spell ? `Sort ${slot} : ${spell.name}` : `Sort ${slot}`;
    }
    button.disabled = busy || !csState.data || cs.phase === 'GAME_STARTING';
  }
}
function openSpells(slot) {
  const cs = state.champSelect;
  if (!cs || !csState.data) return;
  csState.spellSlot = slot;
  const current = slot === 1 ? cs.spell1Id : cs.spell2Id;
  $('spells-title').textContent = slot === 1 ? 'Sort 1' : 'Sort 2';
  $('spell-options').replaceChildren(...csState.data.spells.map(spell => {
    const option = el('button', 'spell-option');
    option.setAttribute('aria-pressed', String(spell.id === current));
    option.title = spell.name;
    option.append(csImg(spell.iconPath), el('span', '', spell.name));
    option.addEventListener('click', () => action(async () => {
      let [one, two] = [cs.spell1Id, cs.spell2Id];
      if (slot === 1) { if (spell.id === two) two = one; one = spell.id; } else { if (spell.id === one) one = two; two = spell.id; }
      await window.league.setSpells(one, two);
      await setPanel(null);
    }));
    return option;
  }));
  setPanel('spells');
}

function renderAction(cs) {
  const button = $('cs-action');
  const chosen = csChampion(cs.action?.championId)?.name;
  let label, enabled = false;
  if (cs.locked) label = `${csChampion(cs.myTeam.find(p => p.isLocal)?.championId)?.name || 'Champion'} verrouillé`;
  else if (cs.action?.inProgress) {
    enabled = Boolean(chosen);
    label = cs.action.type === 'ban' ? (chosen ? `Bannir ${chosen}` : 'Choisis un champion à bannir') : (chosen ? `Verrouiller ${chosen}` : 'Choisis ton champion');
  } else if (cs.action) label = chosen ? `${chosen} · pas encore ton tour` : 'Pas encore ton tour';
  else label = cs.phase === 'FINALIZATION' ? 'Finalisation' : 'En attente des autres joueurs';
  button.textContent = busy ? 'Un instant…' : label;
  button.disabled = busy || !enabled;
  button.classList.toggle('ban', cs.action?.type === 'ban' && !cs.locked);
  button.classList.toggle('ready', enabled);
}

// ARAM : champion attribué, relance et banc à la place de la grille.
function renderAram(cs) {
  const aram = cs.benchEnabled || cs.allowReroll;
  $('cs-aram').hidden = !aram;
  $('cs-filters').hidden = aram;
  $('cs-grid').hidden = aram;
  if (!aram) return;
  const me = cs.myTeam.find(player => player.isLocal) || {};
  const portrait = $('cs-aram-portrait');
  if (portrait.dataset.id !== String(me.championId)) {
    portrait.dataset.id = String(me.championId);
    portrait.replaceChildren(...(me.championId ? [csImg(championIcon(me.championId))] : []));
  }
  $('cs-aram-name').textContent = csChampion(me.championId)?.name || '—';
  $('cs-reroll').textContent = `Relancer (${cs.rerollsRemaining})`;
  $('cs-reroll').disabled = busy || !cs.allowReroll || cs.rerollsRemaining < 1;
  const bench = $('cs-bench');
  const key = JSON.stringify([cs.bench, busy]);
  if (bench.dataset.key === key) return;
  bench.dataset.key = key;
  bench.replaceChildren(...(cs.bench.length ? cs.bench.map(id => {
    const button = el('button', 'cs-champ');
    button.dataset.id = id;
    button.title = `Prendre ${csChampion(id)?.name || 'ce champion'}`;
    button.disabled = busy;
    button.append(csImg(championIcon(id)), el('span', '', csChampion(id)?.name || ''));
    button.addEventListener('click', () => action(async () => { await window.league.benchSwap(id); feedback(`Tu prends ${csChampion(id)?.name || 'ce champion'}`); }));
    return button;
  }) : [el('p', 'empty-list', 'Banc vide')]));
}
// Demandes d'échange reçues (champion, ordre de choix, poste).
function renderSwap(cs) {
  const swap = cs.swaps[0];
  $('cs-swap').hidden = !swap;
  if (!swap) return;
  const player = cs.myTeam.find(item => item.cellId === swap.cellId) || {};
  const name = player.name || 'Un allié';
  $('cs-swap-text').textContent = swap.kind === 'champion' ? `${name} te propose son champion ${csChampion(player.championId)?.name || ''}`.trim()
    : swap.kind === 'pickOrder' ? `${name} propose d’échanger votre ordre de choix`
    : `${name} propose d’échanger vos postes${CS_POSITION_LABELS[player.position] ? ` (${CS_POSITION_LABELS[player.position]})` : ''}`;
  $('cs-swap').dataset.kind = swap.kind;
  $('cs-swap').dataset.id = swap.id;
  $('cs-swap-accept').disabled = $('cs-swap-decline').disabled = busy;
}
function answerCurrentSwap(accept) {
  const { kind, id } = $('cs-swap').dataset;
  action(async () => {
    await window.league.answerSwap(kind, Number(id), accept);
    feedback(accept ? 'Échange accepté' : 'Échange refusé');
  });
}

function renderChampSelect(cs) {
  renderAram(cs);
  renderSwap(cs);
  loadChampSelectData(cs);
  refreshRuneSummary();
  renderAllies(cs);
  renderEnemies(cs);
  renderSpells(cs);
  renderGrid(cs);
  renderCsTimer(cs);
  renderPick(cs);
  renderAction(cs);
  $('cs-roles').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.csRole === csState.role)));
}

// Contrôles construits une fois.
$('cs-roles').replaceChildren(...CS_ROLES.map(([role, label]) => {
  const button = el('button', 'cs-role');
  const icon = el('img');
  icon.src = `assets/roles/${role === 'ALL' ? 'fill' : role.toLowerCase()}.png`; icon.alt = '';
  button.append(icon);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.csRole = role;
  button.addEventListener('click', () => { csState.role = role; csState.gridKey = ''; render(); });
  return button;
}));
$('cs-search').addEventListener('input', () => { csState.text = $('cs-search').value; csState.gridKey = ''; render(); });
$('cs-spell1').addEventListener('click', () => openSpells(1));
$('cs-reroll').addEventListener('click', () => action(async () => { await window.league.reroll(); feedback('Champion relancé'); }));
$('cs-swap-accept').addEventListener('click', () => answerCurrentSwap(true));
$('cs-swap-decline').addEventListener('click', () => answerCurrentSwap(false));
$('cs-spell2').addEventListener('click', () => openSpells(2));
$('close-spells').addEventListener('click', () => setPanel(null));
$('cs-action').addEventListener('click', () => action(async () => {
  const result = await window.league.champLock();
  feedback(result.type === 'ban' ? `${csChampion(result.championId)?.name || 'Champion'} banni` : `${csChampion(result.championId)?.name || 'Champion'} verrouillé`);
}));
