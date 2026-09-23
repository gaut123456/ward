const $ = id => document.getElementById(id);
let state = { connected: false, starting: true, phase: 'None' };
let busy = false, expanded = false, rolesExpanded = false, lastIcon, lastDuoIcon, noticeUntil = 0;
let rolePreferences, queueTransition = null, actionVersion = 0, refreshVersion = 0;
let roleDraft = null, selectedRoleSlot = 'firstPreference';
let queueStartedAt = null, duoKey = null, duoIconRequest = null;
const roleLabels = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support', FILL: 'Fill' };
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
  $('play').disabled = busy || (!state.connected && state.starting) || (state.connected && inGame && !canAccept && !canOpen);
  $('play').textContent = busy ? 'Un instant…' : !state.connected ? state.starting ? 'Lancement de League…' : 'Réessayer' : searching ? 'Annuler' : labels[state.phase] || 'Lancer';
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
  $('connection-dot').className = `connection-dot ${state.connected ? 'online' : state.starting ? 'starting' : 'offline'}`;
  const phaseNotes = { ReadyCheck: accepted ? 'Accepté · les autres joueurs arrivent' : 'Une place t’attend dans la faille',
    ChampSelect: state.clientUi?.error || (state.clientUi?.opening ? 'Ouverture du client League…' : 'Sélection des champions · dans League'),
    Reconnect: state.clientUi?.error || 'Rejoins ta partie depuis le client', GameStart: 'La faille se prépare', InProgress: 'Bonne partie !',
    EndOfGame: 'Retour au salon…', WaitingForStats: 'Récupération des résultats…', PreEndOfGame: 'Récupération des résultats…' };
  if (((inGame || searching) && !$('feedback').classList.contains('error')) || Date.now() > noticeUntil) {
    const estimate = state.estimatedQueueTime > 0 ? `Attente estimée · ${formatTime(state.estimatedQueueTime)}` : 'Recherche de partie…';
    feedback(state.connected ? searching ? estimate : phaseNotes[state.phase] || '' : state.message || 'Connexion…', !state.connected && !state.starting, false);
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
function setLevel(element, level) {
  element.hidden = !Number.isInteger(level) || level <= 0;
  element.textContent = element.hidden ? '' : String(level);
}
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
    if (state.connected && state.duoPartner && expanded) await setPanel(null);
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
    rolePreferences = await window.league.getRoles();
    if (!rolePreferences) { await openRoles(); feedback('Choisis tes deux rôles'); return; }
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
  if (event.key === 'Escape' && (expanded || rolesExpanded)) setPanel(null);
});
$('close-widget').addEventListener('click', () => window.league.closeWidget());
setInterval(renderTimer, 200);
async function poll() { await refresh(); setTimeout(poll, 1000); }
poll();
