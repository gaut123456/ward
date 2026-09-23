const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const lcu = require('./lcu.cjs');
const { validateRoles, applyRoles } = require('./roles.cjs');
const { queueState, readySnapshot, createClientHandoff } = require('./gameflow.cjs');
const handoff = createClientHandoff();
let readyState = readySnapshot(null), quitting = false;
let mainWindow, readyWindow, poller, launchTask;
let startupMessage = 'Démarrage de League…';
let starting = false, dismissedReady = false, readyActive = false;
const iconCache = new Map();
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
if (preview && process.argv.includes('--smoke-test')) app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'ward-smoke-')));

function savedRoles() {
  try { return validateRoles(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'roles.json'), 'utf8'))); }
  catch { return null; }
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
  launchTask = lcu.launch(message => { startupMessage = message; })
    .then(() => { startupMessage = ''; })
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
      readyState = readySnapshot(phase === 'ReadyCheck' ? ready : null, Date.now(), readyState);
      const active = readyState.active;
      if (!active) { dismissedReady = false; closeReady(); }
      else if (readyState.response !== 'Declined') {
        if (!readyActive) dismissedReady = false;
        showReady();
      } else closeReady();
      readyActive = active;
      if (readyWindow && !readyWindow.isDestroyed()) readyWindow.webContents.send('ready-check', readyState);
      await handoff.observe(phase);
    } catch { readyActive = false; readyState = readySnapshot(null); closeReady(); }
  }
  if (!quitting) poller = setTimeout(watchReady, 750);
}

async function ensureLobby() {
  const { phase, searching } = await queueState();
  if (searching || !['None', 'Lobby'].includes(phase)) throw new Error('Une partie ou une recherche est déjà en cours.');
  const lobby = await currentLobby();
  if (lobby?.gameConfig?.queueId === 420) return lobby;
  if (lobby) throw new Error('Quitte ton autre lobby dans League avant de lancer une Solo/Duo.');
  return lcu.call('POST', '/lol-lobby/v2/lobby', { queueId: 420 });
}

ipcMain.handle('lcu:status', async () => {
  if (preview) return { connected: true, summoner: { displayName: 'Invocateur', summonerLevel: 120 }, phase: 'None' };
  try {
    const [summoner, queue, lobby] = await Promise.all([
      lcu.call('GET', '/lol-summoner/v1/current-summoner'), queueState(), currentLobby()
    ]);
    const localId = lobby?.localMember?.summonerId || summoner.summonerId;
    const partner = localId ? lobby?.members?.find(member => member.summonerId && String(member.summonerId) !== String(localId)) : null;
    let duoPartner = partner ? { summonerId: partner.summonerId, displayName: partner.summonerName,
      profileIconId: partner.summonerIconId, summonerLevel: partner.summonerLevel,
      firstPreference: partner.firstPositionPreference, secondPreference: partner.secondPositionPreference } : null;
    if (duoPartner) {
      // Chat presence is the only source that updates while the partner sits
      // in the lobby; the lobby copy and the summoner endpoint lag behind.
      const friends = await lcu.call('GET', '/lol-chat/v1/friends').catch(() => null);
      const presence = (Array.isArray(friends) ? friends : [])
        .find(friend => String(friend.summonerId) === String(duoPartner.summonerId));
      if (presence?.icon !== undefined) duoPartner.profileIconId = presence.icon;
      else if (duoPartner.profileIconId === undefined) {
        const fresh = await lcu.call('GET', `/lol-summoner/v1/summoners/${duoPartner.summonerId}`).catch(() => null);
        if (fresh?.profileIconId !== undefined) {
          duoPartner.profileIconId = fresh.profileIconId;
          if (fresh.summonerLevel !== undefined) duoPartner.summonerLevel = fresh.summonerLevel;
          if (fresh.gameName || fresh.displayName) duoPartner.displayName = fresh.gameName || fresh.displayName;
        }
      }
    }
    const canKick = Boolean(partner && lobby.localMember?.isLeader === true && queue.phase === 'Lobby' && !queue.searching);
    return { connected: true, summoner, duoPartner, canKick, ...queue, ready: readyState, clientUi: { ...handoff.state } };
  } catch (error) { return { connected: false, starting, message: startupMessage || error.message }; }
});

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
  if (lobby?.gameConfig?.queueId === 420) {
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
ipcMain.handle('lobby:start-search', async () => {
  const lobby = await ensureLobby();
  const preferences = savedRoles() || lobbyRoles(lobby);
  if (!preferences) throw new Error('Choisis tes rôles avant de lancer la recherche.');
  await applyRoles(preferences);
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
ipcMain.handle('widget:close', () => app.quit());

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(() => { createMainWindow(); startLeague(); watchReady(); });
}
app.on('before-quit', () => { quitting = true; clearTimeout(poller); });
app.on('window-all-closed', () => app.quit());
