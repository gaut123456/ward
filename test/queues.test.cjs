const test = require('node:test');
const assert = require('node:assert/strict');
const { playable, blockReason, arenaSlotError, arenaTeams, arenaTeamSize, label } = require('../electron/queues.cjs');

// Extrait réel de /lol-game-queues/v1/queues (client EUW, septembre 2026).
const base = { queueAvailability: 'Available', isVisible: true, isEnabled: true, category: 'PvP', isCustom: false, showQuickPlaySlotSelection: false };
const QUEUES = [
  { ...base, id: 400, name: 'Normal', gameMode: 'CLASSIC', type: 'NORMAL', gameSelectModeGroup: 'kSummonersRift', showPositionSelector: true, maximumParticipantListSize: 5, allowablePremadeSizes: [0, 1, 2, 3, 4, 5], minLevel: 10, gameSelectPriority: 30 },
  { ...base, id: 450, name: 'ARAM', gameMode: 'ARAM', type: 'ARAM_UNRANKED_5x5', gameSelectModeGroup: 'kARAM', showPositionSelector: false, maximumParticipantListSize: 5, allowablePremadeSizes: [0, 1, 2, 3, 4, 5], minLevel: 3, gameSelectPriority: 40 },
  { ...base, id: 480, name: 'Swiftplay', gameMode: 'SWIFTPLAY', type: 'SWIFTPLAY', gameSelectModeGroup: 'kSummonersRift', showQuickPlaySlotSelection: true, maximumParticipantListSize: 5 },
  { ...base, id: 440, name: 'Ranked Flex', gameMode: 'CLASSIC', type: 'RANKED_FLEX_SR', gameSelectModeGroup: 'kSummonersRift', showPositionSelector: true, isRanked: true, maximumParticipantListSize: 5, allowablePremadeSizes: [1, 2, 3, 5], minLevel: 30, gameSelectPriority: 10 },
  { ...base, id: 1740, name: 'Bravery Arena', gameMode: 'CHERRY', type: 'CHERRY', gameSelectModeGroup: 'kAlternativeLeagueGameModes', showPositionSelector: false, maximumParticipantListSize: 18, minLevel: 0 },
  { ...base, id: 700, name: 'Clash', gameMode: 'CLASSIC', type: 'CLASH', gameSelectModeGroup: 'kSummonersRift' },
  { ...base, id: 1090, name: 'Teamfight Tactics (Normal)', gameMode: 'TFT', type: 'NORMAL_TFT', gameSelectModeGroup: 'kTeamfightTactics' },
  { ...base, id: 2000, name: 'Tutorial Part 1', gameMode: 'TUTORIAL_MODULE_1', type: 'TUTORIAL_MODULE_1', gameSelectModeGroup: 'kAlternativeLeagueGameModes' },
  { ...base, id: 4310, name: '', gameMode: 'JADE', type: 'JADE_RANKED_SOLO_5x5', gameSelectModeGroup: 'kJade' },
  { ...base, id: 420, name: 'Ranked Solo/Duo', gameMode: 'CLASSIC', type: 'RANKED_SOLO_5x5', gameSelectModeGroup: 'kSummonersRift', showPositionSelector: true, isRanked: true, maximumParticipantListSize: 2, allowablePremadeSizes: [0, 1, 2], minLevel: 30, gameSelectPriority: 20 },
  { ...base, id: 2400, name: 'ARAM: Mayhem', gameMode: 'KIWI', type: 'KIWI', gameSelectModeGroup: 'kARAM', queueAvailability: 'NotAvailable' }
];

test('ne garde que les files jouables depuis le widget, dans un ordre stable', () => {
  const list = playable(QUEUES, 377);
  assert.deepEqual(list.map(queue => queue.id), [420, 440, 400, 450, 1740]);
  assert.deepEqual(list.map(queue => queue.label), ['Solo / Duo', 'Flex', 'Normale', 'ARAM', 'Arena Bravoure']);
  const arena = list.find(queue => queue.id === 1740);
  assert.equal(arena.arena, true);
  assert.equal(arena.positions, false);
  assert.equal(arena.maxParty, 18);
  assert.equal(arena.teamSize, 3);
  assert.deepEqual(list.find(queue => queue.id === 440).premadeSizes, [1, 2, 3, 5]);
});

test('grise les files interdites par le niveau', () => {
  const list = playable(QUEUES, 12);
  assert.equal(list.find(queue => queue.id === 420).disabled, 'Niveau 30 requis');
  assert.equal(list.find(queue => queue.id === 400).disabled, null);
});

test('explique pourquoi League refuse de lancer', () => {
  const flex = { id: 440, label: 'Flex', premadeSizes: [1, 2, 3, 5] };
  const four = { gameConfig: { queueId: 440, premadeSizeAllowed: false }, members: [{}, {}, {}, {}], restrictions: [] };
  assert.equal(blockReason(four, flex), 'En Flex, on joue à 1, 2, 3 ou 5 (vous êtes 4)');
  assert.equal(blockReason({ gameConfig: { queueId: 1740, premadeSizeAllowed: true }, members: [{}], restrictions: [{ restrictionCode: 'TooManyIncompleteSubteamsRestriction' }] }),
    'Complète les équipes Arena : 3 joueurs par équipe');
  assert.equal(blockReason({ gameConfig: { queueId: 1700 }, members: [{}], restrictions: [{ restrictionCode: 'TooManyIncompleteSubteamsRestriction' }] }),
    'Complète les équipes Arena : 2 joueurs par équipe');
  assert.equal(blockReason({ gameConfig: {}, members: [{}], restrictions: [{ restrictionCode: 'NouveauCode' }] }), 'League refuse de lancer (NouveauCode)');
  assert.equal(blockReason({ gameConfig: { premadeSizeAllowed: true }, members: [{}], restrictions: [], canStartActivity: true }), null);
  assert.equal(blockReason(null), null);
});

test('taille des équipes Arena : table par file, corrigée par les places observées', () => {
  assert.equal(arenaTeamSize(1740), 3);
  assert.equal(arenaTeamSize(1700), 2);
  assert.equal(arenaTeamSize(1700, [{ intraSubteamPosition: 3 }]), 3);
  assert.equal(arenaTeams(18, 3), 6);
  assert.equal(arenaTeams(16), 8);
});

test('valide les places Arena Bravoure (équipes de 3 ; le client accepte n’importe quel index)', () => {
  const lobby = { gameConfig: { queueId: 1740, maxLobbySize: 18 }, localMember: { summonerId: 1 },
    members: [{ summonerId: 1, subteamIndex: 1, intraSubteamPosition: 1 }, { summonerId: 2, subteamIndex: 2, intraSubteamPosition: 1 }] };
  assert.equal(arenaSlotError(lobby, 2, 2), null);
  assert.equal(arenaSlotError(lobby, 2, 3), null);
  assert.equal(arenaSlotError(lobby, 2, 1), 'Cette place est déjà prise.');
  assert.equal(arenaSlotError(lobby, 6, 1), null);
  assert.equal(arenaSlotError(lobby, 7, 1), 'Équipe invalide.');
  assert.equal(arenaSlotError(lobby, 0, 1), 'Équipe invalide.');
  assert.equal(arenaSlotError(lobby, 3, 4), 'Place invalide.');
  assert.equal(arenaSlotError(lobby, '2', 1), 'Équipe invalide.');
});

test('nomme les files inconnues sans planter', () => {
  assert.equal(label({ id: 1700, gameMode: 'CHERRY', name: 'Arena' }), 'Arena');
  assert.equal(label({ id: 9999, shortName: 'Mode test' }), 'Mode test');
  assert.equal(label({ id: 9998 }), 'File 9998');
});
