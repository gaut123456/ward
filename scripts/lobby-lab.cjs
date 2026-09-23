// Banc d'essai pour tester le client League en vrai (lobbies, parties perso, sélection des champions).
// Refuse d'agir pendant une recherche, une partie ou si d'autres joueurs sont dans le lobby.
//
//   node scripts/lobby-lab.cjs state                 état actuel (lecture seule)
//   node scripts/lobby-lab.cjs queues                files jouables et parties perso disponibles
//   node scripts/lobby-lab.cjs lobby <queueId>       crée un lobby (file classique ou partie perso)
//   node scripts/lobby-lab.cjs champ-select [id]     partie perso (Outil d'entraînement par défaut) → sélection des champions
//   node scripts/lobby-lab.cjs cleanup               annule la sélection perso et supprime le lobby
//
// Recette partie perso (trouvée par essais, client de septembre 2026) :
//   POST /lol-lobby/v2/lobby { queueId, isCustom: true, customGameLobby: { lobbyName, configuration: {} } }
// Le client complète la configuration depuis la file (ex. 3140 Outil d'entraînement, 3100 Faille à l'aveugle,
// 3200 ARAM). Sans queueId : 500 INVALID_LOBBY ; sans customGameLobby : 400 INVALID_REQUEST.
const lcu = require('../electron/lcu.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PRACTICE_TOOL = 3140;

async function snapshot() {
  const [phase, lobby, search] = await Promise.all([
    lcu.call('GET', '/lol-gameflow/v1/gameflow-phase'),
    lcu.call('GET', '/lol-lobby/v2/lobby').catch(error => (error.status === 404 ? null : Promise.reject(error))),
    lcu.call('GET', '/lol-lobby/v2/lobby/matchmaking/search-state').catch(() => null)
  ]);
  return { phase, searching: search?.searchState === 'Searching', lobby };
}

async function assertSafe() {
  const { phase, searching, lobby } = await snapshot();
  if (searching) throw new Error('Recherche en cours : annule-la avant de tester.');
  if (!['None', 'Lobby'].includes(phase) && !(phase === 'ChampSelect' && lobby?.gameConfig?.isCustom)) throw new Error(`Phase ${phase} : rien n'est fait pendant une partie.`);
  if ((lobby?.members?.length || 0) > 1) throw new Error('Des joueurs sont dans ton lobby : rien n’est fait.');
}

async function createLobby(queueId) {
  await assertSafe();
  const queues = await lcu.call('GET', '/lol-game-queues/v1/queues');
  const queue = queues.find(item => item.id === queueId);
  if (!queue) throw new Error(`File ${queueId} inconnue.`);
  const body = queue.isCustom
    ? { queueId, isCustom: true, customGameLobby: { lobbyName: 'Ward test', configuration: {} } }
    : { queueId };
  const lobby = await lcu.call('POST', '/lol-lobby/v2/lobby', body);
  return { queueId: lobby.gameConfig.queueId, gameMode: lobby.gameConfig.gameMode, custom: lobby.gameConfig.isCustom };
}

// Démarre la sélection d'une partie perso, sans jamais verrouiller de champion.
// Leçons (client de septembre 2026) :
//  - après une sélection perso annulée, start-champ-select répond { success: false } pendant ~15 s ;
//  - un démarrage peut passer directement en jeu (InProgress) : on n'appelle alors plus rien et on s'arrête,
//    le jeu d'entraînement est à fermer à la main (le client s'y reconnecte s'il redémarre pendant la partie).
async function champSelect(queueId = PRACTICE_TOOL) {
  await createLobby(queueId);
  const deadline = Date.now() + 30000;
  let started = false;
  while (!started && Date.now() < deadline) {
    await sleep(2000);
    started = (await lcu.call('POST', '/lol-lobby/v1/lobby/custom/start-champ-select')).success === true;
  }
  if (!started) throw new Error('Le client refuse de démarrer la sélection (réessaie dans une minute).');
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const phase = await lcu.call('GET', '/lol-gameflow/v1/gameflow-phase');
    if (['GameStart', 'InProgress'].includes(phase)) {
      throw new Error(`La partie est passée directement en jeu (${phase}) : ferme le jeu d'entraînement, puis lance « cleanup ».`);
    }
    const session = phase === 'ChampSelect' && await lcu.call('GET', '/lol-champ-select/v1/session').catch(() => null);
    if (session) {
      return { timer: session.timer, localPlayerCellId: session.localPlayerCellId,
        actions: session.actions.flat().map(({ id, actorCellId, type, championId, completed, isInProgress }) => ({ id, actorCellId, type, championId, completed, isInProgress })) };
    }
  }
  throw new Error('La sélection des champions n’a pas démarré.');
}

async function cleanup() {
  const { lobby, phase } = await snapshot();
  if ((lobby?.members?.length || 0) > 1) throw new Error('Des joueurs sont dans ton lobby : rien n’est fait.');
  if (['GameStart', 'InProgress', 'Reconnect'].includes(phase)) throw new Error(`Phase ${phase} : une partie est en cours, ferme-la d’abord (rien n’est supprimé).`);
  if (phase === 'ChampSelect' && lobby?.gameConfig?.isCustom) { await lcu.call('POST', '/lol-lobby/v1/lobby/custom/cancel-champ-select'); await sleep(1500); }
  if (!['None', 'Lobby'].includes((await snapshot()).phase)) throw new Error('Une partie est en cours : rien n’est supprimé.');
  await lcu.call('DELETE', '/lol-lobby/v2/lobby').catch(error => { if (error.status !== 404) throw error; });
  await sleep(800);
  // Bug du client : après une sélection perso annulée, il reste « en recherche » sans lobby. Annuler l'efface.
  const stale = await snapshot();
  if (stale.searching && !stale.lobby && stale.phase === 'None') await lcu.call('DELETE', '/lol-matchmaking/v1/search').catch(() => {});
  await sleep(800);
  const after = await snapshot();
  return { phase: after.phase, lobby: Boolean(after.lobby), searching: after.searching };
}

const commands = {
  async state() {
    const { phase, searching, lobby } = await snapshot();
    return { phase, searching, lobby: lobby && { queueId: lobby.gameConfig.queueId, gameMode: lobby.gameConfig.gameMode, custom: lobby.gameConfig.isCustom, members: lobby.members.length } };
  },
  async queues() {
    const queues = await lcu.call('GET', '/lol-game-queues/v1/queues');
    return queues.filter(queue => queue.queueAvailability === 'Available' && (queue.isCustom || queue.category === 'PvP'))
      .map(queue => `${queue.id}\t${queue.isCustom ? 'perso' : 'file'}\t${queue.gameMode}\t${queue.name}`).join('\n');
  },
  lobby: id => createLobby(Number(id)),
  'champ-select': id => champSelect(id ? Number(id) : PRACTICE_TOOL),
  cleanup
};

const [command, argument] = process.argv.slice(2);
if (!commands[command]) {
  console.log('Commandes : state | queues | lobby <queueId> | champ-select [queueId] | cleanup');
  process.exitCode = 1;
} else {
  commands[command](argument)
    .then(result => console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)))
    .catch(error => { console.error(`Erreur : ${error.message}`); process.exitCode = 1; });
}
