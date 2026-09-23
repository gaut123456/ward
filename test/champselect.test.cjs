const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSession, hoverTarget, lockTarget, validateSpells, championPositions, swapTarget, rerollAllowed, benchTarget } = require('../electron/champselect.cjs');

// Session de draft classée simplifiée : bans (1 par joueur) puis picks.
function draft({ myPickInProgress = false, myBanInProgress = false, myPickChampion = 0, myPickCompleted = false } = {}) {
  return {
    queueId: 420, isCustomGame: false, localPlayerCellId: 2,
    timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 27000, totalTimeInPhase: 30000, isInfinite: false },
    myTeam: [
      { cellId: 0, gameName: 'Aerith', nameVisibilityType: 'VISIBLE', assignedPosition: 'top', championId: 266, championPickIntent: 0, spell1Id: 4, spell2Id: 12 },
      { cellId: 1, gameName: '', nameVisibilityType: 'HIDDEN', assignedPosition: 'jungle', championId: 0, championPickIntent: 64, spell1Id: 4, spell2Id: 11 },
      { cellId: 2, gameName: 'gaut', nameVisibilityType: 'VISIBLE', assignedPosition: 'middle', championId: myPickChampion, championPickIntent: myPickChampion ? 0 : 103, spell1Id: 4, spell2Id: 14 }
    ],
    theirTeam: [{ cellId: 5, championId: 0 }, { cellId: 6, championId: 238 }],
    bans: { myTeamBans: [], theirTeamBans: [], numBans: 6 },
    actions: [
      [{ id: 1, actorCellId: 2, type: 'ban', championId: 157, completed: !myBanInProgress, isInProgress: myBanInProgress, isAllyAction: true },
        { id: 2, actorCellId: 6, type: 'ban', championId: 555, completed: true, isInProgress: false, isAllyAction: false }],
      [{ id: 3, actorCellId: 0, type: 'pick', championId: 266, completed: true, isInProgress: false, isAllyAction: true }],
      [{ id: 4, actorCellId: 2, type: 'pick', championId: myPickChampion, completed: myPickCompleted, isInProgress: myPickInProgress, isAllyAction: true }]
    ],
    trades: [{ id: 9, cellId: 0, state: 'RECEIVED' }, { id: 10, cellId: 1, state: 'AVAILABLE' }],
    benchChampions: [], benchEnabled: false, allowRerolling: false, rerollsRemaining: 0
  };
}

test('normalise la session : équipes, noms masqués, verrous, intentions, bans, échanges', () => {
  const state = normalizeSession(draft({ myPickInProgress: true }), 1000);
  assert.equal(state.phase, 'BAN_PICK');
  assert.equal(state.timeLeftMs, 27000);
  assert.equal(state.sampledAt, 1000);
  // Le temps restant est donné à l'instant du client : le chrono décompte depuis cet instant (plus de « 10 s » figé).
  const frozen = { ...draft(), timer: { phase: 'FINALIZATION', adjustedTimeLeftInPhase: 10000, totalTimeInPhase: 10000, internalNowInEpochMs: 5000 } };
  assert.equal(normalizeSession(frozen, 9000).sampledAt, 5000);
  assert.deepEqual(state.myTeam.map(p => [p.name, p.position, p.championId, p.hoverId, p.locked, p.isLocal]),
    [['Aerith', 'TOP', 266, 0, true, false], ['Invocateur 2', 'JUNGLE', 0, 64, false, false], ['gaut', 'MIDDLE', 0, 103, false, true]]);
  assert.equal(state.myTeam[2].acting, true);
  assert.deepEqual(state.bans, { mine: [157], theirs: [555], count: 6 });
  assert.deepEqual(state.action, { id: 4, type: 'pick', inProgress: true, championId: 0 });
  assert.deepEqual(state.swaps, [{ kind: 'champion', id: 9, cellId: 0 }]);
  assert.equal(state.theirTeam[1].championId, 238);
  assert.equal(normalizeSession(null), null);
});

test('survole dans l’action en cours, sinon dans le pick à venir', () => {
  assert.equal(hoverTarget(draft({ myBanInProgress: true }), 238, { bannable: [238] }).id, 1);
  assert.equal(hoverTarget(draft(), 103, { pickable: [103] }).id, 4); // avant son tour : intention
  assert.throws(() => hoverTarget(draft({ myPickInProgress: true }), 999, { pickable: [103] }), /pas disponible/);
  assert.throws(() => hoverTarget(draft({ myBanInProgress: true }), 1, { bannable: [238] }), /ne peut pas être banni/);
  assert.throws(() => hoverTarget(draft({ myPickCompleted: true, myPickChampion: 103 }), 103), /pas à toi/);
  assert.throws(() => hoverTarget(draft(), 0), /invalide/);
});

test('ne verrouille qu’une action en cours avec un champion', () => {
  assert.throws(() => lockTarget(draft()), /Attends ton tour/);
  assert.throws(() => lockTarget(draft({ myPickInProgress: true })), /Choisis un champion/);
  assert.equal(lockTarget(draft({ myPickInProgress: true, myPickChampion: 103 })).id, 4);
  const done = normalizeSession(draft({ myPickCompleted: true, myPickChampion: 103 }));
  assert.equal(done.locked, true);
  assert.equal(done.myTeam[2].championId, 103);
  assert.equal(done.action, null);
});

test('ne répond qu’aux demandes d’échange reçues et en attente', () => {
  const session = { ...draft(), pickOrderSwaps: [{ id: 3, cellId: 1, state: 'RECEIVED' }], positionSwaps: [{ id: 4, cellId: 0, state: 'SENT' }] };
  assert.deepEqual(normalizeSession(session).swaps.map(s => s.kind), ['champion', 'pickOrder']);
  assert.equal(swapTarget(session, 'champion', 9), '/lol-champ-select/v1/session/champion-swaps/9');
  assert.equal(swapTarget(session, 'pickOrder', 3), '/lol-champ-select/v1/session/pick-order-swaps/3');
  assert.throws(() => swapTarget(session, 'position', 4), /plus valable/);
  assert.throws(() => swapTarget(session, 'champion', 10), /plus valable/);
  assert.throws(() => swapTarget(session, 'autre', 9), /invalide/);
});

test('ARAM : relance et banc seulement quand le client les propose', () => {
  const aram = { allowRerolling: true, rerollsRemaining: 1, benchEnabled: true, benchChampions: [{ championId: 22 }] };
  assert.doesNotThrow(() => rerollAllowed(aram));
  assert.throws(() => rerollAllowed({ ...aram, rerollsRemaining: 0 }), /Plus de relance/);
  assert.equal(benchTarget(aram, 22), '/lol-champ-select/v1/session/bench/swap/22');
  assert.throws(() => benchTarget(aram, 23), /plus sur le banc/);
  assert.throws(() => benchTarget({ ...aram, benchEnabled: false }, 22), /plus sur le banc/);
});

test('valide les sorts et lit les postes des champions', () => {
  assert.deepEqual(validateSpells(4, 14, [4, 14, 12]), { spell1Id: 4, spell2Id: 14 });
  assert.throws(() => validateSpells(4, 4), /différents/);
  assert.throws(() => validateSpells(4, 32, [4, 14]), /non disponible/);
  assert.deepEqual(championPositions({ 103: { recommendedPositions: ['MIDDLE', 'UTILITY'] } }, 103), ['MIDDLE', 'UTILITY']);
  assert.deepEqual(championPositions({}, 1), []);
});
