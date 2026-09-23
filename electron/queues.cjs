// Règles des files, lues dans le client (/lol-game-queues/v1/queues) plutôt que
// codées en dur : l'Arena change de numéro et de format selon les saisons.

const LABELS = { 420: 'Solo / Duo', 440: 'Flex', 400: 'Normale', 450: 'ARAM', 2400: 'ARAM Mayhem', 900: 'ARURF', 1900: 'URF' };
const GROUPS = ['kSummonersRift', 'kARAM', 'kAlternativeLeagueGameModes'];
const PINNED = [420, 440, 400];
// Taille des équipes Arena : ni la file ni le lobby ne l'exposent. Table par file
// (Arena classique : 2 ; Arena Bravoure : 3), corrigée par les places observées.
const ARENA_TEAM_SIZES = { 1740: 3 };
const DEFAULT_ARENA_TEAM_SIZE = 2;

const isArena = queue => queue?.gameMode === 'CHERRY';

function arenaTeamSize(queueId, members = []) {
  const observed = Math.max(0, ...members.map(member => Number.isInteger(member?.intraSubteamPosition) ? member.intraSubteamPosition : 0));
  return Math.max(ARENA_TEAM_SIZES[queueId] || DEFAULT_ARENA_TEAM_SIZE, observed);
}

function label(queue) {
  if (!queue) return 'Solo / Duo';
  if (LABELS[queue.id]) return LABELS[queue.id];
  if (isArena(queue)) return /bravery/i.test(queue.name || '') ? 'Arena Bravoure' : 'Arena';
  return queue.shortName || queue.name || `File ${queue.id}`;
}

function premadeSizes(queue) {
  return (queue?.allowablePremadeSizes || []).filter(size => Number.isInteger(size) && size > 0).sort((a, b) => a - b);
}

// Files jouables depuis le widget : PvP ouvertes, hors Swiftplay (champions à
// présélectionner), Clash, tutoriels, TFT et files personnalisées.
function playable(queues, summonerLevel = Infinity) {
  return (Array.isArray(queues) ? queues : [])
    .filter(queue => queue && queue.queueAvailability === 'Available' && queue.isVisible !== false && queue.isEnabled !== false &&
      queue.category === 'PvP' && GROUPS.includes(queue.gameSelectModeGroup) && !queue.isCustom &&
      !queue.showQuickPlaySlotSelection && queue.gameMode !== 'TFT' && !/CLASH|TUTORIAL|PVE|TFT/.test(queue.type || '') &&
      (queue.name || queue.shortName))
    .map(queue => ({
      id: queue.id,
      label: label(queue),
      group: queue.gameSelectModeGroup,
      positions: Boolean(queue.showPositionSelector),
      arena: isArena(queue),
      teamSize: isArena(queue) ? arenaTeamSize(queue.id) : null,
      ranked: Boolean(queue.isRanked),
      maxParty: queue.maximumParticipantListSize || 5,
      premadeSizes: premadeSizes(queue),
      disabled: summonerLevel < (queue.minLevel || 0) ? `Niveau ${queue.minLevel} requis` : null,
      order: [GROUPS.indexOf(queue.gameSelectModeGroup), PINNED.includes(queue.id) ? PINNED.indexOf(queue.id) : 10, -(queue.gameSelectPriority || 0)]
    }))
    .sort((a, b) => {
      const i = a.order.findIndex((value, index) => value !== b.order[index]);
      return i < 0 ? 0 : a.order[i] - b.order[i];
    })
    .map(({ order, ...queue }) => queue);
}

// Disposition du widget selon la file du lobby.
function layoutFor(config) {
  if (isArena({ gameMode: config?.gameMode })) return 'arena';
  return (config?.maxLobbySize || 2) > 2 ? 'party' : 'duo';
}

function joinFr(values) {
  return values.length < 2 ? String(values[0] ?? '') : `${values.slice(0, -1).join(', ')} ou ${values.at(-1)}`;
}

const RESTRICTIONS = {
  TooManyIncompleteSubteamsRestriction: size => `Complète les équipes Arena : ${size} joueurs par équipe`,
  TeamSizeRestriction: () => 'Taille de groupe non autorisée pour cette file',
  TeamMaxSizeRestriction: () => 'Trop de joueurs pour cette file',
  TeamMinSizeRestriction: () => 'Pas assez de joueurs pour cette file',
  TeamDivisionRestriction: () => 'Écart de rang trop grand pour jouer ensemble',
  TeamSkillRestriction: () => 'Écart de niveau trop grand pour jouer ensemble',
  TeamHighMMRMaxSizeRestriction: () => 'À ce rang, le groupe doit être plus petit',
  MmrStandardDeviationTooLarge: () => 'Écart de niveau trop grand dans le groupe',
  FullPartyUnranked: () => 'Un groupe de 5 doit être en Flex',
  PlayerLevelRestriction: () => 'Niveau insuffisant pour cette file',
  PlayerMinLevelRestriction: () => 'Niveau insuffisant pour cette file',
  PlayerAvailableChampionRestriction: () => 'Pas assez de champions pour cette file',
  PlayerTimedRestriction: () => 'Pénalité de file en cours',
  PlayerLeaverQueueLockoutRestriction: () => 'Pénalité de file en cours',
  PlayerLeaverBustedRestriction: () => 'Pénalité de file en cours',
  PlayerDodgeRestriction: () => 'Pénalité d’esquive en cours',
  PlayerReadyCheckFailRestriction: () => 'Pénalité pour partie non acceptée',
  PlayerQueueSuspendedRestriction: () => 'File suspendue pour ce compte',
  PlayerBannedRestriction: () => 'Compte suspendu',
  PlayerRankedSuspensionRestriction: () => 'Classée suspendue pour ce compte',
  PlayerRankSoloOnlyRestriction: () => 'Ce rang ne peut jouer qu’en solo',
  PlayerInGameRestriction: () => 'Un joueur est déjà en partie',
  PrerequisiteQueuesNotPlayedRestriction: () => 'Joue d’abord quelques parties normales',
  MinNormalGamesForRankedRestriction: () => 'Joue d’abord quelques parties normales',
  QueueDisabled: () => 'Cette file est fermée',
  QueueUnsupported: () => 'Cette file n’est pas disponible',
  GameVersionMismatch: () => 'Version du jeu différente dans le groupe'
};

// Motif lisible si League refuse de lancer la recherche dans ce lobby.
function blockReason(lobby, queue) {
  if (!lobby) return null;
  const size = (lobby.members || []).length;
  const sizes = queue?.premadeSizes || premadeSizes(lobby.gameConfig);
  if (lobby.gameConfig?.premadeSizeAllowed === false && sizes.length) {
    return `En ${queue?.label || label({ id: lobby.gameConfig.queueId })}, on joue à ${joinFr(sizes)} (vous êtes ${size})`;
  }
  const restriction = (lobby.restrictions || [])[0];
  const teamSize = queue?.teamSize || arenaTeamSize(lobby.gameConfig?.queueId, lobby.members);
  if (restriction) return (RESTRICTIONS[restriction.restrictionCode] || (() => `League refuse de lancer (${restriction.restrictionCode})`))(teamSize);
  return null;
}

function arenaTeams(maxLobbySize, teamSize = DEFAULT_ARENA_TEAM_SIZE) {
  return Math.max(1, Math.floor((maxLobbySize || teamSize) / teamSize));
}

// Vérifie qu'une place Arena existe et qu'elle est libre (le client accepte n'importe quel index).
function arenaSlotError(lobby, subteamIndex, position) {
  const teamSize = arenaTeamSize(lobby?.gameConfig?.queueId, lobby?.members);
  const teams = arenaTeams(lobby?.gameConfig?.maxLobbySize, teamSize);
  if (!Number.isInteger(subteamIndex) || subteamIndex < 1 || subteamIndex > teams) return 'Équipe invalide.';
  if (!Number.isInteger(position) || position < 1 || position > teamSize) return 'Place invalide.';
  const localId = String(lobby?.localMember?.summonerId);
  const taken = (lobby?.members || []).some(member => String(member.summonerId) !== localId &&
    member.subteamIndex === subteamIndex && member.intraSubteamPosition === position);
  return taken ? 'Cette place est déjà prise.' : null;
}

module.exports = { label, playable, layoutFor, blockReason, arenaTeamSize, arenaTeams, arenaSlotError, isArena, joinFr };
