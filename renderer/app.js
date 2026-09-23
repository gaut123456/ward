const $ = id => document.getElementById(id);
let state = { connected: false, starting: true, phase: 'None' };
let busy = false, expanded = false, rolesExpanded = false, lastIcon, lastDuoIcon, noticeUntil = 0;
let rolePreferences, queueTransition = null, actionVersion = 0, refreshVersion = 0;
let roleDraft = null, selectedRoleSlot = 'firstPreference';
let queueStartedAt = null, duoKey = null, duoIconRequest = null;
const roleLabels = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support', FILL: 'Fill' };
const queueLabels = { 420: 'Solo / Duo', 440: 'Flex', 400: 'Normale', 430: 'Normale', 480: 'Swiftplay', 490: 'Partie rapide', 450: 'ARAM', 2400: 'ARAM Mayhem', 1700: 'Arena', 1710: 'Arena', 1740: 'Arena Bravoure', 1900: 'URF', 0: 'Personnalisée' };
const DEFAULT_QUEUE = { id: 420, label: 'Solo / Duo', positions: true, arena: false, maxParty: 2, layout: 'duo' };
const iconRequests = new Map();
let queuesExpanded = false, lastSize = '', blockedShown = false;
const handledInvites = new Set();
let inviteIconKey = null;
const gamePhases = ['ReadyCheck', 'ChampSelect', 'InProgress', 'Reconnect', 'GameStart', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'];

function isSearching() {
  if (!state.connected || gamePhases.includes(state.phase)) return false;
  return queueTransition ? queueTransition.searching : state.searching || state.phase === 'Matchmaking';
}

function feedback(text, error = false, temporary = true) {
  $('feedback').textContent = text;
  $('feedback').title = text;
  $('feedback').classList.toggle('error', error);
  if (temporary) noticeUntil = Date.now() + 8000;
}
function render() {
  const searching = isSearching();
  const inGame = gamePhases.includes(state.phase);
  $('open-client').disabled = busy || !state.connected || Boolean(state.clientUi?.opening);
  const accepted = state.ready?.response === 'Accepted';
  const canAccept = state.phase === 'ReadyCheck' && state.ready?.active && !['Accepted', 'Declined'].includes(state.ready.response);
  const canOpen = ['ChampSelect', 'Reconnect'].includes(state.phase);
  const labels = { ReadyCheck: accepted ? 'En attente des joueurs' : 'Accepter la partie', ChampSelect: 'Choisir mon champion',
    Reconnect: 'Ouvrir League', GameStart: 'Chargement de la partie', InProgress: 'Partie en cours',
    WaitingForStats: 'Fin de partie', PreEndOfGame: 'Fin de partie', EndOfGame: 'Partie terminée' };
  const waitingLeader = state.connected && !searching && state.phase === 'Lobby' && state.isLeader === false;
  const blocked = state.connected && !searching && !inGame && !waitingLeader && state.blocked ? state.blocked : null;
  $('play').disabled = busy || waitingLeader || Boolean(blocked) || (!state.connected && state.starting) || (state.connected && inGame && !canAccept && !canOpen);
  $('play').textContent = busy ? 'Un instant…' : !state.connected ? state.starting ? 'Lancement de League…' : 'Réessayer' : searching ? 'Annuler' : waitingLeader ? 'En attente du chef' : labels[state.phase] || 'Lancer';
  $('queue-button').disabled = busy || !state.connected || searching || inGame || state.isLeader === false;
  $('queue-button').setAttribute('aria-expanded', String(queuesExpanded));
  $('play').classList.toggle('searching', searching);
  $('play').classList.toggle('ready-action', canAccept);
  document.querySelector('.widget').dataset.phase = state.connected ? searching ? 'Matchmaking' : state.phase : 'Disconnected';
  const badge = $('queue-badge');
  if (badge) {
    badge.classList.toggle('active', searching || state.phase === 'Matchmaking');
    badge.classList.toggle('warning', canAccept || state.phase === 'ChampSelect' || state.phase === 'Reconnect');
  }
  const portrait = $('profile').querySelector('.portrait');
  if (portrait) portrait.classList.toggle('connected', state.connected);
  $('add-friend').disabled = !expanded && (busy || !state.connected || searching || inGame);
  $('invite').disabled = busy || !state.connected;
  const rolesLocked = busy || !state.connected || searching || inGame;
  $('primary-role').disabled = rolesLocked;
  $('secondary-role').disabled = rolesLocked || (roleDraft || rolePreferences)?.firstPreference === 'FILL';
  for (const button of $('role-options').children) button.disabled = rolesLocked;
  renderRoleIcons();
  renderDuo();
  renderLayout();
  renderInvite();
  $('connection-dot').className = `connection-dot ${state.connected ? 'online' : state.starting ? 'starting' : 'offline'}`;
  const phaseNotes = { ReadyCheck: accepted ? 'Accepté · les autres joueurs arrivent' : 'Une place t’attend dans la faille',
    ChampSelect: state.clientUi?.error || (state.clientUi?.opening ? 'Ouverture du client League…' : 'Sélection des champions · dans League'),
    Reconnect: state.clientUi?.error || 'Rejoins ta partie depuis le client', GameStart: 'La faille se prépare', InProgress: 'Bonne partie !',
    EndOfGame: 'Retour au salon…', WaitingForStats: 'Récupération des résultats…', PreEndOfGame: 'Récupération des résultats…' };
  if (((inGame || searching) && !$('feedback').classList.contains('error')) || blocked || blockedShown || Date.now() > noticeUntil) {
    blockedShown = Boolean(blocked);
    const estimate = state.estimatedQueueTime > 0 ? `Attente estimée · ${formatTime(state.estimatedQueueTime)}` : 'Recherche de partie…';
    const update = state.update || {};
    const updateNote = update.status === 'downloading' ? `Mise à jour ${update.version} · ${update.progress || 0} %`
      : update.status === 'ready' ? `Mise à jour ${update.version} prête` : update.status === 'installing' ? `Installation de la mise à jour ${update.version}…` : '';
    const note = waitingLeader ? 'Le chef du lobby lance la recherche' : blocked || phaseNotes[state.phase] || updateNote;
    if (update.status === 'installing') feedback(updateNote, false, false);
    else feedback(state.connected ? searching ? estimate : note : state.message || 'Connexion…', Boolean(blocked) || (!state.connected && !state.starting), false);
  }
  renderTimer();
}
function renderDuo() {
  const partner = state.connected ? state.duoPartner : null;
  const key = partner ? `${partner.summonerId}:${partner.profileIconId}` : null;
  const avatar = $('duo-avatar');
  if (key !== duoKey) {
    duoKey = key; lastDuoIcon = undefined; duoIconRequest = null;
    avatar.hidden = true; avatar.removeAttribute('src');
    $('duo-avatar-fallback').hidden = false;
  }
  $('duo-portrait').hidden = !partner;
  $('duo-roles').hidden = !partner;
  $('kick-friend').hidden = !partner || !state.canKick;
  $('kick-friend').disabled = busy || isSearching() || state.phase !== 'Lobby';
  $('duo-slot').classList.toggle('has-partner', Boolean(partner));
  for (const [id, key, label] of [['duo-primary-role', 'firstPreference', 'Principal'], ['duo-secondary-role', 'secondPreference', 'Secondaire']]) {
    const role = partner?.[key];
    const slot = $(id), icon = slot.querySelector('img');
    const knownRole = Object.hasOwn(roleLabels, role);
    icon.src = `assets/roles/${knownRole ? role.toLowerCase() : 'unselected'}.png`;
    slot.title = `${label} : ${knownRole ? roleLabels[role] : 'non sélectionné'}`;
    icon.alt = slot.title;
  }
  $('add-friend').hidden = Boolean(partner);
  $('invite-label').hidden = Boolean(partner);
  $('duo-name').hidden = !partner;
  $('duo-name').textContent = partner?.displayName || 'Partenaire';
  setLevel($('duo-level'), partner?.summonerLevel);
  $('duo-slot').title = partner ? `${partner.displayName || 'Partenaire'} · Niveau ${partner.summonerLevel || '—'}` : 'Inviter un ami';
  if (!partner || !Number.isInteger(partner.profileIconId) || partner.profileIconId < 0 || lastDuoIcon === partner.profileIconId || duoIconRequest) return;
  const request = {};
  duoIconRequest = request;
  window.league.getProfileIcon(partner.profileIconId).then(icon => {
    if (duoIconRequest !== request || !icon) return;
    lastDuoIcon = partner.profileIconId;
    avatar.src = icon; avatar.hidden = false;
    $('duo-avatar-fallback').hidden = true;
  }).catch(() => {}).finally(() => {
    if (duoIconRequest === request) duoIconRequest = null;
  });
}
$('kick-friend').addEventListener('click', () => {
  if (!state.connected || !state.canKick || !state.duoPartner || $('kick-friend').disabled) return;
  const id = state.duoPartner.summonerId;
  action(async () => {
    if (await window.league.kickMember(id)) feedback('Joueur exclu du lobby');
  });
});
$('duo-avatar').addEventListener('error', () => {
  $('duo-avatar').hidden = true;
  $('duo-avatar-fallback').hidden = false;
  lastDuoIcon = undefined;
});
// ---- Files : disposition du widget selon la file (duo, groupe, Arena) ----
function currentQueue() {
  return state.connected && state.queue ? state.queue : DEFAULT_QUEUE;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fallbackAvatar() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="24" cy="18" r="8"/><path d="M9 44v-4a15 15 0 0 1 30 0v4"/>';
  return svg;
}
// Icône de profil partagée par les places du groupe et de l'Arena.
function avatarImage(iconId) {
  const img = el('img');
  img.alt = '';
  img.hidden = true;
  if (!Number.isInteger(iconId) || iconId < 0) return img;
  if (!iconRequests.has(iconId)) iconRequests.set(iconId, window.league.getProfileIcon(iconId).catch(() => null));
  iconRequests.get(iconId).then(icon => {
    if (!icon) return;
    img.src = icon; img.hidden = false;
    img.nextElementSibling?.remove();
  });
  return img;
}
function roleIcons(member) {
  const slots = el('div', 'role-slots');
  for (const [key, secondary] of [['firstPreference', false], ['secondPreference', true]]) {
    const role = member?.[key], known = Object.hasOwn(roleLabels, role);
    const slot = el('div', `role-slot${secondary ? ' secondary-slot' : ''}`);
    const icon = el('img');
    icon.src = `assets/roles/${known ? role.toLowerCase() : 'unselected'}.png`;
    icon.alt = known ? roleLabels[role] : 'non sélectionné';
    slot.title = `${secondary ? 'Secondaire' : 'Principal'} : ${icon.alt}`;
    slot.append(icon); slots.append(slot);
  }
  return slots;
}
function kickButton(member) {
  const button = el('button', 'kick-friend');
  button.title = button.ariaLabel = `Exclure ${member.displayName || 'ce joueur'} du lobby`;
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8l8 8M16 8l-8 8"/></svg>';
  button.disabled = busy || isSearching() || state.phase !== 'Lobby';
  button.addEventListener('click', () => action(async () => {
    if (await window.league.kickMember(member.summonerId)) feedback('Joueur exclu du lobby');
  }));
  return button;
}
function inviteButton() {
  const button = el('button', 'add-friend');
  button.title = button.ariaLabel = 'Inviter un ami';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  button.disabled = $('add-friend').disabled;
  button.addEventListener('click', () => $('add-friend').click());
  return button;
}
function partySlot(member, invite, queue) {
  const slot = el('div', `player party-member${member ? '' : ' empty'}`);
  const frame = el('div', 'portrait-frame');
  if (member) {
    const portrait = el('div', 'portrait');
    portrait.append(avatarImage(member.profileIconId), fallbackAvatar());
    frame.append(portrait);
    if (state.canKick) frame.append(kickButton(member));
    const level = el('span', 'level');
    setLevel(level, member.summonerLevel);
    frame.append(level);
    slot.title = `${member.displayName || 'Joueur'} · Niveau ${member.summonerLevel || '—'}`;
  } else frame.append(invite ? inviteButton() : el('span', 'slot-empty'));
  slot.append(frame, member ? el('strong', 'player-name', member.displayName || 'Joueur') : el('span', 'invite-label', invite ? 'Inviter' : ''));
  if (member && queue.positions) slot.append(roleIcons(member));
  return slot;
}
function renderParty(queue, members, places, canInvite = true) {
  const container = $('party-slots');
  const key = JSON.stringify([places, canInvite, queue.positions, state.canKick, busy, isSearching(), state.phase, $('add-friend').disabled,
    members.map(m => [m.summonerId, m.displayName, m.summonerLevel, m.profileIconId, m.firstPreference, m.secondPreference])]);
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  container.replaceChildren(...Array.from({ length: places }, (_, i) => partySlot(members[i], canInvite && i === members.length, queue)));
}
// Arena : ton équipe en grand (comme un groupe), les autres équipes en pastilles.
function arenaState(queue) {
  const mine = state.localSubteam?.subteamIndex >= 1 ? state.localSubteam : { subteamIndex: 1, intraSubteamPosition: 1 };
  const others = state.connected ? state.members || [] : [];
  const byTeam = new Map();
  for (const member of others) {
    if (!byTeam.has(member.subteamIndex)) byTeam.set(member.subteamIndex, []);
    byTeam.get(member.subteamIndex).push(member);
  }
  const teammates = (byTeam.get(mine.subteamIndex) || []).sort((a, b) => a.intraSubteamPosition - b.intraSubteamPosition);
  const teams = [...byTeam.keys()].filter(team => team !== mine.subteamIndex && team >= 1 && team <= queue.teams).sort((a, b) => a - b);
  const freeTeam = Array.from({ length: queue.teams }, (_, i) => i + 1).find(team => team !== mine.subteamIndex && !byTeam.has(team));
  return { mine, byTeam, teammates, teams, freeTeam, total: others.length + 1 };
}
function teamChip(team, members, queue, canMove) {
  const size = queue.teamSize || 2;
  const free = Array.from({ length: size }, (_, i) => i + 1).find(position => !members.some(member => member.intraSubteamPosition === position));
  const chip = el('button', `team-chip${members.length ? '' : ' new'}`);
  chip.dataset.team = team;
  chip.append(el('span', 'chip-number', members.length ? String(team) : '+'));
  const dots = el('span', 'chip-seats');
  for (let position = 1; position <= size; position++) {
    const member = members.find(item => item.intraSubteamPosition === position);
    const seat = el('span', `chip-seat${member ? '' : ' open'}`);
    if (member) { seat.append(avatarImage(member.profileIconId), fallbackAvatar()); seat.title = member.displayName || 'Joueur'; }
    dots.append(seat);
  }
  chip.append(dots);
  if (!members.length) chip.append(el('span', 'chip-label', 'Nouvelle'));
  chip.disabled = !canMove || !free;
  chip.title = !free ? `Équipe ${team} complète`
    : members.length ? `Rejoindre l’équipe ${team} · ${members.map(m => m.displayName || 'Joueur').join(', ')}` : 'Passer dans une nouvelle équipe';
  chip.addEventListener('click', () => action(async () => {
    await window.league.switchArenaTeam(team, free);
    feedback(members.length ? `Tu rejoins l’équipe ${team}` : `Tu passes dans l’équipe ${team}`);
  }));
  return chip;
}
function renderArena(queue) {
  const arena = arenaState(queue);
  renderParty(queue, arena.teammates, (queue.teamSize || 2) - 1, arena.total < queue.maxParty);
  const strip = $('arena-grid');
  const canMove = Boolean(state.localSubteam) && !busy && !isSearching() && state.phase === 'Lobby';
  const showNew = arena.freeTeam && arena.teammates.length > 0;
  const chips = arena.teams.length + (showNew ? 1 : 0);
  strip.hidden = !chips;
  const key = JSON.stringify([arena.teams, showNew && arena.freeTeam, canMove, [...arena.byTeam.entries()].map(([team, list]) =>
    [team, list.map(m => [m.summonerId, m.displayName, m.profileIconId, m.intraSubteamPosition])])]);
  if (chips && strip.dataset.key !== key) {
    strip.dataset.key = key;
    strip.replaceChildren(el('span', 'strip-title', 'Changer d’équipe'),
      ...arena.teams.map(team => teamChip(team, arena.byTeam.get(team), queue, canMove)),
      ...(showNew ? [teamChip(arena.freeTeam, [], queue, canMove)] : []));
  }
  return chips ? Math.ceil(chips / 3) : 0;
}
function renderLayout() {
  const queue = currentQueue(), layout = queue.layout || 'duo';
  const widget = document.querySelector('.widget');
  widget.dataset.layout = layout;
  widget.dataset.positions = queue.positions === false ? 'off' : 'on';
  $('queue-label').textContent = queue.label || 'Solo / Duo';
  $('duo-slot').hidden = layout !== 'duo';
  $('party-slots').hidden = layout === 'duo';
  let width = layout === 'duo' ? 300 : 440, height = queue.positions === false ? 204 : 230;
  if (layout === 'party') {
    renderParty(queue, state.connected ? state.members || [] : [], Math.max(1, Math.min(queue.maxParty, 5) - 1));
    $('arena-grid').hidden = true;
  }
  if (layout === 'arena') {
    const rows = renderArena(queue);
    if (rows) height += 28 + rows * 30 + (rows - 1) * 6;
  } else $('arena-grid').hidden = true;
  const size = `${width}x${Math.min(480, height)}`;
  if (size !== lastSize && window.league.setWidgetSize) {
    lastSize = size;
    window.league.setWidgetSize(width, Math.min(480, height)).catch(() => { lastSize = ''; });
  }
}
const MODE_ICONS = {
  kSummonersRift: '<path d="M5 19 19 5"/><path d="M5 9V5h4M15 19h4v-4"/><path d="M12 8.5 15.5 12 12 15.5 8.5 12z"/>',
  kARAM: '<path d="M3 15h18"/><path d="M5 15a7 7 0 0 1 14 0"/><path d="M8 15v4M16 15v4M12 8v7"/>',
  arena: '<circle cx="12" cy="12" r="8"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  other: '<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/>'
};
function queueTile(queue, selected) {
  const tile = el('button', `queue-option${queue.disabled ? ' locked' : ''}`);
  tile.dataset.queue = queue.id;
  tile.setAttribute('aria-pressed', String(queue.id === selected));
  tile.disabled = Boolean(queue.disabled);
  const icon = el('span', 'mode-icon');
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MODE_ICONS[queue.arena ? 'arena' : queue.group] || MODE_ICONS.other}</svg>`;
  const text = el('span', 'mode-text');
  // Titre court (« Arena ») et variante en sous-titre (« Bravoure · trios ») pour tenir dans la tuile.
  const [title, ...variant] = queue.arena ? queue.label.split(' ') : [queue.label];
  const teams = { 2: 'duos', 3: 'trios' }[queue.teamSize] || `équipes de ${queue.teamSize || 2}`;
  const players = queue.arena ? teams : queue.maxParty > 2 ? `1 à ${queue.maxParty}` : '1 ou 2';
  const detail = el('small');
  if (queue.disabled) detail.textContent = queue.disabled;
  else {
    if (queue.ranked) detail.append(el('span', 'ranked', 'Classée'), ' · ');
    detail.append([...(variant.length ? [variant.join(' ')] : []), players, ...(!queue.ranked && !queue.positions && !queue.arena ? ['aléatoire'] : [])].join(' · '));
  }
  text.append(el('b', '', title), detail);
  tile.append(icon, text);
  tile.title = queue.disabled ? `${queue.label} · ${queue.disabled}` : queue.label;
  tile.addEventListener('click', () => action(async () => {
    const chosen = await window.league.selectQueue(queue.id);
    await setPanel(null);
    feedback(`Mode : ${chosen.label}`);
  }));
  return tile;
}
async function openQueues() {
  await setPanel('queues');
  const list = $('queue-options');
  try {
    const { queues, selected } = await window.league.listQueues();
    list.replaceChildren(...(queues.length ? queues.map(queue => queueTile(queue, selected)) : [el('p', 'empty-list', 'Aucune file disponible')]));
  } catch (error) {
    list.replaceChildren(el('p', 'empty-list', 'Files indisponibles pour le moment'));
    feedback(error.message, true);
  }
}
$('queue-button').addEventListener('click', () => (queuesExpanded ? setPanel(null) : openQueues()));
$('close-queues').addEventListener('click', () => setPanel(null));
function setLevel(element, level) {
  element.hidden = !Number.isInteger(level) || level <= 0;
  element.textContent = element.hidden ? '' : String(level);
}
function pendingInvites() {
  const invitations = state.connected && Array.isArray(state.invitations) ? state.invitations : [];
  for (const id of handledInvites) if (!invitations.some(invitation => invitation.id === id)) handledInvites.delete(id);
  return invitations.filter(invitation => !handledInvites.has(invitation.id));
}
function renderInvite() {
  const pending = pendingInvites(), invite = pending[0];
  $('invite-toast').hidden = !invite;
  document.querySelector('.widget').classList.toggle('has-invite', Boolean(invite));
  if (!invite) { inviteIconKey = null; return; }
  const queue = queueLabels[invite.queueId] || invite.gameMode || 'Partie';
  $('invite-name').textContent = invite.name;
  $('invite-queue').textContent = queue;
  $('invite-toast').title = `${invite.name} t’invite · ${queue}`;
  $('invite-more').hidden = pending.length < 2;
  $('invite-more').textContent = `+${pending.length - 1}`;
  $('invite-accept').disabled = $('invite-decline').disabled = busy;
  const key = `${invite.id}:${invite.profileIconId}`;
  if (key === inviteIconKey) return;
  inviteIconKey = key;
  $('invite-avatar').hidden = true;
  if (!Number.isInteger(invite.profileIconId) || invite.profileIconId < 0) return;
  window.league.getProfileIcon(invite.profileIconId).then(icon => {
    if (inviteIconKey !== key || !icon) return;
    $('invite-avatar').src = icon; $('invite-avatar').hidden = false;
  }).catch(() => {});
}
function answerInvite(accept) {
  const invite = pendingInvites()[0];
  if (!invite) return;
  action(async () => {
    if (accept) await window.league.acceptInvitation(invite.id);
    else await window.league.declineInvitation(invite.id);
    handledInvites.add(invite.id);
    feedback(accept ? `Tu rejoins le lobby de ${invite.name}` : 'Invitation refusée');
  });
}
$('invite-accept').addEventListener('click', () => answerInvite(true));
$('invite-decline').addEventListener('click', () => answerInvite(false));
function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function renderTimer() {
  const timer = $('queue-timer');
  const searching = isSearching();
  const ready = state.connected && state.phase === 'ReadyCheck' && state.ready?.active && state.ready.deadline !== null && state.ready?.response !== 'Accepted';
  timer.hidden = !searching && !ready;
  timer.classList.toggle('countdown', Boolean(ready));
  if (searching) {
    timer.textContent = queueStartedAt === null ? '—:——' : formatTime((Date.now() - queueStartedAt) / 1000);
    timer.title = 'Temps écoulé en recherche';
    timer.setAttribute('aria-label', timer.title);
  } else if (ready) {
    timer.textContent = `${Math.max(0, Math.ceil((state.ready.deadline - Date.now()) / 1000))} s`;
    timer.title = 'Temps restant estimé pour accepter';
    timer.setAttribute('aria-label', timer.title);
  }
}
async function refresh() {
  if (busy) return;
  const version = actionVersion, request = ++refreshVersion;
  try {
    const next = await window.league.getStatus();
    if (version !== actionVersion || request !== refreshVersion) return;
    if (state.phase !== next.phase || Boolean(state.searching) !== Boolean(next.searching)) { noticeUntil = 0; $('feedback').classList.remove('error'); }
    state = next;
    if (!state.connected || gamePhases.includes(state.phase)) queueStartedAt = null;
    else if (state.searching && state.timeInQueue !== null && state.timeInQueue !== undefined) queueStartedAt = state.sampledAt - state.timeInQueue * 1000;
    else if (!state.searching && !queueTransition?.searching) queueStartedAt = null;
    if (queueTransition && (gamePhases.includes(state.phase) || Date.now() > queueTransition.expires ||
      (state.connected && Boolean(state.searching || state.phase === 'Matchmaking') === queueTransition.searching))) queueTransition = null;
    render();
    if (state.connected && state.duoPartner && expanded && currentQueue().layout === 'duo') await setPanel(null);
    if (state.connected && rolePreferences === undefined && !roleDraft) {
      rolePreferences = await window.league.getRoles();
      renderRoleIcons();
    }
    const player = state.summoner;
    $('profile').title = state.connected ? `${player.gameName || player.displayName || 'Invocateur'} · Niveau ${player.summonerLevel || '—'}` : state.message || 'Connexion…';
    $('summoner-name').textContent = state.connected ? player.gameName || player.displayName || 'Invocateur' : state.starting ? 'Connexion…' : 'Hors ligne';
    setLevel($('level'), state.connected ? player.summonerLevel : null);
    if (state.connected && player.profileIconId !== undefined && lastIcon !== player.profileIconId) {
      const icon = await window.league.getProfileIcon(player.profileIconId);
      if (icon) { $('avatar').src = icon; $('avatar').hidden = false; $('avatar-fallback').hidden = true; lastIcon = player.profileIconId; }
    }
  } catch (error) { feedback(error.message, true); }
}
async function action(work) {
  if (busy) return;
  actionVersion++;
  busy = true; render();
  try { await work(); } catch (error) { feedback(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  finally { actionVersion++; busy = false; render(); await refresh(); }
}

$('open-client').addEventListener('click', () => action(async () => {
  feedback('Ouverture du client League…');
  await window.league.openClient();
  feedback('Client League affiché');
}));
$('play').addEventListener('click', () => action(async () => {
  if (!state.connected) { await window.league.launch(); return; }
  if (state.phase === 'ReadyCheck') {
    await window.league.acceptReady();
    state.ready = { ...state.ready, response: 'Accepted' };
    return;
  }
  if (['ChampSelect', 'Reconnect'].includes(state.phase)) { await window.league.openClient(); return; }
  if (gamePhases.includes(state.phase)) return;
  if (isSearching()) {
    await window.league.cancelSearch();
    queueStartedAt = null;
    queueTransition = { searching: false, expires: Date.now() + 8000 };
    feedback('Recherche annulée');
  } else {
    if (currentQueue().positions !== false) {
      rolePreferences = await window.league.getRoles();
      if (!rolePreferences) { await openRoles(); feedback('Choisis tes deux rôles'); return; }
    }
    await window.league.startSearch();
    queueStartedAt = Date.now();
    queueTransition = { searching: true, expires: Date.now() + 8000 };
    feedback('Recherche en cours · clic pour annuler');
  }
}));
async function setPanel(panel) {
  if (panel !== 'roles') roleDraft = null;
  expanded = panel === 'friends';
  rolesExpanded = panel === 'roles';
  queuesExpanded = panel === 'queues';
  $('queue-panel').hidden = !queuesExpanded;
  $('invitations').hidden = !expanded;
  $('roles-panel').hidden = !rolesExpanded;
  $('add-friend').setAttribute('aria-expanded', String(expanded));
  $('primary-role').setAttribute('aria-expanded', String(rolesExpanded && selectedRoleSlot === 'firstPreference'));
  $('secondary-role').setAttribute('aria-expanded', String(rolesExpanded && selectedRoleSlot === 'secondPreference'));
  render();
}
$('add-friend').addEventListener('click', async () => {
  await setPanel(expanded ? null : 'friends');
  if (expanded) { loadFriends(); $('friend-name').focus(); }
});

function renderRoleIcons() {
  const current = roleDraft || rolePreferences;
  for (const [id, key, label] of [['primary-role', 'firstPreference', 'Principal'], ['secondary-role', 'secondPreference', 'Secondaire']]) {
    const role = current?.[key];
    const button = $(id);
    button.querySelector('img').src = `assets/roles/${roleLabels[role] ? role.toLowerCase() : 'unselected'}.png`;
    button.title = `${label} : ${roleLabels[role] || 'à choisir'}${roleDraft ? ' (non enregistré)' : ''}`;
    button.setAttribute('aria-label', button.title);
    button.classList.toggle('draft', Boolean(roleDraft));
  }
  $('role-picker-title').textContent = selectedRoleSlot === 'firstPreference' ? 'Rôle principal' : 'Rôle secondaire';
  $('role-step').textContent = selectedRoleSlot === 'firstPreference' ? 'Étape 1 sur 2' : 'Étape 2 sur 2';
  for (const button of $('role-options').children) {
    button.setAttribute('aria-pressed', String(button.dataset.role === current?.[selectedRoleSlot]));
    const rank = button.dataset.role === current?.firstPreference ? '1' : button.dataset.role === current?.secondPreference ? '2' : null;
    if (rank) button.dataset.rank = rank; else delete button.dataset.rank;
  }
}
async function openRoles(slot = 'firstPreference') {
  if (!roleDraft) rolePreferences = await window.league.getRoles();
  selectedRoleSlot = slot;
  await setPanel('roles');
}
for (const [id, slot] of [['primary-role', 'firstPreference'], ['secondary-role', 'secondPreference']]) {
  $(id).addEventListener('click', async () => {
    try {
      if (rolesExpanded && selectedRoleSlot === slot) { roleDraft = null; await setPanel(null); }
      else await openRoles(slot);
    } catch (error) { feedback(error.message, true); }
  });
}
$('close-roles').addEventListener('click', async () => { roleDraft = null; await setPanel(null); });
for (const [role, label] of Object.entries(roleLabels)) {
  const button = document.createElement('button');
  button.className = 'role-option'; button.dataset.role = role; button.title = label === 'Fill' ? 'Remplissage' : label;
  const icon = document.createElement('img'); icon.src = `assets/roles/${role.toLowerCase()}.png`; icon.alt = '';
  const text = document.createElement('span'); text.textContent = label;
  button.append(icon, text);
  button.addEventListener('click', () => action(async () => {
    const next = { ...(roleDraft || rolePreferences || {}) };
    const other = selectedRoleSlot === 'firstPreference' ? 'secondPreference' : 'firstPreference';
    if (next[other] === role) next[other] = next[selectedRoleSlot] || 'UNSELECTED';
    next[selectedRoleSlot] = role;
    if (next.firstPreference === 'FILL') next.secondPreference = 'UNSELECTED';
    roleDraft = next;
    if (!roleLabels[next.firstPreference] || (next.firstPreference !== 'FILL' && !roleLabels[next.secondPreference])) {
      selectedRoleSlot = !roleLabels[next.firstPreference] ? 'firstPreference' : 'secondPreference';
      await setPanel('roles');
      feedback(selectedRoleSlot === 'firstPreference' ? 'Choisis ton rôle principal' : 'Choisis ton rôle secondaire');
      return;
    }
    const result = await window.league.saveRoles(next);
    rolePreferences = result; roleDraft = null;
    await setPanel(null);
    feedback(result.recovered ? 'Lobby rétabli · rôles enregistrés' : 'Rôles enregistrés');
  }));
  $('role-options').append(button);
}
async function loadFriends() {
  try {
    const friends = await window.league.getOnlineFriends();
    $('friend-list').replaceChildren();
    $('friends-count').textContent = friends.length ? `${friends.length} connecté${friends.length > 1 ? 's' : ''}` : 'Amis connectés';
    if (!friends.length) {
      const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = 'Aucun ami connecté'; $('friend-list').append(empty);
    }
    for (const friend of friends) {
      const row = document.createElement('div'); row.className = `friend-item ${friend.status === 'inGame' ? 'in-game' : 'online'}`;
      const label = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = friend.name;
      const status = document.createElement('small'); status.textContent = friend.status === 'inGame' ? 'En partie' : 'En ligne';
      label.append(name, status);
      const invite = document.createElement('button'); invite.textContent = '+'; invite.title = `Inviter ${friend.name}`;
      invite.addEventListener('click', () => action(async () => {
        await window.league.inviteSummoner(friend.summonerId); invite.textContent = '✓'; invite.disabled = true; feedback('Invitation envoyée');
      }));
      row.dataset.name = friend.name.toLowerCase();
      row.append(label, invite); $('friend-list').append(row);
    }
    filterFriends();
  } catch (error) { feedback('Amis indisponibles : ' + error.message, true); }
}
$('invite-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => { await window.league.invite($('friend-name').value); feedback('Invitation envoyée'); $('friend-name').value = ''; filterFriends(); });
});
$('friend-name').addEventListener('input', filterFriends);
function filterFriends() {
  const query = $('friend-name').value.trim().toLowerCase();
  for (const row of $('friend-list').querySelectorAll('.friend-item')) row.hidden = Boolean(query) && !row.dataset.name.includes(query);
}
$('refresh-friends').addEventListener('click', loadFriends);
$('close-friends').addEventListener('click', () => setPanel(null));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (expanded || rolesExpanded || queuesExpanded)) setPanel(null);
});
$('close-widget').addEventListener('click', () => window.league.closeWidget());
setInterval(renderTimer, 200);
async function poll() { await refresh(); setTimeout(poll, 1000); }
poll();
