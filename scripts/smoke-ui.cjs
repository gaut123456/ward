const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const lcu = require('../electron/lcu.cjs');
const clientUi = require('../electron/client-ui.cjs');
const realCreateClientUi = clientUi.createClientUi;
clientUi.createClientUi = options => realCreateClientUi({ ...options, inspect: async () => ({ exists: true, hasWindow: true, visible: true }) });
let uxVisible = false;
clientUi.inspectUx = async () => ({ exists: true, hasWindow: uxVisible, visible: uxVisible });
const qa = path.resolve('.qa');
fs.mkdirSync(qa, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(qa, 'electron-')));
const calls = [];
let phase = 'None', lobby = null, failedSearch = false, searching = false, staleSearchReads = 0;
let ready = { state: 'Invalid' }, failAccept = false;
let kicks = [];
let allowKick = true;
let received = [];
let csSession = null;
const STAT = [{ perks: [5008, 5005, 5007], type: 'kStatMod' }, { perks: [5008, 5010, 5001], type: 'kStatMod' }, { perks: [5011, 5013, 5001], type: 'kStatMod' }];
const RUNE_STYLES = [
  { id: 8000, name: 'Precision', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/8000.png', allowedSubStyles: [8100], slots: [
    { perks: [8005, 8008, 8021, 8010], type: 'kKeyStone' }, { perks: [9101, 9111, 8009], type: 'kMixedRegularSplashable' },
    { perks: [9104, 9105, 9103], type: 'kMixedRegularSplashable' }, { perks: [8014, 8017, 8299], type: 'kMixedRegularSplashable' }, ...STAT] },
  { id: 8100, name: 'Domination', iconPath: '/lol-game-data/assets/v1/perk-images/Styles/8100.png', allowedSubStyles: [8000], slots: [
    { perks: [8112, 8128, 9923], type: 'kKeyStone' }, { perks: [8126, 8139, 8143], type: 'kMixedRegularSplashable' },
    { perks: [8137, 8140, 8141], type: 'kMixedRegularSplashable' }, { perks: [8135, 8105, 8106], type: 'kMixedRegularSplashable' }, ...STAT] }
];
const RUNE_PERKS = [...new Set(RUNE_STYLES.flatMap(style => style.slots.flatMap(slot => slot.perks)))]
  .map(id => ({ id, name: `Rune ${id}`, iconPath: `/lol-game-data/assets/v1/perk-images/${id}.png`, shortDesc: `Effet <b>${id}</b>` }));
let runePages = [
  { id: 11, name: 'Ma page', current: true, isEditable: true, isValid: true, isTemporary: false, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [8005, 9111, 9104, 8014, 8126, 8137, 5008, 5008, 5011] },
  { id: 12, name: 'Page Riot', current: false, isEditable: false, isValid: true, isTemporary: false, primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: [8112, 8126, 8137, 8135, 9111, 9104, 5008, 5008, 5011] }
];
const csSessionFor = ({ ban = false } = {}) => ({
  queueId: 420, isCustomGame: false, localPlayerCellId: 2,
  timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 27000, totalTimeInPhase: 30000, isInfinite: false },
  myTeam: [
    { cellId: 0, gameName: 'Aerith', nameVisibilityType: 'VISIBLE', assignedPosition: 'top', championId: 266, championPickIntent: 0, spell1Id: 4, spell2Id: 12 },
    { cellId: 1, gameName: '', nameVisibilityType: 'HIDDEN', assignedPosition: 'jungle', championId: 0, championPickIntent: 64, spell1Id: 4, spell2Id: 11 },
    { cellId: 2, gameName: 'Invocateur', nameVisibilityType: 'VISIBLE', assignedPosition: 'middle', championId: 0, championPickIntent: 0, spell1Id: 4, spell2Id: 14 }
  ],
  theirTeam: [{ cellId: 5, championId: 0 }, { cellId: 6, championId: 0 }],
  bans: { myTeamBans: [], theirTeamBans: [], numBans: 2 },
  actions: [
    [{ id: 3, actorCellId: 0, type: 'pick', championId: 266, completed: true, isInProgress: false, isAllyAction: true }],
    [{ id: 1, actorCellId: 2, type: 'ban', championId: 0, completed: !ban, isInProgress: ban, isAllyAction: true }],
    [{ id: 4, actorCellId: 2, type: 'pick', championId: 0, completed: false, isInProgress: !ban, isAllyAction: true }]
  ],
  trades: [], benchChampions: [], benchEnabled: false, allowRerolling: false
});
const queueBase = { queueAvailability: 'Available', isVisible: true, isEnabled: true, category: 'PvP', isCustom: false, showQuickPlaySlotSelection: false, minLevel: 0 };
const QUEUES = [
  { ...queueBase, id: 420, name: 'Ranked Solo/Duo', gameMode: 'CLASSIC', type: 'RANKED_SOLO_5x5', gameSelectModeGroup: 'kSummonersRift', showPositionSelector: true, isRanked: true, maximumParticipantListSize: 2, allowablePremadeSizes: [0, 1, 2], minLevel: 30 },
  { ...queueBase, id: 440, name: 'Ranked Flex', gameMode: 'CLASSIC', type: 'RANKED_FLEX_SR', gameSelectModeGroup: 'kSummonersRift', showPositionSelector: true, isRanked: true, maximumParticipantListSize: 5, allowablePremadeSizes: [1, 2, 3, 5], minLevel: 30 },
  { ...queueBase, id: 480, name: 'Swiftplay', gameMode: 'SWIFTPLAY', type: 'SWIFTPLAY', gameSelectModeGroup: 'kSummonersRift', showQuickPlaySlotSelection: true, maximumParticipantListSize: 5 },
  { ...queueBase, id: 450, name: 'ARAM', gameMode: 'ARAM', type: 'ARAM_UNRANKED_5x5', gameSelectModeGroup: 'kARAM', showPositionSelector: false, maximumParticipantListSize: 5, allowablePremadeSizes: [0, 1, 2, 3, 4, 5] },
  { ...queueBase, id: 1740, name: 'Bravery Arena', gameMode: 'CHERRY', type: 'CHERRY', gameSelectModeGroup: 'kAlternativeLeagueGameModes', showPositionSelector: false, maximumParticipantListSize: 18 },
  { ...queueBase, id: 3140, name: 'Multiplayer Practice Tool Custom', gameMode: 'PRACTICETOOL', type: 'NORMAL', category: 'Custom', isCustom: true, showPositionSelector: false, maximumParticipantListSize: 14 }
];
const gameConfigFor = queueId => {
  const queue = QUEUES.find(item => item.id === queueId);
  assert.ok(queue, `file inconnue ${queueId}`);
  return { queueId, gameMode: queue.gameMode, maxLobbySize: queue.maximumParticipantListSize, showPositionSelector: queue.showPositionSelector,
    allowablePremadeSizes: queue.allowablePremadeSizes, premadeSizeAllowed: true, isCustom: Boolean(queue.isCustom) };
};
let releaseIcon, failIcon = false, partnerIcon = 0, chatIcon = 0, partnerInChat = true;
const iconBytes = fs.readFileSync(path.join(__dirname, '../renderer/assets/roles/middle.png'));
const queueBegan = Date.now() - 83000;
lcu.launch = async () => {};
lcu.call = async (method, route, body) => {
  calls.push({ method, route, body });
  if (route === '/lol-gameflow/v1/gameflow-phase') return phase;
  if (route === '/lol-lobby/v2/lobby/matchmaking/search-state') {
    const reported = staleSearchReads-- > 0 ? !searching : searching;
    return { searchState: reported ? 'Searching' : 'Invalid' };
  }
  const id = () => { const match = route.match(/members\/(\d+)\/kick$/); return match ? Number(match[1]) : null; };
  if (route === '/lol-summoner/v1/current-summoner') return { summonerId: 99, gameName: 'Invocateur', summonerLevel: 377 };
  if (route.startsWith('/lol-summoner/v1/summoners/')) return { summonerId: 42, profileIconId: partnerIcon, summonerLevel: 100, gameName: 'Partenaire' };
  if (route.startsWith('/lol-game-data/assets/v1/profile-icons/')) {
    if (failIcon) throw new Error('Icon unavailable');
    if (route.endsWith('/2.jpg')) return new Promise(resolve => { releaseIcon = () => resolve(iconBytes); });
    return iconBytes;
  }
  if (route === '/lol-matchmaking/v1/search') return { searchState: 'Invalid', timeInQueue: (Date.now() - queueBegan) / 1000, estimatedQueueTime: 95 };
  if (route === '/lol-matchmaking/v1/ready-check') return ready;
  if (route === '/lol-matchmaking/v1/ready-check/accept') {
    if (failAccept) throw new Error('Acceptation indisponible');
    ready = { ...ready, playerResponse: 'Accepted' }; return null;
  }
  if (['/riotclient/launch-ux', '/riotclient/ux-show'].includes(route)) return null;
  if (route === '/lol-chat/v1/friends') return Array.from({ length: 11 }, (_, i) => ({ gameName: `Ami ${i + 1}`, gameTag: 'EUW', summonerId: i + 1, availability: 'chat', lol: { gameStatus: 'outOfGame' } })).concat(partnerInChat ? [{ summonerId: 42, gameName: 'Partenaire', gameTag: 'EUW', availability: 'chat', icon: chatIcon, lol: { gameStatus: 'outOfGame' } }] : []);
  if (route === '/lol-lobby/v2/lobby') {
    if (method === 'POST') {
      phase = 'Lobby';
      if (lobby?.members) { lobby.gameConfig = gameConfigFor(body.queueId); return lobby; } // Changement de file : le groupe reste.
      return lobby = { gameConfig: body.queueId === 420 ? { queueId: 420 } : gameConfigFor(body.queueId) };
    }
    if (!lobby) throw Object.assign(new Error('Not found'), { status: 404 });
    return lobby;
  }
  if (route === '/lol-lobby/v2/lobby/matchmaking/search') {
    if (failedSearch) throw new Error('Choisis tes positions dans League avant de lancer.');
    searching = method === 'POST'; staleSearchReads = 2; return null;
  }
  if (route.endsWith('/position-preferences')) {
    assert.equal(method, 'PUT');
    assert.ok(lobby);
    lobby.localMember = { firstPositionPreference: body.firstPreference, secondPositionPreference: body.secondPreference };
    return null;
  }
  if (route.startsWith('/lol-summoner/v1/summoners?name=')) return { summonerId: 42 };
  if (route === '/lol-lobby/v2/lobby/invitations') return null;
  if (route === '/lol-lobby/v2/lobby/members/42/kick') {
    if (!allowKick) throw new Error('Exclusion refusée');
    if (method === 'POST') {
      kicks.push(id());
      if (lobby?.members) lobby.members = lobby.members.filter(member => String(member.summonerId) !== String(id()));
    }
    return null;
  }
  if (route === '/lol-lobby/v2/received-invitations') return received;
  if (route === '/lol-game-queues/v1/queues') return QUEUES;
  if (route === '/lol-lobby/v1/lobby/custom/start-champ-select') { assert.equal(method, 'POST'); phase = 'ChampSelect'; return { success: true }; }
  if (route === '/lol-champ-select/v1/session') { if (!csSession) throw Object.assign(new Error('Not found'), { status: 404 }); return csSession; }
  if (route === '/lol-champ-select/v1/pickable-champion-ids') return [103, 64, 266, 238];
  if (route === '/lol-champ-select/v1/bannable-champion-ids') return [103, 64, 266, 238, 157];
  if (route === '/lol-perks/v1/recommended-champion-positions') return { 103: { recommendedPositions: ['MIDDLE'] }, 64: { recommendedPositions: ['JUNGLE'] }, 266: { recommendedPositions: ['TOP'] }, 238: { recommendedPositions: ['MIDDLE'] }, 157: { recommendedPositions: ['MIDDLE', 'TOP'] } };
  if (route === '/lol-champ-select/v1/all-grid-champions') return [{ id: 238, positionsFavorited: ['MIDDLE'] }];
  if (route === '/lol-game-data/assets/v1/champion-summary.json') return [{ id: -1, name: 'None', alias: 'None' }, { id: 103, name: 'Ahri', alias: 'Ahri' }, { id: 64, name: 'Lee Sin', alias: 'LeeSin' }, { id: 266, name: 'Aatrox', alias: 'Aatrox' }, { id: 238, name: 'Zed', alias: 'Zed' }, { id: 157, name: 'Yasuo', alias: 'Yasuo' }];
  if (route === '/lol-game-data/assets/v1/summoner-spells.json') return [
    { id: 4, name: 'Flash', gameModes: ['CLASSIC'], iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_flash.png' },
    { id: 14, name: 'Ignite', gameModes: ['CLASSIC'], iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/SummonerIgnite.png' },
    { id: 6, name: 'Ghost', gameModes: ['CLASSIC'], iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_haste.png' },
    { id: 32, name: 'Mark', gameModes: ['ARAM'], iconPath: '/lol-game-data/assets/DATA/Spells/Icons2D/Summoner_Mark.png' }];
  if (route === '/lol-gameflow/v1/session') return { gameData: { queue: { gameMode: 'CLASSIC' } } };
  if (route === '/lol-perks/v1/styles') return RUNE_STYLES;
  if (route === '/lol-perks/v1/perks') return RUNE_PERKS;
  if (route === '/lol-perks/v1/inventory') return { canAddCustomPage: false, ownedPageCount: 2 };
  if (route === '/lol-perks/v1/pages') return runePages;
  if (route === '/lol-perks/v1/recommended-pages/champion/103/position/middle/map/11') return [{ keystone: { id: 8112 }, primaryPerkStyleId: 8100, secondaryPerkStyleId: 8000,
    perks: [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001].map(id => ({ id })), summonerSpellIds: [14, 4] }];
  if (route === '/lol-perks/v1/currentpage') { assert.equal(method, 'PUT'); runePages = runePages.map(page => ({ ...page, current: page.id === body })); return null; }
  const runePage = route.match(/^\/lol-perks\/v1\/pages\/(\d+)$/);
  if (runePage) { assert.equal(method, 'PUT'); runePages = runePages.map(page => page.id === Number(runePage[1]) ? { ...page, ...body } : page); return null; }
  if (route.startsWith('/lol-game-data/assets/v1/perk-images/')) return iconBytes;
  if (route.startsWith('/lol-game-data/assets/v1/champion-icons/') || route.startsWith('/lol-game-data/assets/DATA/')) return iconBytes;
  const csAction = route.match(/^\/lol-champ-select\/v1\/session\/actions\/(\d+)(\/complete)?$/);
  if (csAction) {
    const act = csSession.actions.flat().find(item => item.id === Number(csAction[1]));
    const me = csSession.myTeam.find(player => player.cellId === csSession.localPlayerCellId);
    if (csAction[2]) { assert.equal(method, 'POST'); act.completed = true; act.isInProgress = false; if (act.type === 'pick') me.championId = act.championId; }
    else {
      assert.equal(method, 'PATCH'); act.championId = body.championId;
      if (body.completed) { act.completed = true; act.isInProgress = false; if (act.type === 'pick') me.championId = act.championId; }
      else if (act.type === 'pick') me.championPickIntent = body.championId;
    }
    return null;
  }
  if (route === '/lol-champ-select/v1/session/my-selection/reroll') { assert.equal(method, 'POST'); Object.assign(csSession, { rerollsRemaining: 0 }); csSession.myTeam[1].championId = 238; return null; }
  const bench = route.match(/^\/lol-champ-select\/v1\/session\/bench\/swap\/(\d+)$/);
  if (bench) { assert.equal(method, 'POST'); const me = csSession.myTeam[1]; csSession.benchChampions = [{ championId: me.championId }]; me.championId = Number(bench[1]); return null; }
  const swap = route.match(/^\/lol-champ-select\/v1\/session\/champion-swaps\/(\d+)\/(accept|decline)$/);
  if (swap) { assert.equal(method, 'POST'); csSession.trades = csSession.trades.map(t => t.id === Number(swap[1]) ? { ...t, state: swap[2] === 'accept' ? 'ACCEPTED' : 'DECLINED' } : t); return null; }
  if (route === '/lol-champ-select/v1/session/my-selection') { assert.equal(method, 'PATCH'); Object.assign(csSession.myTeam.find(player => player.cellId === 2), body); return null; }
  if (route === '/process-control/v1/process/quit') { assert.equal(method, 'POST'); return null; }
  if (route === '/lol-lobby/v2/lobby/subteamData') {
    assert.equal(method, 'PUT');
    Object.assign(lobby.localMember, { subteamIndex: body.subteamIndex, intraSubteamPosition: body.intraSubteamPosition });
    return null;
  }
  const answer = route.match(/^\/lol-lobby\/v2\/received-invitations\/([\w-]+)\/(accept|decline)$/);
  if (answer) {
    assert.equal(method, 'POST');
    received = received.filter(invitation => invitation.invitationId !== answer[1]);
    return null;
  }
  throw new Error(`Unexpected test route: ${method} ${route}`);
};
require('../electron/main.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timeout: ${expression}`);
}
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  // Captures fiables même si la fenêtre de test est recouverte : pas de mise en pause du rendu.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message, line, source) => { if (level >= 3) console.error('[page]', message, source, line); });
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await waitFor(win, `document.querySelector('#play').textContent === 'Lancer'`);
  assert.equal(win.isAlwaysOnTop(), false);
   assert.deepEqual(win.getSize(), [300, 230]);
   assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight'), false);
  const emptySlot = `document.querySelector('#duo-portrait').hidden && document.querySelector('#duo-roles').hidden && !document.querySelector('#add-friend').hidden`;
  const loadedDuo = `!document.querySelector('#duo-portrait').hidden && document.querySelector('#add-friend').hidden && !document.querySelector('#duo-avatar').hidden && document.querySelector('#duo-avatar').naturalWidth > 0`;
  assert.equal(await win.webContents.executeJavaScript(emptySlot), true);
  const slotTop = await win.webContents.executeJavaScript(`document.querySelector('#add-friend').getBoundingClientRect().top`);
  fs.writeFileSync(path.join(qa, 'widget.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  lobby = { localMember: { summonerId: 99 }, members: [{ summonerId: '99', summonerIconId: 8 }] };
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(emptySlot), true);
  await win.webContents.executeJavaScript(`document.querySelector('#add-friend').click()`);
  const friend = { summonerId: 42, summonerName: 'Partenaire', summonerIconId: 0, summonerLevel: 100,
    firstPositionPreference: 'BOTTOM', secondPositionPreference: 'UTILITY', unrelated: 'not-forwarded' };
  lobby.members.unshift(friend);
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, loadedDuo);
  assert.deepEqual(await win.webContents.executeJavaScript(`window.league.getStatus().then(status => status.duoPartner)`),
    { summonerId: 42, displayName: 'Partenaire', profileIconId: 0, summonerLevel: 100, firstPreference: 'BOTTOM', secondPreference: 'UTILITY' });
  await waitFor(win, `!document.querySelector('#duo-roles').hidden && Array.from(document.querySelectorAll('#duo-roles img')).every(image => image.complete && image.naturalWidth > 0)`);
  assert.deepEqual(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#duo-roles img')).map(image => image.getAttribute('src'))`),
    ['assets/roles/bottom.png', 'assets/roles/utility.png']);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#duo-primary-role').getBoundingClientRect().top === document.querySelector('#primary-role').getBoundingClientRect().top`), true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#duo-roles button').length`), 0);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#duo-portrait').getBoundingClientRect().top`), slotTop);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#invitations').hidden`), true);
  assert.deepEqual(win.getSize(), [300, 230]);
  await sleep(400); fs.writeFileSync(path.join(qa, 'duo.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(calls.filter(c => c.route.endsWith('/profile-icons/0.jpg')).length, 1);
  friend.firstPositionPreference = 'FILL'; friend.secondPositionPreference = 'UNSELECTED';
  await win.webContents.executeJavaScript('refresh()');
  assert.deepEqual(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#duo-roles img')).map(image => image.getAttribute('src'))`),
    ['assets/roles/fill.png', 'assets/roles/unselected.png']);
  friend.firstPositionPreference = undefined; friend.secondPositionPreference = 'UNKNOWN';
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#duo-roles img')).every(image => image.getAttribute('src') === 'assets/roles/unselected.png')`), true);
  lobby = null;
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(emptySlot), true);
  lobby = { members: [friend] };
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, loadedDuo);
  // La PP du partenaire suit le chat : lobby périmé (icône 0) + chat à jour (icône 1) → icône 1 affichée.
  let diag = '';
  chatIcon = 1;
  for (let i = 0; i < 40 && !calls.some(c => c.route.endsWith('/profile-icons/1.jpg')); i++) {
    await sleep(100);
    if (i === 39) diag = JSON.stringify({ duoPartner: await win.webContents.executeJavaScript('state.duoPartner'), recent: calls.slice(-8).map(c => c.method + ' ' + c.route) });
  }
  assert.equal(calls.some(c => c.route.endsWith('/profile-icons/1.jpg')), true, diag);
  await waitFor(win, loadedDuo);
  assert.equal(await win.webContents.executeJavaScript(`window.league.getStatus().then(status => status.duoPartner.profileIconId)`), 1);
  // Changement de PP pendant que le lobby reste périmé : seul le chat pousse la nouvelle (icône 5).
  chatIcon = 5; partnerIcon = 4;
  for (let i = 0; i < 40 && !calls.some(c => c.route.endsWith('/profile-icons/5.jpg')); i++) {
    await sleep(100);
    if (i === 39) diag = JSON.stringify({ duoPartner: await win.webContents.executeJavaScript('state.duoPartner'), recent: calls.slice(-8).map(c => c.method + ' ' + c.route) });
  }
  assert.equal(calls.some(c => c.route.endsWith('/profile-icons/5.jpg')), true, diag);
  await waitFor(win, `document.querySelector('#duo-avatar').getAttribute('src')?.includes('base64') && document.querySelector('#duo-avatar').naturalWidth > 0`);
  // Sans présence chat : secours summoner uniquement si l'icône lobby est absente.
  const summonerCalls = () => calls.filter(c => c.route.startsWith('/lol-summoner/v1/summoners/')).length;
  const noSummonerCall = summonerCalls();
  delete friend.summonerIconId; partnerInChat = false; partnerIcon = 6;
  for (let i = 0; i < 40 && summonerCalls() === noSummonerCall; i++) await sleep(100);
  assert.notEqual(summonerCalls(), noSummonerCall);
  await waitFor(win, loadedDuo);
  partnerInChat = true; chatIcon = 5; friend.summonerIconId = 1;
  // Échec de téléchargement : repli sur le placeholder puis réessai.
  chatIcon = 4; failIcon = true;
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, `document.querySelector('#duo-avatar').hidden && !document.querySelector('#duo-avatar-fallback').hidden`);
  failIcon = false;
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, loadedDuo);
  // Réponse en retard d'un cycle antérieur : ignorée après le départ du partenaire.
  chatIcon = 2;
  await win.webContents.executeJavaScript('refresh()');
  for (let i = 0; i < 30 && !releaseIcon; i++) await sleep(100);
  assert.ok(releaseIcon);
  lobby = null;
  await win.webContents.executeJavaScript('refresh()');
  releaseIcon(); await sleep(100);
  assert.equal(await win.webContents.executeJavaScript(`${emptySlot} && document.querySelector('#duo-avatar').hidden`), true);
  // Kick: caché pour un non-chef, refus backend, dialogue annulé puis succès.
  lobby = { gameConfig: { queueId: 420 }, localMember: { summonerId: 99, isLeader: false }, members: [friend] };
  searching = false; phase = 'Lobby';
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#kick-friend').hidden`), true);
  assert.equal(await win.webContents.executeJavaScript(`window.league.kickMember(42).then(()=>false,()=>true)`), true);
  assert.deepEqual(kicks, []);
  lobby.localMember.isLeader = true;
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, `!document.querySelector('#kick-friend').hidden && !document.querySelector('#kick-friend').disabled`);
  let dialogResult = { response: 0 };
  dialog.showMessageBox = async () => dialogResult;
  await win.webContents.executeJavaScript(`document.querySelector('#kick-friend').click()`);
  await sleep(400);
  assert.deepEqual(kicks, []);
  dialogResult = { response: 1 };
  await win.webContents.executeJavaScript(`document.querySelector('#kick-friend').click()`);
  await waitFor(win, `document.querySelector('#feedback').textContent === 'Joueur exclu du lobby'`);
  assert.deepEqual(kicks, [42]);
  await waitFor(win, `${emptySlot} && !document.querySelector('#play').disabled`);
  allowKick = false; searching = true;
  assert.equal(await win.webContents.executeJavaScript(`window.league.kickMember(42).then(()=>false,()=>true)`), true);
  assert.deepEqual(kicks, [42]);
  searching = false; lobby = null;
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, `document.querySelector('#play').textContent === 'Lancer' && ${emptySlot}`);
  // No roles selected: open the picker instead of creating a lobby/search.
  await win.webContents.executeJavaScript(`document.querySelector('#play').click()`);
  await waitFor(win, `!document.querySelector('#roles-panel').hidden && !document.querySelector('[data-role="MIDDLE"]').disabled`);
  assert.equal(lobby, null);
   assert.deepEqual(win.getSize(), [300, 230]);
   await win.webContents.executeJavaScript(`document.querySelector('[data-role="MIDDLE"]').click()`);
  await waitFor(win, `document.querySelector('#role-picker-title').textContent === 'Rôle secondaire' && !document.querySelector('[data-role="JUNGLE"]').disabled`);
  await sleep(400); fs.writeFileSync(path.join(qa, 'roles.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('[data-role="JUNGLE"]').click()`);
  await waitFor(win, `document.querySelector('#roles-panel').hidden && !document.querySelector('#play').disabled`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'roles.json'), 'utf8')), { firstPreference: 'MIDDLE', secondPreference: 'JUNGLE' });
  assert.equal(calls.some(c => c.route.endsWith('/position-preferences')), false); // Saving before a lobby only persists.
  const duplicate = await win.webContents.executeJavaScript(`window.league.saveRoles({firstPreference:'TOP', secondPreference:'TOP'}).then(()=>false,()=>true)`);
  assert.equal(duplicate, true);
  await win.webContents.reload();
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await waitFor(win, `document.querySelector('#play').textContent === 'Lancer'`);
  await win.webContents.executeJavaScript(`document.querySelector('#primary-role').click()`);
  await waitFor(win, `!document.querySelector('#roles-panel').hidden`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-role="MIDDLE"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.role-option img')).every(i=>i.complete && i.naturalWidth>0)`), true);
  await win.webContents.executeJavaScript(`document.querySelector('#add-friend').click()`);
  await waitFor(win, `document.querySelectorAll('.friend-item').length === 12`);
   assert.deepEqual(win.getSize(), [300, 230]);
   await sleep(400); fs.writeFileSync(path.join(qa, 'invitations.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.friend-item button').click()`);
  await waitFor(win, `document.querySelector('#feedback').textContent === 'Invitation envoyée' && !document.querySelector('#play').disabled`);
  assert.equal(calls.filter(c => c.route === '/lol-lobby/v2/lobby' && c.method === 'POST').length, 1);
  assert.ok(calls.some(c => c.route.endsWith('/invitations') && c.body[0].toSummonerId === 1));
  await win.webContents.executeJavaScript(`document.querySelector('#friend-name').value='Joueur#EUW'; document.querySelector('#invite-form').requestSubmit()`);
  await waitFor(win, `document.querySelector('#friend-name').value === '' && !document.querySelector('#play').disabled`);
  assert.ok(calls.some(c => c.route === '/lol-summoner/v1/summoners?name=Joueur%23EUW'));
  await win.webContents.executeJavaScript(`document.querySelector('#add-friend').click(); document.querySelector('#play').click()`);
  await waitFor(win, `document.querySelector('#play').textContent === 'Annuler'`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#primary-role').disabled`), true);
  const startIndex = calls.findIndex(c => c.route.endsWith('/matchmaking/search') && c.method === 'POST');
  const positionCall = calls.slice(0, startIndex).findLast(c=>c.route.endsWith('/position-preferences'));
  assert.deepEqual(positionCall.body, { firstPreference: 'MIDDLE', secondPreference: 'JUNGLE' });
  assert.equal(calls[startIndex - 1].route, '/lol-lobby/v2/lobby'); // Read-back confirms server roles before queuing.
  fs.writeFileSync(path.join(qa, 'searching.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  assert.equal(calls.filter(c => c.route === '/lol-lobby/v2/lobby' && c.method === 'POST').length, 1);
  await win.webContents.executeJavaScript(`document.querySelector('#play').click()`);
  await waitFor(win, `document.querySelector('#play').textContent === 'Lancer'`);
  assert.equal(calls.filter(c => c.method === 'DELETE' && c.route.endsWith('/matchmaking/search')).length, 1);
  staleSearchReads = 0;
  // Fill needs no secondary role; save applies to an existing ranked lobby.
  await win.webContents.executeJavaScript(`document.querySelector('#primary-role').click()`);
  await waitFor(win, `!document.querySelector('#roles-panel').hidden`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-role="FILL"]').click()`);
  await waitFor(win, `document.querySelector('#roles-panel').hidden && !document.querySelector('#play').disabled`);
  assert.deepEqual(lobby.localMember, { firstPositionPreference: 'FILL', secondPositionPreference: 'UNSELECTED' });
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#secondary-role').disabled`), true);
  failedSearch = true;
  await win.webContents.executeJavaScript(`document.querySelector('#play').click()`);
  await waitFor(win, `document.querySelector('#feedback').classList.contains('error') && !document.querySelector('#play').disabled`);
  // An external search is detected even if gameflow still says Lobby.
  failedSearch = false; searching = true;
  await win.webContents.executeJavaScript('refresh()');
  await waitFor(win, `document.querySelector('#play').textContent === 'Annuler'`);
  const blockedRoles = await win.webContents.executeJavaScript(`window.league.saveRoles({firstPreference:'TOP',secondPreference:'MIDDLE'}).then(()=>false,()=>true)`);
  assert.equal(blockedRoles, true);
  await waitFor(win, `!document.querySelector('#queue-timer').hidden && document.querySelector('#queue-timer').textContent.startsWith('1:')`);
  const oldTimer = await win.webContents.executeJavaScript(`document.querySelector('#queue-timer').textContent`);
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (await win.webContents.executeJavaScript(`document.querySelector('#queue-timer').textContent`) !== oldTimer) break;
  }
  assert.notEqual(await win.webContents.executeJavaScript(`document.querySelector('#queue-timer').textContent`), oldTimer);
  assert.ok((await win.webContents.executeJavaScript(`document.querySelector('#feedback').textContent`)).includes('1:35'));
  fs.writeFileSync(path.join(qa, 'searching.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  phase = 'ReadyCheck'; ready = { state: 'InProgress', playerResponse: 'None', timer: 2 };
  await waitFor(win, `document.querySelector('#play').textContent === 'Accepter la partie' && !document.querySelector('#play').disabled`);
  const popup = BrowserWindow.getAllWindows().find(w => w !== win);
  assert.ok(popup); assert.equal(popup.isAlwaysOnTop(), true);
  if (popup.webContents.isLoading()) await new Promise(resolve => popup.webContents.once('did-finish-load', resolve));
  await waitFor(popup, `Number(document.querySelector('#countdown').textContent) > 0`);
  const countdown = Number(await popup.webContents.executeJavaScript(`document.querySelector('#countdown').textContent`));
  fs.writeFileSync(path.join(qa, 'ready.png'), (await popup.webContents.capturePage()).toPNG());
  await sleep(1100);
  assert.ok(Number(await popup.webContents.executeJavaScript(`document.querySelector('#countdown').textContent`)) < countdown);
  failAccept = true;
  await popup.webContents.executeJavaScript(`document.querySelector('#accept').click()`);
  await waitFor(popup, `document.querySelector('#ready-feedback').textContent === 'Acceptation indisponible' && !document.querySelector('#accept').disabled`);
  failAccept = false;
  await popup.webContents.executeJavaScript(`document.querySelector('#accept').click()`);
  await waitFor(popup, `document.querySelector('#countdown').textContent === '✓' && document.querySelector('#accept').disabled`);
  await waitFor(win, `document.querySelector('#play').textContent === 'En attente des joueurs'`);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#play').disabled`), true);
  assert.equal(calls.filter(c => c.route === '/riotclient/launch-ux').length, 0);
  fs.writeFileSync(path.join(qa, 'accepted.png'), (await popup.webContents.capturePage()).toPNG());
  phase = 'ChampSelect'; ready = { state: 'Invalid' };
  await waitFor(win, `document.querySelector('#play').textContent === 'Choisir mon champion' && !document.querySelector('#play').disabled`);
  // Sans session lisible, l'ancien bouton reste ; le client ne s'ouvre plus tout seul (Ward gère la sélection).
  await sleep(1600);
  assert.ok(popup.isDestroyed());
  assert.equal(calls.filter(c => c.route === '/riotclient/launch-ux').length, 0);
  assert.equal(calls.filter(c => c.route === '/riotclient/ux-show').length, 0);
  await win.webContents.executeJavaScript(`document.querySelector('#play').click()`);
  await waitFor(win, `!document.querySelector('#play').disabled`);
  assert.equal(calls.filter(c => c.route === '/riotclient/ux-show').length, 1);
  // Sélection des champions dans le widget.
  const run = code => win.webContents.executeJavaScript(code).catch(error => { console.error(`Échec dans la page : ${code.slice(0, 140)}`); throw error; });
  csSession = csSessionFor();
  await run('refresh()');
  await waitFor(win, `!document.querySelector('#champ-select').hidden && document.querySelectorAll('.cs-champ').length === 4`); // Yasuo n'est pas jouable : absent de la grille.
  for (let i = 0; i < 20 && win.getSize()[0] !== 640; i++) await sleep(100);
  assert.deepEqual(win.getSize(), [640, 480]);
  await waitFor(win, `[...document.querySelectorAll('.cs-champ img')].every(img => !img.hidden && img.naturalWidth > 0) && [...document.querySelectorAll('.cs-spell img')].length === 2`); // Icônes chargées.
  assert.deepEqual(await run(`[...document.querySelectorAll('.allies .cs-player b')].map(n => n.textContent)`), ['Aerith', 'Invocateur 2', 'Toi']);
  assert.equal(await run(`document.querySelector('.allies .cs-player.local').classList.contains('acting')`), true);
  assert.equal(await run(`document.querySelector('.cs-champ').dataset.id`), '238'); // Favori du poste en premier.
  assert.equal(await run(`document.querySelector('#feedback').textContent`), 'À toi de choisir');
  assert.equal(await run(`/^\\d+ s$/.test(document.querySelector('#queue-timer').textContent) && !document.querySelector('#queue-timer').hidden`), true);
  await run(`document.querySelector('[data-cs-role="JUNGLE"]').click()`);
  await waitFor(win, `[...document.querySelectorAll('.cs-champ')].map(n => n.getAttribute('aria-label')).join() === 'Lee Sin'`);
  await run(`{ document.querySelector('[data-cs-role="ALL"]').click(); const search = document.querySelector('#cs-search'); search.value = 'ah'; search.dispatchEvent(new Event('input')); }`);
  await waitFor(win, `[...document.querySelectorAll('.cs-champ')].map(n => n.getAttribute('aria-label')).join() === 'Ahri'`);
  await run(`document.querySelector('.cs-champ[data-id="103"]').click()`);
  await waitFor(win, `document.querySelector('#cs-action').textContent === 'Verrouiller Ahri' && !document.querySelector('#cs-action').disabled`);
  assert.deepEqual(calls.filter(c => c.method === 'PATCH' && c.route === '/lol-champ-select/v1/session/actions/4').map(c => c.body), [{ championId: 103 }]); // Survol sans verrouiller.
  await run(`{ const search = document.querySelector('#cs-search'); search.value = ''; search.dispatchEvent(new Event('input')); }`);
  await sleep(400); fs.writeFileSync(path.join(qa, 'champ-select.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await run(`document.querySelector('#cs-spell1').click()`);
  await waitFor(win, `!document.querySelector('#spells-panel').hidden && document.querySelectorAll('.spell-option').length === 3`);
  await run(`[...document.querySelectorAll('.spell-option')].find(o => o.title === 'Ghost').click()`);
  await waitFor(win, `document.querySelector('#spells-panel').hidden`);
  assert.deepEqual(calls.filter(c => c.route === '/lol-champ-select/v1/session/my-selection').map(c => c.body), [{ spell1Id: 6, spell2Id: 14 }]);
  // Runes : pages, page Riot non modifiable, recommandation pour Ahri au mid, enregistrement + sorts conseillés.
  await waitFor(win, `document.querySelector('#cs-runes').textContent === 'Ma page'`);
  await run(`document.querySelector('#cs-runes').click()`);
  await waitFor(win, `!document.querySelector('#runes-panel').hidden && document.querySelectorAll('.rune-page').length === 2 && document.querySelectorAll('.rune-reco').length === 1`);
  assert.equal(await run(`document.querySelector('#rune-recos .rune-label').textContent`), 'Recommandées · Ahri Mid');
  assert.equal(await run(`document.querySelectorAll('.rune-perk.keystone').length`), 4);
  assert.equal(await run(`document.querySelector('.rune-perk.keystone[aria-pressed="true"]') !== null && !document.querySelector('#rune-save').disabled`), true);
  await run(`[...document.querySelectorAll('.rune-page')].find(chip => chip.textContent === 'Page Riot').click()`);
  await waitFor(win, `document.querySelector('#runes-sub').textContent === 'Page non modifiable' && document.querySelector('#rune-save').disabled`);
  assert.deepEqual(calls.filter(c => c.route === '/lol-perks/v1/currentpage').map(c => c.body), [12]);
  await run(`[...document.querySelectorAll('.rune-page')].find(chip => chip.textContent === 'Ma page').click()`);
  await waitFor(win, `document.querySelector('#runes-sub').textContent === 'Page modifiable'`);
  await run(`document.querySelector('.rune-reco').click()`);
  await waitFor(win, `document.querySelector('#rune-name').value === 'Ahri · Mid' && !document.querySelector('#rune-save').disabled`);
  assert.equal(await run(`getComputedStyle(document.querySelector('#runes-panel')).opacity`), '1');
  await sleep(1500); fs.writeFileSync(path.join(qa, 'runes.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await run(`document.querySelector('#rune-save').click()`);
  await waitFor(win, `document.querySelector('#runes-panel').hidden && document.querySelector('#feedback').textContent === 'Runes et sorts appliqués'`);
  const savedPage = calls.filter(c => c.method === 'PUT' && c.route === '/lol-perks/v1/pages/11').at(-1).body;
  assert.deepEqual([savedPage.name, savedPage.primaryStyleId, savedPage.subStyleId, savedPage.selectedPerkIds], ['Ahri · Mid', 8100, 8000, [8112, 8139, 8140, 8106, 9111, 8014, 5005, 5008, 5001]]);
  assert.deepEqual(calls.filter(c => c.route === '/lol-champ-select/v1/session/my-selection').at(-1).body, { spell1Id: 14, spell2Id: 4 });
  await waitFor(win, `document.querySelector('#cs-runes').textContent === 'Ahri · Mid'`);
  await run(`document.querySelector('#cs-action').click()`);
  await waitFor(win, `document.querySelector('#cs-action').textContent === 'Ahri verrouillé' && document.querySelector('#cs-action').disabled`);
  assert.deepEqual(calls.filter(c => c.method === 'PATCH' && c.route === '/lol-champ-select/v1/session/actions/4').at(-1).body, { championId: 103, completed: true });
  assert.equal(calls.some(c => c.route.endsWith('/complete')), false);
  // Phase de bannissement.
  csSession = csSessionFor({ ban: true });
  await run('refresh()');
  await waitFor(win, `document.querySelector('#cs-action').textContent === 'Choisis un champion à bannir' && champSelectNote(state.champSelect) === 'À toi de bannir'`);
  await run(`document.querySelector('.cs-champ[data-id="238"]').click()`);
  await waitFor(win, `document.querySelector('#cs-action').textContent === 'Bannir Zed' && document.querySelector('#cs-action').classList.contains('ban')`);
  // ARAM : champion attribué, relance, banc ; demande d'échange d'un allié.
  csSession = { queueId: 450, isCustomGame: false, localPlayerCellId: 1, timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 50000, totalTimeInPhase: 60000 },
    myTeam: [{ cellId: 0, gameName: 'Aerith', assignedPosition: '', championId: 266 }, { cellId: 1, gameName: 'Invocateur', assignedPosition: '', championId: 103, spell1Id: 4, spell2Id: 14 }],
    theirTeam: [], bans: { numBans: 0 }, actions: [], allowRerolling: true, rerollsRemaining: 1, benchEnabled: true, benchChampions: [{ championId: 64 }],
    trades: [{ id: 7, cellId: 0, state: 'RECEIVED' }] };
  await run('refresh()');
  await waitFor(win, `!document.querySelector('#cs-aram').hidden && document.querySelector('#cs-grid').hidden && document.querySelector('#cs-aram-name').textContent === 'Ahri' && document.querySelector('#cs-reroll').textContent === 'Relancer (1)'`);
  await waitFor(win, `!document.querySelector('#cs-swap').hidden && document.querySelector('#cs-swap-text').textContent === 'Aerith te propose son champion Aatrox'`);
  await waitFor(win, `document.querySelector('.allies .cs-player small').textContent === 'Aatrox'`);
  await sleep(300); fs.writeFileSync(path.join(qa, 'aram.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await run(`document.querySelector('#cs-reroll').click()`);
  await waitFor(win, `document.querySelector('#cs-aram-name').textContent === 'Zed' && document.querySelector('#cs-reroll').disabled`);
  await run(`document.querySelector('#cs-bench .cs-champ[data-id="64"]').click()`);
  await waitFor(win, `document.querySelector('#cs-aram-name').textContent === 'Lee Sin'`);
  await run(`document.querySelector('#cs-swap-accept').click()`);
  await waitFor(win, `document.querySelector('#cs-swap').hidden`);
  assert.ok(calls.some(c => c.method === 'POST' && c.route === '/lol-champ-select/v1/session/champion-swaps/7/accept'));
  assert.equal(await run(`window.league.answerSwap('champion', 7, true).then(() => false, e => e.message.includes('plus valable'))`), true);
  csSession = null;
  phase = 'GameStart';
  await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#play').textContent`), 'Chargement de la partie');
  phase = 'InProgress'; await win.webContents.executeJavaScript('refresh()');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#play').textContent`), 'Partie en cours');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#play').disabled`), true);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#queue-timer').hidden`), true);
  // The header opener remains accessible outside champion select, including in queue.
  for (const nextPhase of ['None', 'Lobby', 'Matchmaking', 'InProgress']) {
    phase = nextPhase;
    await win.webContents.executeJavaScript('refresh()');
    await waitFor(win, `!document.querySelector('#open-client').disabled`);
    const before = calls.length;
    await win.webContents.executeJavaScript(`document.querySelector('#open-client').click()`);
    await waitFor(win, `!document.querySelector('#open-client').disabled`);
    assert.deepEqual(calls.slice(before).filter(c => c.method !== 'GET').map(c => c.route), ['/riotclient/ux-show']);
    assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#open-client')).webkitAppRegion`), 'no-drag');
  }
  // Invitations reçues : bandeau, refus, acceptation, puis lobby dont on n'est pas chef.
  const js = code => win.webContents.executeJavaScript(code);
  searching = false; phase = 'None';
  received = [{ invitationId: 'inv-1', state: 'Pending', fromSummonerId: 42, gameConfig: { queueId: 440 } },
    { invitationId: 'inv-2', state: 'Pending', fromSummonerId: 42, gameConfig: { queueId: 420 } },
    { invitationId: 'old', state: 'Declined', fromSummonerId: 42, gameConfig: { queueId: 420 } }];
  await js('refresh()');
  await waitFor(win, `!document.querySelector('#invite-toast').hidden && document.querySelector('#invite-name').textContent === 'Partenaire' && document.querySelector('#invite-queue').textContent === 'Flex' && document.querySelector('#invite-more').textContent === '+1' && !document.querySelector('#invite-avatar').hidden`);
  assert.equal(await js(`getComputedStyle(document.querySelector('#invite-accept')).webkitAppRegion`), 'no-drag');
  await sleep(400); fs.writeFileSync(path.join(qa, 'invitation.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  await js(`document.querySelector('#invite-decline').click()`);
  await waitFor(win, `document.querySelector('#feedback').textContent === 'Invitation refusée' && document.querySelector('#invite-queue').textContent === 'Solo / Duo' && document.querySelector('#invite-more').hidden`);
  assert.ok(calls.some(c => c.method === 'POST' && c.route === '/lol-lobby/v2/received-invitations/inv-1/decline'));
  await js(`document.querySelector('#invite-accept').click()`);
  await waitFor(win, `document.querySelector('#invite-toast').hidden && document.querySelector('#feedback').textContent === 'Tu rejoins le lobby de Partenaire'`);
  assert.ok(calls.some(c => c.method === 'POST' && c.route === '/lol-lobby/v2/received-invitations/inv-2/accept'));
  phase = 'Lobby'; lobby = { gameConfig: { queueId: 440 }, localMember: { summonerId: 99, isLeader: false }, members: [friend] };
  await js('refresh()');
  await waitFor(win, `document.querySelector('#play').textContent === 'En attente du chef' && document.querySelector('#play').disabled && document.querySelector('#queue-label').textContent === 'Flex' && document.querySelector('#kick-friend').hidden`);
  searching = true; received = [{ invitationId: 'inv-3', state: 'Pending', fromSummonerId: 42, gameConfig: { queueId: 420 } }];
  assert.equal(await js(`window.league.acceptInvitation('inv-3').then(() => false, () => true)`), true);
  assert.equal(await js(`window.league.acceptInvitation('../lobby').then(() => false, () => true)`), true);
  assert.equal(calls.some(c => c.route.endsWith('/inv-3/accept')), false);
  received = []; lobby = null;

  // Files : menu, Flex (groupe de 5, blocage à 4), ARAM (sans rôles), Arena (équipes), retour Solo/Duo.
  phase = 'None'; searching = false;
  await js('refresh()');
  await waitFor(win, `!document.querySelector('#queue-button').disabled`);
  await js(`document.querySelector('#queue-button').click()`);
  await waitFor(win, `!document.querySelector('#queue-panel').hidden && document.querySelectorAll('.queue-option').length === 5`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.queue-option b')].map(b => b.textContent)`), ['Solo / Duo', 'Flex', 'ARAM', 'Arena', 'Entraînement']);
  assert.equal(await js(`document.querySelector('[data-queue="420"]').getAttribute('aria-pressed')`), 'true');
  await sleep(300); fs.writeFileSync(path.join(qa, 'queues.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  const postsBeforeFlex = calls.filter(c => c.method === 'POST' && c.route === '/lol-lobby/v2/lobby').length;
  await js(`document.querySelector('[data-queue="440"]').click()`);
  await waitFor(win, `document.querySelector('#queue-panel').hidden && document.querySelector('#queue-label').textContent === 'Flex' && document.querySelectorAll('.party-member').length === 4`);
  for (let i = 0; i < 20 && win.getSize()[0] !== 440; i++) await sleep(100);
  assert.deepEqual(win.getSize(), [440, 230]);
  const lobbyPostsBefore = calls.filter(c => c.method === 'POST' && c.route === '/lol-lobby/v2/lobby').length;
  assert.equal(lobbyPostsBefore, postsBeforeFlex); // Sans lobby, le choix est seulement mémorisé.
  const mate = (id, name, first, second) => ({ summonerId: id, summonerName: name, summonerIconId: 0, summonerLevel: 50 + id, firstPositionPreference: first, secondPositionPreference: second });
  lobby = { gameConfig: { ...gameConfigFor(440), premadeSizeAllowed: false }, restrictions: [], localMember: { summonerId: 99, isLeader: true },
    members: [{ summonerId: 99, isLeader: true }, mate(42, 'Partenaire', 'BOTTOM', 'UTILITY'), mate(7, 'Brume', 'TOP', 'JUNGLE'), mate(8, 'Nox', 'MIDDLE', 'FILL')] };
  phase = 'Lobby';
  await js('refresh()');
  await waitFor(win, `document.querySelector('#play').disabled && document.querySelector('#feedback').textContent === 'En Flex, on joue à 1, 2, 3 ou 5 (vous êtes 4)' && document.querySelector('#feedback').classList.contains('error')`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.party-member .player-name')].map(n => n.textContent)`), ['Partenaire', 'Brume', 'Nox']);
  assert.equal(await js(`document.querySelectorAll('.party-member .role-slots').length`), 3);
  assert.equal(await js(`document.querySelectorAll('.party-member .kick-friend').length`), 3);
  assert.equal(await js(`document.querySelectorAll('.party-member .add-friend').length`), 1);
  await sleep(300); fs.writeFileSync(path.join(qa, 'flex.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  // ARAM : le groupe reste, les rôles disparaissent et le widget rapetisse.
  lobby.gameConfig.premadeSizeAllowed = true;
  await js(`document.querySelector('#queue-button').click()`);
  await waitFor(win, `document.querySelectorAll('.queue-option').length === 5`);
  await js(`document.querySelector('[data-queue="450"]').click()`);
  await waitFor(win, `document.querySelector('#queue-label').textContent === 'ARAM' && !document.querySelector('#play').disabled`);
  assert.equal(calls.filter(c => c.method === 'POST' && c.route === '/lol-lobby/v2/lobby').length, lobbyPostsBefore + 1);
  assert.equal(await js(`getComputedStyle(document.querySelector('#profile .role-slots')).display`), 'none');
  for (let i = 0; i < 20 && win.getSize()[1] !== 204; i++) await sleep(100);
  assert.deepEqual(win.getSize(), [440, 204]);
  // Arena : 4 joueurs max en Solo/Duo refusé, équipes de deux, déplacement validé.
  assert.equal(await js(`window.league.selectQueue(420).then(() => false, error => error.message.includes('Trop de joueurs'))`), true);
  lobby = { gameConfig: gameConfigFor(1740), restrictions: [], localMember: { summonerId: 99, isLeader: true, subteamIndex: 1, intraSubteamPosition: 1 },
    members: [{ summonerId: 99, isLeader: true, subteamIndex: 1, intraSubteamPosition: 1 }, { ...mate(42, 'Partenaire'), subteamIndex: 1, intraSubteamPosition: 2 }] };
  await js('refresh()');
  await waitFor(win, `!document.querySelector('#arena-grid').hidden && document.querySelectorAll('.team-chip').length === 1 && document.querySelectorAll('.party-member').length === 2 && document.querySelector('#queue-label').textContent === 'Arena Bravoure'`);
  // Arena Bravoure : équipes de 3 → toi + 2 places en grand, les autres équipes en pastilles.
  assert.deepEqual(await js(`[...document.querySelectorAll('.party-member .player-name')].map(n => n.textContent)`), ['Partenaire']);
  assert.equal(await js(`document.querySelectorAll('.party-member .add-friend').length`), 1);
  assert.equal(await js(`document.querySelector('.team-chip').dataset.team + document.querySelector('.team-chip').className`), '2team-chip new');
  assert.equal(await js(`document.querySelector('#feedback').textContent.startsWith('En Flex')`), false);
  for (let i = 0; i < 20 && win.getSize()[1] !== 262; i++) await sleep(100);
  assert.deepEqual(win.getSize(), [440, 262]);
  await sleep(300); fs.writeFileSync(path.join(qa, 'arena.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  assert.equal(await js(`window.league.switchArenaTeam(1, 2).then(() => false, error => error.message.includes('Cette place est déjà prise.'))`), true);
  assert.equal(await js(`window.league.switchArenaTeam(99, 1).then(() => false, error => error.message.includes('Équipe invalide.'))`), true);
  await js(`document.querySelector('.team-chip').click()`);
  await waitFor(win, `document.querySelector('.team-chip')?.dataset.team === '1' && !document.querySelector('.team-chip').classList.contains('new') && document.querySelectorAll('.party-member .player-name').length === 0`);
  assert.deepEqual(calls.filter(c => c.route === '/lol-lobby/v2/lobby/subteamData').map(c => c.body), [{ subteamIndex: 2, intraSubteamPosition: 1 }]);
  // Retour en Solo/Duo seul : taille d'origine.
  lobby = null; phase = 'None';
  assert.equal((await js(`window.league.selectQueue(420)`)).label, 'Solo / Duo');
  await js('refresh()');
  await waitFor(win, `document.querySelector('#queue-label').textContent === 'Solo / Duo' && !document.querySelector('#duo-slot').hidden`);
  for (let i = 0; i < 20 && win.getSize()[0] !== 300; i++) await sleep(100);
  assert.deepEqual(win.getSize(), [300, 230]);
  // Outil d'entraînement : partie perso, « Lancer » démarre la sélection sans recherche.
  assert.equal((await js(`window.league.selectQueue(3140)`)).label, 'Entraînement');
  await js('refresh()');
  await waitFor(win, `document.querySelector('#queue-label').textContent === 'Entraînement' && document.querySelector('#play').textContent === 'Lancer' && !document.querySelector('#duo-slot').hidden`);
  assert.equal(await js(`getComputedStyle(document.querySelector('#profile .role-slots')).display`), 'none');
  const searchesBefore = calls.filter(c => c.route.endsWith('/matchmaking/search') && c.method === 'POST').length;
  await js(`document.querySelector('#play').click()`);
  await waitFor(win, `document.querySelector('#feedback').textContent === 'Sélection des champions…'`);
  assert.deepEqual(calls.filter(c => c.method === 'POST' && c.route === '/lol-lobby/v2/lobby').at(-1).body,
    { queueId: 3140, isCustom: true, customGameLobby: { lobbyName: 'Ward', configuration: {} } });
  assert.equal(calls.filter(c => c.route === '/lol-lobby/v1/lobby/custom/start-champ-select').length, 1);
  assert.equal(calls.filter(c => c.route.endsWith('/matchmaking/search') && c.method === 'POST').length, searchesBefore);
  lobby = null; phase = 'None';
  await js(`window.league.selectQueue(420)`);
  await js('refresh()');
  await waitFor(win, `document.querySelector('#queue-label').textContent === 'Solo / Duo'`);
  searching = false; phase = 'None'; await win.webContents.executeJavaScript('refresh()');
  fs.writeFileSync(path.join(qa, 'widget-open-client.png'), (await (win.webContents.invalidate(), sleep(120)).then(() => win.webContents.capturePage())).toPNG());
  // ✕ : League en arrière-plan au lobby → fermé proprement avec Ward (via process-control, jamais taskkill).
  const realQuit = app.quit;
  let quitRequested = 0;
  app.quit = () => { quitRequested++; };
  phase = 'Lobby'; searching = false; uxVisible = false;
  await win.webContents.executeJavaScript(`window.league.closeWidget()`);
  assert.equal(quitRequested, 1);
  assert.equal(win.isVisible(), false);
  assert.deepEqual(calls.filter(c => c.route === '/process-control/v1/process/quit').map(c => c.method), ['POST']);
  app.quit = realQuit;
  console.log('PASS: compact UI, duo, roles, queue, ready-check, automatic handoff, received invitations, queues (Flex/ARAM/Arena/Practice Tool), champion select (hover, lock, ban, spells, runes, ARAM, swaps) and manual client opener in lobby/queue/game. No live mutations.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
