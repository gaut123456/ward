const { app, BrowserWindow, ipcMain, screen, dialog, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const lcu = require('./lcu.cjs');
const { validateRoles, applyRoles } = require('./roles.cjs');
const { queueState, readySnapshot, createClientHandoff } = require('./gameflow.cjs');
const updater = require('./updater.cjs');
const queues = require('./queues.cjs');
const clientUi = require('./client-ui.cjs');
const { closeHeadlessLeague } = require('./shutdown.cjs');
const champSelect = require('./champselect.cjs');
const runes = require('./runes.cjs');
// Interface du client : si Ward a lancé League, il la ferme par la commande officielle du client
// (kill-ux) quand elle s'ouvre sans avoir été demandée ; le bouton ↗ suspend cette fermeture.
// Le splash de LeagueClient.exe (logo League) reste affiché après kill-ux : on le retire aussi
// (DELETE /riotclient/splash), après chaque fermeture et pendant les 2 minutes qui suivent le lancement.
let launchedByWard = false, userWantsUx = false, uxChecks = 0, launchedAt = 0;
const hideSplash = () => lcu.call('DELETE', '/riotclient/splash').catch(() => {});
async function closeUnrequestedUx() {
  if (!launchedByWard || userWantsUx) return;
  if (Date.now() - launchedAt < 120000) hideSplash();
  if (!await lcu.uxRunning()) return;
  await lcu.call('POST', '/riotclient/kill-ux').then(() => console.log('[Ward] interface du client fermee')).catch(() => {});
  hideSplash();
}
const handoff = createClientHandoff();
let readyState = readySnapshot(null), quitting = false;
let mainWindow, readyWindow, poller, launchTask;
let startupMessage = 'Démarrage de League…';
let lastWatchedPhase = null;
let starting = false, dismissedReady = false, readyActive = false;
const iconCache = new Map();
const inviterCache = new Map();
let updateState = { status: 'idle' };
const preview = process.argv.includes('--preview');
// Keep the same preferences when moving from npm start to the packaged exe.
const defaultUserData = path.join(app.getPath('appData'), 'ward');
if (app.isPackaged) app.setPath('userData', defaultUserData);
// Reprend les rôles enregistrés sous l'ancien nom (League Widget) au premier lancement de Ward.
if (app.getPath('userData') === defaultUserData) {
  try {
    const legacy = path.join(app.getPath('appData'), 'lol-ranked-widget', 'roles.json');
    const current = path.join(defaultUserData, 'roles.json');
    if (!fs.existsSync(current) && fs.existsSync(legacy)) {
      fs.mkdirSync(defaultUserData, { recursive: true });
      fs.copyFileSync(legacy, current);
    }
  } catch { /* Sans migration, les rôles seront simplement redemandés. */ }
}
// L'aperçu ne touche jamais League : préférences et verrou d'instance à part, pour ne pas bloquer le vrai Ward.
if (preview) app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'ward-preview-')));

function savedRoles() {
  try { return validateRoles(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'roles.json'), 'utf8'))); }
  catch { return null; }
}

const DEFAULT_QUEUE = 420;
function savedQueueId() {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).queueId;
    return Number.isInteger(id) && id > 0 ? id : DEFAULT_QUEUE;
  } catch { return DEFAULT_QUEUE; }
}
function saveQueueId(queueId) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ queueId }));
}

// Files jouables (règles lues dans le client), gardées une minute en cache.
let catalogCache = { at: 0, level: null, list: [] };
async function queueCatalog(level) {
  if (Date.now() - catalogCache.at < 60000 && catalogCache.level === level) return catalogCache.list;
  const list = queues.playable(await lcu.call('GET', '/lol-game-queues/v1/queues'), level ?? Infinity);
  catalogCache = { at: Date.now(), level, list };
  return list;
}

// Infos de la file du lobby (ou de la file choisie s'il n'y a pas encore de lobby).
function queueInfo(catalog, lobby) {
  const config = lobby?.gameConfig;
  const id = config?.queueId ?? savedQueueId();
  const known = catalog.find(queue => queue.id === id);
  const base = known || (config ? { id, label: queues.label({ id, gameMode: config.gameMode }), positions: Boolean(config.showPositionSelector), custom: Boolean(config.isCustom),
    arena: queues.isArena(config), maxParty: config.maxLobbySize || 5, premadeSizes: config.allowablePremadeSizes || [] }
    : { id: DEFAULT_QUEUE, label: 'Solo / Duo', positions: true, arena: false, maxParty: 2, premadeSizes: [1, 2] });
  const maxParty = config?.maxLobbySize || base.maxParty;
  const teamSize = base.arena ? queues.arenaTeamSize(id, lobby?.members) : null;
  return { ...base, maxParty, layout: base.arena ? 'arena' : base.custom || maxParty <= 2 ? 'duo' : 'party',
    teams: base.arena ? queues.arenaTeams(maxParty, teamSize) : null, teamSize };
}

async function currentLobby() {
  try { return await lcu.call('GET', '/lol-lobby/v2/lobby'); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

function lobbyRoles(lobby) {
  try { return validateRoles({ firstPreference: lobby?.localMember?.firstPositionPreference, secondPreference: lobby?.localMember?.secondPositionPreference }); }
  catch { return null; }
}

async function startLeague() {
  if (preview) return;
  if (launchTask) return launchTask;
  starting = true;
  launchTask = lcu.launch(message => { startupMessage = message; }, text => console.log(`[Ward] demarrage - ${text}`))
    .then(result => {
      startupMessage = '';
      if (result?.launched) { launchedByWard = true; launchedAt = Date.now(); closeUnrequestedUx(); }
    })
    .catch(error => { startupMessage = error.message; })
    .finally(() => { starting = false; launchTask = null; });
  return launchTask;
}

function createMainWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({ width: 300, height: 230,
    x: area.x + area.width - 316, y: area.y + 40,
    title: 'Ward', icon: path.join(__dirname, '../renderer/assets/app-icon.png'), frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: false, resizable: false, maximizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (preview && process.argv.includes('--smoke-test')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        for (let attempt = 0; attempt < 50; attempt++) {
          const valid = await mainWindow.webContents.executeJavaScript(`Boolean(window.league) && document.querySelector('#play').textContent === 'Lancer' && Array.from(document.querySelectorAll('.role-option img')).every(image => image.complete && image.naturalWidth > 0)`);
          if (valid) {
            console.log('PACKAGED_SMOKE_OK ' + JSON.stringify({ packaged: app.isPackaged, size: mainWindow.getSize(), alwaysOnTop: mainWindow.isAlwaysOnTop() }));
            app.exit(0); return;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Packaged renderer/preload/assets did not become ready.');
      } catch (error) { console.error(error.message); app.exit(1); }
    });
  }
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
}

function closeReady() {
  if (readyWindow && !readyWindow.isDestroyed()) readyWindow.close();
  readyWindow = null;
}

function showReady() {
  if (readyWindow || dismissedReady) return;
  const area = screen.getPrimaryDisplay().workArea;
  readyWindow = new BrowserWindow({ width: 310, height: 260,
    x: area.x + area.width - 330, y: area.y + area.height - 280,
    alwaysOnTop: true, frame: false, resizable: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  readyWindow.loadFile(path.join(__dirname, '../renderer/ready.html'));
  readyWindow.on('closed', () => { readyWindow = null; });
}

async function watchReady() {
  if (!preview) {
    try {
      const [phase, ready] = await Promise.all([
        lcu.call('GET', '/lol-gameflow/v1/gameflow-phase'),
        lcu.call('GET', '/lol-matchmaking/v1/ready-check').catch(() => null)
      ]);
      lastWatchedPhase = phase;
      // Toutes les ~3 s : ferme l'interface réapparue sans demande ; après ↗ puis fermeture, reprend.
      if (launchedByWard && ++uxChecks % 4 === 0) {
        if (userWantsUx) { if (!await lcu.uxRunning()) userWantsUx = false; }
        else await closeUnrequestedUx();
      }
      readyState = readySnapshot(phase === 'ReadyCheck' ? ready : null, Date.now(), readyState);
      const active = readyState.active;
      if (!active) { dismissedReady = false; closeReady(); }
      else if (readyState.response !== 'Declined') {
        if (!readyActive) dismissedReady = false;
        showReady();
      } else closeReady();
      readyActive = active;
      if (readyWindow && !readyWindow.isDestroyed()) readyWindow.webContents.send('ready-check', readyState);
    } catch { readyActive = false; readyState = readySnapshot(null); closeReady(); }
  }
  if (!quitting) poller = setTimeout(watchReady, 750);
}

// Partie perso (Outil d'entraînement) : il faut le queueId ET customGameLobby (sinon INVALID_LOBBY / INVALID_REQUEST).
async function createLobby(queueId) {
  const queue = (await queueCatalog().catch(() => [])).find(item => item.id === queueId);
  return lcu.call('POST', '/lol-lobby/v2/lobby', queue?.custom
    ? { queueId, isCustom: true, customGameLobby: { lobbyName: 'Ward', configuration: {} } }
    : { queueId });
}
// Garde le lobby existant (sa file est celle du chef) ; sinon crée celui de la file choisie.
async function ensureLobby() {
  const { phase, searching } = await queueState();
  if (searching || !['None', 'Lobby'].includes(phase)) throw new Error('Une partie ou une recherche est déjà en cours.');
  const lobby = await currentLobby();
  if (lobby) return lobby;
  const queueId = savedQueueId();
  try { return await createLobby(queueId); }
  catch (error) {
    if (queueId === DEFAULT_QUEUE) throw error;
    saveQueueId(DEFAULT_QUEUE);
    throw new Error('Cette file n’est plus disponible : choisis-en une autre.');
  }
}

async function readStatus() {
  if (preview) return { connected: true, summoner: { displayName: 'Invocateur', summonerLevel: 120 }, phase: 'None' };
  try {
    const [summoner, queue, lobby, received] = await Promise.all([
      lcu.call('GET', '/lol-summoner/v1/current-summoner'), queueState(), currentLobby(),
      lcu.call('GET', '/lol-lobby/v2/received-invitations').catch(() => [])
    ]);
    const localId = lobby?.localMember?.summonerId || summoner.summonerId;
    const others = localId ? (lobby?.members || []).filter(member => member.summonerId && String(member.summonerId) !== String(localId)) : [];
    const members = others.map(member => ({ summonerId: member.summonerId, displayName: member.summonerName,
      profileIconId: member.summonerIconId, summonerLevel: member.summonerLevel, isLeader: member.isLeader === true,
      firstPreference: member.firstPositionPreference, secondPreference: member.secondPositionPreference,
      subteamIndex: member.subteamIndex, intraSubteamPosition: member.intraSubteamPosition }));
    if (members.length) {
      // Chat presence is the only source that updates while a member sits
      // in the lobby; the lobby copy and the summoner endpoint lag behind.
      const friends = await lcu.call('GET', '/lol-chat/v1/friends').catch(() => null);
      await Promise.all(members.map(async member => {
        const presence = (Array.isArray(friends) ? friends : []).find(friend => String(friend.summonerId) === String(member.summonerId));
        if (presence?.icon !== undefined) member.profileIconId = presence.icon;
        else if (member.profileIconId === undefined) {
          const fresh = await lcu.call('GET', `/lol-summoner/v1/summoners/${member.summonerId}`).catch(() => null);
          if (fresh?.profileIconId !== undefined) {
            member.profileIconId = fresh.profileIconId;
            if (fresh.summonerLevel !== undefined) member.summonerLevel = fresh.summonerLevel;
            if (fresh.gameName || fresh.displayName) member.displayName = fresh.gameName || fresh.displayName;
          }
        }
      }));
    }
    const { isLeader: partnerLeads, subteamIndex, intraSubteamPosition, ...duoPartner } = members[0] || {};
    const canKick = Boolean(members.length && lobby.localMember?.isLeader === true && queue.phase === 'Lobby' && !queue.searching);
    const invitations = await describeInvitations(received);
    // Only an explicit false means someone else leads: a lobby we created is ours.
    const isLeader = lobby?.localMember?.isLeader !== false;
    const catalog = await queueCatalog(summoner.summonerLevel).catch(() => []);
    const lobbyQueue = queueInfo(catalog, lobby);
    const blocked = lobby && isLeader ? queues.blockReason(lobby, lobbyQueue) : null;
    const session = queue.phase === 'ChampSelect' ? await lcu.call('GET', '/lol-champ-select/v1/session').catch(() => null) : null;
    return { connected: true, summoner, duoPartner: members.length ? duoPartner : null, members, canKick, isLeader,
      champSelect: champSelect.normalizeSession(session),
      queueId: lobby?.gameConfig?.queueId ?? null, queue: lobbyQueue, blocked,
      localSubteam: lobby?.localMember ? { subteamIndex: lobby.localMember.subteamIndex, intraSubteamPosition: lobby.localMember.intraSubteamPosition } : null,
      invitations, ...queue, ready: readyState, clientUi: { ...handoff.state } };
  } catch (error) { return { connected: false, starting, message: startupMessage || error.message }; }
}
ipcMain.handle('lcu:status', async () => ({ ...(await readStatus()), update: { ...updateState } }));

// Mise à jour automatique au lancement de l'exe portable (voir updater.cjs).
async function quietMoment() {
  if (preview) return true;
  try {
    const { phase, searching } = await queueState();
    return !searching && ['None', 'Lobby', 'EndOfGame'].includes(phase);
  } catch { return true; } // League fermé : rien à interrompre.
}
async function runUpdater() {
  const currentFile = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!app.isPackaged || !currentFile || (preview && process.env.WARD_UPDATE_TEST !== '1')) return;
  const currentVersion = app.getVersion();
  try {
    updateState = { status: 'checking' };
    const update = await updater.checkForUpdate({ currentVersion, fetch: net.fetch });
    if (!update) { updateState = { status: 'idle' }; return; }
    const downloaded = path.join(path.dirname(currentFile), `Ward-${update.version}.update`);
    updateState = { status: 'downloading', version: update.version, progress: 0 };
    await updater.download(update, downloaded, { fetch: net.fetch,
      onProgress: progress => { updateState = { ...updateState, progress }; } });
    updateState = { status: 'ready', version: update.version, progress: 100 };
    while (!await quietMoment()) await new Promise(resolve => setTimeout(resolve, 2000));
    updateState = { status: 'installing', version: update.version };
    await new Promise(resolve => setTimeout(resolve, 1500));
    await updater.install({ currentFile, downloaded, target: updater.targetPath(currentFile, currentVersion, update.version),
      args: process.argv.slice(1), tempDir: app.getPath('temp') });
    app.quit();
  } catch (error) {
    updateState = { status: 'error', message: error.message };
    console.warn(`Mise à jour impossible : ${error.message}`);
  }
}

async function describeInvitations(received) {
  const pending = (Array.isArray(received) ? received : [])
    .filter(invitation => invitation?.state === 'Pending' && invitation.invitationId).slice(0, 5);
  return Promise.all(pending.map(async invitation => {
    const id = invitation.fromSummonerId;
    let inviter = inviterCache.get(id);
    if (!inviter) {
      const summoner = id ? await lcu.call('GET', `/lol-summoner/v1/summoners/${id}`).catch(() => null) : null;
      inviter = { name: summoner?.gameName || summoner?.displayName || invitation.fromSummonerName || 'Un ami',
        profileIconId: summoner?.profileIconId };
      if (summoner) {
        if (inviterCache.size >= 20) inviterCache.clear();
        inviterCache.set(id, inviter);
      }
    }
    return { id: String(invitation.invitationId), fromSummonerId: id, name: inviter.name, profileIconId: inviter.profileIconId,
      queueId: invitation.gameConfig?.queueId ?? null, gameMode: invitation.gameConfig?.gameMode || null };
  }));
}

ipcMain.handle('profile:icon', async (_event, id) => {
  if (!Number.isInteger(id) || id < 0) return null;
  try {
    if (!iconCache.has(id)) {
      const bytes = await lcu.call('GET', `/lol-game-data/assets/v1/profile-icons/${id}.jpg`, undefined, true);
      if (iconCache.size >= 8) iconCache.delete(iconCache.keys().next().value);
      iconCache.set(id, `data:image/jpeg;base64,${bytes.toString('base64')}`);
    }
    return iconCache.get(id);
  } catch { return null; }
});
ipcMain.handle('league:launch', startLeague);
ipcMain.handle('league:open-client', async () => {
  if (preview) return;
  userWantsUx = true;
  await handoff.open({ manual: true });
});
ipcMain.handle('ready:state', () => readyState);
ipcMain.handle('lobby:create-ranked', ensureLobby);
ipcMain.handle('roles:get', async () => savedRoles() || (preview ? null : lobbyRoles(await currentLobby())));
ipcMain.handle('roles:save', async (_event, value) => {
  const preferences = validateRoles(value);
  const { phase, searching } = await queueState();
  if (searching || !['None', 'Lobby'].includes(phase)) throw new Error('Annule la recherche avant de changer tes rôles.');
  const lobby = await currentLobby();
  let recovered = false;
  if (lobby?.gameConfig && lobby.gameConfig.showPositionSelector !== false) {
    ({ recovered } = await applyRoles(preferences));
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'roles.json'), JSON.stringify(preferences));
  return { ...preferences, recovered };
});
ipcMain.handle('friends:online', async () => {
  if (preview) return [];
  const friends = await lcu.call('GET', '/lol-chat/v1/friends');
  return (Array.isArray(friends) ? friends : [])
    .filter(friend => ['chat', 'away', 'dnd', 'mobile'].includes(friend.availability) && (friend.summonerId || friend.lol?.summonerId))
    .map(friend => ({ summonerId: friend.summonerId || friend.lol.summonerId,
      name: friend.gameName ? `${friend.gameName}${friend.gameTag ? '#' + friend.gameTag : ''}` : friend.displayName || friend.name,
      status: friend.lol?.gameStatus || friend.availability }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});
ipcMain.handle('lobby:invite-summoner', async (_event, id) => {
  if (!/^\d+$/.test(String(id)) || Number(id) <= 0) throw new Error('Ami invalide.');
  await ensureLobby();
  await lcu.call('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: Number(id) }]);
});
ipcMain.handle('lobby:invite', async (_event, rawName) => {
  if (typeof rawName !== 'string' || !rawName.trim() || rawName.length > 100) throw new Error('Entre un pseudo ou un Riot ID.');
  const name = rawName.trim();
  const summoner = await lcu.call('GET', `/lol-summoner/v1/summoners?name=${encodeURIComponent(name)}`);
  if (!summoner?.summonerId) throw new Error('Joueur introuvable. Essaie Pseudo#TAG.');
  await ensureLobby();
  await lcu.call('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: summoner.summonerId }]);
});
let kickPending = false;
async function kickTarget(id) {
  const [phase, search, lobby] = await Promise.all([
    lcu.call('GET', '/lol-gameflow/v1/gameflow-phase'),
    lcu.call('GET', '/lol-lobby/v2/lobby/matchmaking/search-state'), currentLobby()
  ]);
  if (phase !== 'Lobby' || !['Invalid', 'Canceled', 'Error'].includes(search?.searchState)) throw new Error('Annule la recherche avant d’exclure un joueur.');
  if (!lobby?.localMember?.summonerId || lobby.localMember.isLeader !== true) throw new Error('Seul le chef du lobby peut exclure un joueur.');
  const member = lobby.members?.find(member => String(member.summonerId) === String(id));
  if (!member || String(id) === String(lobby.localMember.summonerId)) throw new Error('Ce joueur ne peut pas être exclu.');
  return member;
}
ipcMain.handle('lobby:kick-member', async (_event, id) => {
  if (preview || !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('Joueur invalide.');
  if (kickPending) throw new Error('Une exclusion est déjà en cours.');
  kickPending = true;
  try {
    const member = await kickTarget(id);
    const { response } = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Exclure du lobby',
      message: `Exclure ${member.summonerName || 'ce joueur'} du lobby ?`,
      buttons: ['Annuler', 'Exclure'], defaultId: 0, cancelId: 0, noLink: true });
    if (response !== 1) return false;
    await kickTarget(id);
    await lcu.call('POST', `/lol-lobby/v2/lobby/members/${id}/kick`);
    return true;
  } finally { kickPending = false; }
});
ipcMain.handle('queues:list', async () => {
  if (preview) return { queues: [], selected: DEFAULT_QUEUE };
  const summoner = await lcu.call('GET', '/lol-summoner/v1/current-summoner').catch(() => null);
  const [catalog, lobby] = await Promise.all([queueCatalog(summoner?.summonerLevel), currentLobby()]);
  return { queues: catalog, selected: lobby?.gameConfig?.queueId ?? savedQueueId() };
});
ipcMain.handle('queue:select', async (_event, value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('File invalide.');
  const queue = (await queueCatalog((await lcu.call('GET', '/lol-summoner/v1/current-summoner')).summonerLevel)).find(item => item.id === id);
  if (!queue) throw new Error('Cette file n’est pas disponible.');
  if (queue.disabled) throw new Error(queue.disabled);
  const { phase, searching } = await queueState();
  if (searching || !['None', 'Lobby'].includes(phase)) throw new Error('Annule la recherche avant de changer de file.');
  const lobby = await currentLobby();
  if (lobby?.localMember?.isLeader === false) throw new Error('Seul le chef du lobby peut changer de file.');
  if ((lobby?.members?.length || 1) > queue.maxParty) throw new Error(`Trop de joueurs pour ${queue.label} (${queue.maxParty} maximum).`);
  saveQueueId(id);
  if (lobby && lobby.gameConfig?.queueId !== id) await createLobby(id);
  return queue;
});
ipcMain.handle('arena:team', async (_event, subteamIndex, position) => {
  const { phase, searching } = await queueState();
  if (searching || phase !== 'Lobby') throw new Error('Change d’équipe avant de lancer la recherche.');
  const lobby = await currentLobby();
  if (!lobby || !queues.isArena(lobby.gameConfig)) throw new Error('Tu n’es pas dans un lobby Arena.');
  const error = queues.arenaSlotError(lobby, subteamIndex, position);
  if (error) throw new Error(error);
  await lcu.call('PUT', '/lol-lobby/v2/lobby/subteamData', { subteamIndex, intraSubteamPosition: position });
});
// Taille du widget selon la file : il s'agrandit vers la gauche pour rester collé au bord droit.
ipcMain.handle('widget:size', (_event, width, height) => {
  if (!mainWindow || ![300, 440, 520, 640].includes(width) || !Number.isInteger(height) || height < 200 || height > 480) return;
  const bounds = mainWindow.getBounds();
  if (bounds.width === width && bounds.height === height) return;
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x + bounds.width - width, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  mainWindow.setBounds({ x, y, width, height });
});
// ---- Sélection des champions ----
const assetCache = new Map();
let staticData = null;
async function champSelectStatic() {
  if (!staticData) {
    const [summary, spells] = await Promise.all([
      lcu.call('GET', '/lol-game-data/assets/v1/champion-summary.json'),
      lcu.call('GET', '/lol-game-data/assets/v1/summoner-spells.json')
    ]);
    staticData = { summary: summary.filter(champion => champion.id > 0), spells };
  }
  return staticData;
}
async function currentGameMode() {
  const session = await lcu.call('GET', '/lol-gameflow/v1/session').catch(() => null);
  return session?.gameData?.queue?.gameMode || (await currentLobby().catch(() => null))?.gameConfig?.gameMode || 'CLASSIC';
}
async function allowedSpells() {
  const [{ spells }, gameMode] = await Promise.all([champSelectStatic(), currentGameMode()]);
  return spells.filter(spell => spell.id > 0 && spell.name && (spell.gameModes || []).includes(gameMode))
    .map(spell => ({ id: spell.id, name: spell.name, iconPath: spell.iconPath }));
}
async function champSession() {
  if (await lcu.call('GET', '/lol-gameflow/v1/gameflow-phase') !== 'ChampSelect') throw new Error('La sélection des champions est terminée.');
  return lcu.call('GET', '/lol-champ-select/v1/session');
}
ipcMain.handle('cs:data', async () => {
  const [{ summary }, pickable, bannable, positions, grid, spells] = await Promise.all([
    champSelectStatic(),
    lcu.call('GET', '/lol-champ-select/v1/pickable-champion-ids').catch(() => []),
    lcu.call('GET', '/lol-champ-select/v1/bannable-champion-ids').catch(() => []),
    lcu.call('GET', '/lol-perks/v1/recommended-champion-positions').catch(() => ({})),
    lcu.call('GET', '/lol-champ-select/v1/all-grid-champions').catch(() => []),
    allowedSpells()
  ]);
  const favorites = new Map((Array.isArray(grid) ? grid : []).map(item => [item.id, (item.positionsFavorited || []).map(p => String(p).toUpperCase())]));
  return {
    champions: summary.map(champion => ({ id: champion.id, name: champion.name, alias: champion.alias,
      positions: champSelect.championPositions(positions, champion.id), favorites: favorites.get(champion.id) || [] }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    pickable, bannable, spells
  };
});
// Images du jeu (icônes de champions, sorts, runes), limitées aux données du client.
ipcMain.handle('asset:image', async (_event, assetPath) => {
  if (typeof assetPath !== 'string' || !/^\/lol-game-data\/assets\/[\w\-./%]+\.(png|jpg|jpeg|webp)$/i.test(assetPath) || assetPath.includes('..')) return null;
  if (!assetCache.has(assetPath)) {
    const bytes = await lcu.call('GET', assetPath, undefined, true).catch(() => null);
    if (!bytes) return null;
    if (assetCache.size >= 600) assetCache.delete(assetCache.keys().next().value);
    const type = /\.png$/i.test(assetPath) ? 'png' : /\.webp$/i.test(assetPath) ? 'webp' : 'jpeg';
    assetCache.set(assetPath, `data:image/${type};base64,${bytes.toString('base64')}`);
  }
  return assetCache.get(assetPath);
});
ipcMain.handle('cs:hover', async (_event, championId) => {
  const session = await champSession();
  const [pickable, bannable] = await Promise.all([
    lcu.call('GET', '/lol-champ-select/v1/pickable-champion-ids').catch(() => []),
    lcu.call('GET', '/lol-champ-select/v1/bannable-champion-ids').catch(() => [])
  ]);
  const action = champSelect.hoverTarget(session, championId, { pickable, bannable });
  await lcu.call('PATCH', `/lol-champ-select/v1/session/actions/${action.id}`, { championId });
});
// Verrouiller / bannir : « POST …/complete » est accepté sans effet en partie perso (constaté en Outil
// d'entraînement) ; la mise à jour { championId, completed: true } marche partout. On relit pour confirmer.
ipcMain.handle('cs:lock', async () => {
  const action = champSelect.lockTarget(await champSession());
  await lcu.call('PATCH', `/lol-champ-select/v1/session/actions/${action.id}`, { championId: action.championId, completed: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const session = await lcu.call('GET', '/lol-champ-select/v1/session').catch(() => null);
    if (!session || session.actions.flat().find(item => item.id === action.id)?.completed) return { type: action.type, championId: action.championId };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('League n’a pas confirmé le verrouillage. Réessaie.');
});
ipcMain.handle('cs:swap', async (_event, kind, id, accept) => {
  const route = champSelect.swapTarget(await champSession(), kind, id);
  await lcu.call('POST', `${route}/${accept ? 'accept' : 'decline'}`);
});
ipcMain.handle('cs:reroll', async () => {
  champSelect.rerollAllowed(await champSession());
  await lcu.call('POST', '/lol-champ-select/v1/session/my-selection/reroll');
});
ipcMain.handle('cs:bench', async (_event, championId) => {
  await lcu.call('POST', champSelect.benchTarget(await champSession(), championId));
});
ipcMain.handle('cs:spells', async (_event, spell1Id, spell2Id) => {
  await champSession();
  const allowed = (await allowedSpells()).map(spell => spell.id);
  await lcu.call('PATCH', '/lol-champ-select/v1/session/my-selection', champSelect.validateSpells(spell1Id, spell2Id, allowed));
});
// ---- Runes ----
let runeStatic = null;
async function runeData() {
  if (!runeStatic) {
    const [styles, perks] = await Promise.all([lcu.call('GET', '/lol-perks/v1/styles'), lcu.call('GET', '/lol-perks/v1/perks')]);
    runeStatic = runes.describeStyles(styles, perks);
  }
  return runeStatic;
}
// Champion, poste et carte pour les recommandations du client.
async function recommendationContext() {
  const cs = champSelect.normalizeSession(await lcu.call('GET', '/lol-champ-select/v1/session').catch(() => null));
  const me = cs?.myTeam.find(player => player.isLocal);
  const championId = me?.championId || me?.hoverId || cs?.action?.championId || 0;
  const gameflow = await lcu.call('GET', '/lol-gameflow/v1/session').catch(() => null);
  const mapId = gameflow?.gameData?.queue?.mapId || 11;
  let position = (cs?.position || '').toLowerCase();
  if (!position && mapId === 11 && championId) {
    const positions = await lcu.call('GET', '/lol-perks/v1/recommended-champion-positions').catch(() => ({}));
    position = String(positions?.[championId]?.recommendedPositions?.[0] || '').toLowerCase();
  }
  return { championId, position: position || 'none', mapId };
}
function describePage(page) {
  return { id: page.id, name: page.name, current: Boolean(page.current), editable: Boolean(page.isEditable), valid: Boolean(page.isValid),
    primaryStyleId: page.primaryStyleId, subStyleId: page.subStyleId, selectedPerkIds: page.selectedPerkIds || [] };
}
ipcMain.handle('runes:data', async () => {
  const [data, pages, inventory, context] = await Promise.all([
    runeData(), lcu.call('GET', '/lol-perks/v1/pages'), lcu.call('GET', '/lol-perks/v1/inventory').catch(() => ({})), recommendationContext()
  ]);
  const recommended = context.championId
    ? await lcu.call('GET', `/lol-perks/v1/recommended-pages/champion/${context.championId}/position/${context.position}/map/${context.mapId}`).catch(() => [])
    : [];
  return {
    ...data, context, canAdd: Boolean(inventory.canAddCustomPage),
    pages: (Array.isArray(pages) ? pages : []).filter(page => !page.isTemporary).map(describePage),
    recommendations: (Array.isArray(recommended) ? recommended : []).map(item => ({
      keystoneId: item.keystone?.id, primaryStyleId: item.primaryPerkStyleId, subStyleId: item.secondaryPerkStyleId,
      perks: (item.perks || []).map(perk => perk.id), spells: item.summonerSpellIds || [] }))
  };
});
ipcMain.handle('runes:select', async (_event, id) => {
  const pages = await lcu.call('GET', '/lol-perks/v1/pages');
  if (!pages.some(page => page.id === id)) throw new Error('Page introuvable.');
  await lcu.call('PUT', '/lol-perks/v1/currentpage', id);
});
// Enregistre dans une page modifiable existante, ou dans une nouvelle page s'il reste de la place.
ipcMain.handle('runes:save', async (_event, page, target) => {
  const clean = runes.validatePage(page, (await runeData()).styles);
  if (target === 'new') {
    const inventory = await lcu.call('GET', '/lol-perks/v1/inventory');
    if (!inventory.canAddCustomPage) throw new Error('Plus de place pour une nouvelle page : modifie une page existante.');
    const created = await lcu.call('POST', '/lol-perks/v1/pages', { ...clean, current: true });
    return created?.id;
  }
  const existing = (await lcu.call('GET', '/lol-perks/v1/pages')).find(item => item.id === target);
  if (!existing) throw new Error('Page introuvable.');
  if (!existing.isEditable) throw new Error('Cette page ne peut pas être modifiée : choisis une de tes pages.');
  await lcu.call('PUT', `/lol-perks/v1/pages/${existing.id}`, { ...existing, ...clean, current: true });
  if (!existing.current) await lcu.call('PUT', '/lol-perks/v1/currentpage', existing.id);
  return existing.id;
});
function invitationId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) throw new Error('Invitation invalide.');
  return value;
}
ipcMain.handle('invitation:accept', async (_event, value) => {
  const id = invitationId(value);
  const { phase, searching } = await queueState();
  if (searching) throw new Error('Annule ta recherche avant de rejoindre ce lobby.');
  if (!['None', 'Lobby'].includes(phase)) throw new Error('Impossible de rejoindre un lobby pendant une partie.');
  await lcu.call('POST', `/lol-lobby/v2/received-invitations/${id}/accept`);
});
ipcMain.handle('invitation:decline', async (_event, value) => {
  await lcu.call('POST', `/lol-lobby/v2/received-invitations/${invitationId(value)}/decline`);
});
ipcMain.handle('lobby:start-search', async () => {
  const lobby = await ensureLobby();
  if (lobby.gameConfig?.isCustom) {
    // Après une sélection perso annulée, le client refuse pendant ~15 s : on réessaie.
    for (let attempt = 0; attempt < 14; attempt++) {
      if ((await lcu.call('POST', '/lol-lobby/v1/lobby/custom/start-champ-select'))?.success) return { custom: true };
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('League refuse de démarrer la partie pour le moment. Réessaie dans quelques secondes.');
  }
  if (lobby.gameConfig?.showPositionSelector !== false) {
    const preferences = savedRoles() || lobbyRoles(lobby);
    if (!preferences) throw new Error('Choisis tes rôles avant de lancer la recherche.');
    await applyRoles(preferences);
  }
  const catalog = await queueCatalog().catch(() => []);
  const latest = await currentLobby(); // Relecture juste avant la recherche : rôles et restrictions à jour.
  const reason = latest && queues.blockReason(latest, queueInfo(catalog, latest));
  if (reason) throw new Error(reason);
  await lcu.call('POST', '/lol-lobby/v2/lobby/matchmaking/search');
  return { searching: true };
});
ipcMain.handle('lobby:cancel-search', async () => {
  const { phase } = await queueState();
  if (!['None', 'Lobby', 'Matchmaking'].includes(phase)) throw new Error('La partie est déjà trouvée : la recherche ne peut plus être annulée.');
  await lcu.call('DELETE', '/lol-lobby/v2/lobby/matchmaking/search');
  return { searching: false };
});
ipcMain.handle('ready:accept', async () => {
  await lcu.call('POST', '/lol-matchmaking/v1/ready-check/accept');
  readyState = { ...readyState, response: 'Accepted' };
  readyWindow?.webContents.send('ready-check', readyState);
});
ipcMain.handle('window:hide-ready', () => { dismissedReady = true; closeReady(); });
// ✕ : ferme Ward, et League s'il tourne en arrière-plan (jamais un client affiché ;
// confirmation avant de quitter une recherche ou une partie). Les mises à jour ne passent pas par ici.
let closing = false;
ipcMain.handle('widget:close', async () => {
  if (closing) return;
  closing = true;
  mainWindow?.hide();
  closeReady();
  if (!preview) {
    const outcome = await closeHeadlessLeague({
      call: lcu.call, queueState, inspect: () => clientUi.inspectUx(),
      confirm: async detail => (await dialog.showMessageBox({ type: 'warning', title: 'Fermer Ward', message: 'Fermer aussi League ?', detail,
        buttons: ['Laisser League ouvert', 'Fermer League aussi'], defaultId: 0, cancelId: 0, noLink: true })).response === 1
    }).catch(error => `erreur : ${error.message}`);
    console.log(`Fermeture de Ward · League : ${outcome}`);
  }
  app.quit();
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(() => { createMainWindow(); startLeague(); watchReady(); runUpdater(); });
}
app.on('before-quit', () => { quitting = true; clearTimeout(poller); });
app.on('window-all-closed', () => app.quit());
