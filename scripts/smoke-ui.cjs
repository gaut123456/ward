const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const lcu = require('../electron/lcu.cjs');
const clientUi = require('../electron/client-ui.cjs');
const realCreateClientUi = clientUi.createClientUi;
clientUi.createClientUi = options => realCreateClientUi({ ...options, inspect: async () => ({ exists: true, hasWindow: true, visible: true }) });
const qa = path.resolve('.qa');
fs.mkdirSync(qa, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(qa, 'electron-')));
const calls = [];
let phase = 'None', lobby = null, failedSearch = false, searching = false, staleSearchReads = 0;
let ready = { state: 'Invalid' }, failAccept = false;
let kicks = [];
let allowKick = true;
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
    if (method === 'POST') { assert.equal(body.queueId, 420); phase = 'Lobby'; return lobby = { gameConfig: { queueId: 420 } }; }
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
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await waitFor(win, `document.querySelector('#play').textContent === 'Lancer'`);
  assert.equal(win.isAlwaysOnTop(), false);
   assert.deepEqual(win.getSize(), [300, 230]);
   assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight'), false);
  const emptySlot = `document.querySelector('#duo-portrait').hidden && document.querySelector('#duo-roles').hidden && !document.querySelector('#add-friend').hidden`;
  const loadedDuo = `!document.querySelector('#duo-portrait').hidden && document.querySelector('#add-friend').hidden && !document.querySelector('#duo-avatar').hidden && document.querySelector('#duo-avatar').naturalWidth > 0`;
  assert.equal(await win.webContents.executeJavaScript(emptySlot), true);
  const slotTop = await win.webContents.executeJavaScript(`document.querySelector('#add-friend').getBoundingClientRect().top`);
  fs.writeFileSync(path.join(qa, 'widget.png'), (await win.webContents.capturePage()).toPNG());
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
  await sleep(400); fs.writeFileSync(path.join(qa, 'duo.png'), (await win.webContents.capturePage()).toPNG());
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
  await sleep(400); fs.writeFileSync(path.join(qa, 'roles.png'), (await win.webContents.capturePage()).toPNG());
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
   await sleep(400); fs.writeFileSync(path.join(qa, 'invitations.png'), (await win.webContents.capturePage()).toPNG());
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
  fs.writeFileSync(path.join(qa, 'searching.png'), (await win.webContents.capturePage()).toPNG());
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
  fs.writeFileSync(path.join(qa, 'searching.png'), (await win.webContents.capturePage()).toPNG());
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
  for (let i = 0; i < 20 && !calls.some(c => c.route === '/riotclient/ux-show'); i++) await sleep(100);
  assert.ok(popup.isDestroyed());
  assert.equal(calls.filter(c => c.route === '/riotclient/launch-ux').length, 0);
  assert.equal(calls.filter(c => c.route === '/riotclient/ux-show').length, 1);
  await sleep(1600);
  assert.equal(calls.filter(c => c.route === '/riotclient/ux-show').length, 1);
  fs.writeFileSync(path.join(qa, 'champ-select.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#play').click()`);
  await waitFor(win, `!document.querySelector('#play').disabled`);
  assert.equal(calls.filter(c => c.route === '/riotclient/ux-show').length, 2);
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
  searching = false; phase = 'None'; await win.webContents.executeJavaScript('refresh()');
  fs.writeFileSync(path.join(qa, 'widget-open-client.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS: compact UI, duo, roles, queue, ready-check, automatic handoff and manual client opener in lobby/queue/game. No live mutations.');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
