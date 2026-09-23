// Sélection des champions : normalise la session du client (/lol-champ-select/v1/session)
// et choisit l'action à viser. Aucune dépendance à Electron : testable seul.

const POSITIONS = { top: 'TOP', jungle: 'JUNGLE', middle: 'MIDDLE', bottom: 'BOTTOM', utility: 'UTILITY' };
// Demandes d'échange : champ de la session → chemin de l'API (nommage du client).
const SWAPS = { champion: ['trades', 'champion-swaps'], pickOrder: ['pickOrderSwaps', 'pick-order-swaps'], position: ['positionSwaps', 'position-swaps'] };

function receivedSwaps(session) {
  return Object.entries(SWAPS).flatMap(([kind, [field]]) => (session?.[field] || [])
    .filter(swap => swap.state === 'RECEIVED').map(swap => ({ kind, id: swap.id, cellId: swap.cellId })));
}

function allActions(session) {
  return (session?.actions || []).flat().filter(Boolean);
}

// Action que le joueur local peut jouer maintenant (ban ou pick en cours), sinon son pick à venir
// (le survol avant son tour sert d'intention, comme dans le client).
function myAction(session) {
  const mine = allActions(session).filter(action => action.actorCellId === session.localPlayerCellId && !action.completed);
  return mine.find(action => action.isInProgress) || mine.find(action => action.type === 'pick') || null;
}

function lockedPick(session, cellId) {
  return allActions(session).find(action => action.actorCellId === cellId && action.type === 'pick' && action.completed)?.championId || 0;
}

function playerName(player, index) {
  if (player.nameVisibilityType === 'HIDDEN' || !(player.gameName || player.playerAlias)) return `Invocateur ${index + 1}`;
  return player.gameName || player.playerAlias;
}

function normalizeSession(session, now = Date.now()) {
  if (!session || !Array.isArray(session.myTeam)) return null;
  const actions = allActions(session);
  const acting = new Set(actions.filter(action => action.isInProgress && !action.completed).map(action => action.actorCellId));
  const current = myAction(session);
  const team = (players, ally) => players.map((player, index) => {
    const locked = lockedPick(session, player.cellId) || (ally ? 0 : player.championId || 0);
    return {
      cellId: player.cellId,
      name: ally ? playerName(player, index) : null,
      position: String(player.assignedPosition || '').toUpperCase(),
      championId: locked || player.championId || 0,
      hoverId: locked ? 0 : player.championPickIntent || 0,
      locked: Boolean(locked),
      acting: acting.has(player.cellId),
      isLocal: player.cellId === session.localPlayerCellId,
      spell1Id: ally ? player.spell1Id : undefined,
      spell2Id: ally ? player.spell2Id : undefined
    };
  });
  const bans = session.bans || {};
  const completedBans = team => actions.filter(action => action.type === 'ban' && action.completed && action.isAllyAction === team && action.championId > 0).map(action => action.championId);
  const me = session.myTeam.find(player => player.cellId === session.localPlayerCellId) || {};
  const timer = session.timer || {};
  return {
    queueId: session.queueId,
    isCustom: Boolean(session.isCustomGame),
    phase: timer.phase || 'BAN_PICK',
    timeLeftMs: Math.max(0, timer.adjustedTimeLeftInPhase || 0),
    totalMs: timer.totalTimeInPhase || 0,
    infinite: Boolean(timer.isInfinite),
    sampledAt: timer.internalNowInEpochMs > 0 ? timer.internalNowInEpochMs : now,
    localCellId: session.localPlayerCellId,
    myTeam: team(session.myTeam, true),
    theirTeam: team(session.theirTeam || [], false),
    bans: {
      mine: (bans.myTeamBans?.length ? bans.myTeamBans : completedBans(true)).filter(id => id > 0),
      theirs: (bans.theirTeamBans?.length ? bans.theirTeamBans : completedBans(false)).filter(id => id > 0),
      count: bans.numBans || 0
    },
    action: current ? { id: current.id, type: current.type, inProgress: Boolean(current.isInProgress), championId: current.championId || 0 } : null,
    locked: Boolean(lockedPick(session, session.localPlayerCellId)),
    position: String(me.assignedPosition || '').toUpperCase(),
    spell1Id: me.spell1Id || 0,
    spell2Id: me.spell2Id || 0,
    allowReroll: Boolean(session.allowRerolling),
    rerollsRemaining: session.rerollsRemaining || 0,
    benchEnabled: Boolean(session.benchEnabled),
    bench: (session.benchChampions || []).map(entry => entry.championId).filter(Boolean),
    swaps: receivedSwaps(session)
  };
}

// Survol : dans l'action en cours (ban ou pick), sinon dans le pick à venir.
function hoverTarget(session, championId, { pickable = [], bannable = [] } = {}) {
  if (!Number.isInteger(championId) || championId <= 0) throw new Error('Champion invalide.');
  const action = myAction(session);
  if (!action) throw new Error('Ce n’est pas à toi de choisir.');
  const allowed = action.type === 'ban' ? bannable : pickable;
  if (allowed.length && !allowed.includes(championId)) {
    throw new Error(action.type === 'ban' ? 'Ce champion ne peut pas être banni.' : 'Ce champion n’est pas disponible.');
  }
  return action;
}

// Verrouillage : seulement une action en cours avec un champion choisi.
function lockTarget(session) {
  const action = myAction(session);
  if (!action?.isInProgress) throw new Error('Attends ton tour pour verrouiller.');
  if (!(action.championId > 0)) throw new Error(action.type === 'ban' ? 'Choisis un champion à bannir.' : 'Choisis un champion.');
  return action;
}

// Sorts : deux sorts différents, autorisés dans le mode de la partie.
function validateSpells(spell1Id, spell2Id, allowed = []) {
  if (![spell1Id, spell2Id].every(id => Number.isInteger(id) && id > 0)) throw new Error('Sort invalide.');
  if (spell1Id === spell2Id) throw new Error('Choisis deux sorts différents.');
  if (allowed.length && ![spell1Id, spell2Id].every(id => allowed.includes(id))) throw new Error('Sort non disponible dans ce mode.');
  return { spell1Id, spell2Id };
}

// Réponse à une demande d'échange : seulement une demande reçue et toujours en attente.
function swapTarget(session, kind, id) {
  if (!SWAPS[kind] || !Number.isInteger(id)) throw new Error('Demande d’échange invalide.');
  if (!receivedSwaps(session).some(swap => swap.kind === kind && swap.id === id)) throw new Error('Cette demande d’échange n’est plus valable.');
  return `/lol-champ-select/v1/session/${SWAPS[kind][1]}/${id}`;
}

// ARAM : relance et banc.
function rerollAllowed(session) {
  if (!session?.allowRerolling || !(session.rerollsRemaining > 0)) throw new Error('Plus de relance disponible.');
}
function benchTarget(session, championId) {
  if (!session?.benchEnabled || !(session.benchChampions || []).some(entry => entry.championId === championId)) throw new Error('Ce champion n’est plus sur le banc.');
  return `/lol-champ-select/v1/session/bench/swap/${championId}`;
}

// Postes d'un champion (clé « recommended-champion-positions »), pour le filtre par rôle.
function championPositions(map, championId) {
  return (map?.[championId]?.recommendedPositions || []).map(position => POSITIONS[String(position).toLowerCase()] || String(position).toUpperCase());
}

module.exports = { normalizeSession, myAction, hoverTarget, lockTarget, validateSpells, championPositions, swapTarget, rerollAllowed, benchTarget };
