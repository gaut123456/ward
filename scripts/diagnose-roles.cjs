const { call } = require('../electron/lcu.cjs');
const { applyRoles } = require('../electron/roles.cjs');
(async () => {
  let phase = await call('GET', '/lol-gameflow/v1/gameflow-phase');
  if (phase === 'None' && process.argv.includes('--create')) {
    await call('POST', '/lol-lobby/v2/lobby', { queueId: 420 });
    phase = await call('GET', '/lol-gameflow/v1/gameflow-phase');
  }
  if (phase !== 'Lobby') throw new Error('Diagnostic uniquement dans un lobby au repos.');
  const search = await call('GET', '/lol-lobby/v2/lobby/matchmaking/search-state');
  if (search.searchState === 'Searching') throw new Error('Recherche en cours.');
  const lobby = await call('GET', '/lol-lobby/v2/lobby');
  if (lobby.gameConfig.queueId !== 420) throw new Error('Pas de lobby Solo/Duo.');
  const prefs = { firstPreference: lobby.localMember.firstPositionPreference, secondPreference: lobby.localMember.secondPositionPreference };
  try {
    await call('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', prefs);
    console.log('Same-role PUT succeeded', prefs);
  } catch (error) { console.log('Same-role PUT rejected', { status: error.status, message: error.message, prefs }); }
  const after = await call('GET', '/lol-lobby/v2/lobby');
  console.log('Read-back', { firstPreference: after.localMember.firstPositionPreference, secondPreference: after.localMember.secondPositionPreference });
  const player = await call('GET', '/lol-lobby/v1/parties/player');
  console.log('Party', { locked: player.currentParty?.activityLocked, members: player.currentParty?.players?.length });
  if (process.argv.includes('--verify-change')) {
    const temporary = { firstPreference: prefs.secondPreference, secondPreference: prefs.firstPreference };
    if (!['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'].includes(temporary.firstPreference)) throw new Error('Test de permutation indisponible pour Fill.');
    try { console.log('Verified role change', await applyRoles(temporary)); }
    finally { console.log('Restored original roles', await applyRoles(prefs)); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
