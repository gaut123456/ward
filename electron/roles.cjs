const lcu = require('./lcu.cjs');
const endpoint = '/lol-lobby/v2/lobby/members/localMember/position-preferences';
const roleNames = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'FILL']);

function validateRoles(value) {
  if (!roleNames.has(value?.firstPreference)) throw new Error('Choisis ton rôle principal.');
  if (value.firstPreference === 'FILL') return { firstPreference: 'FILL', secondPreference: 'UNSELECTED' };
  if (!roleNames.has(value.secondPreference)) throw new Error('Choisis ton rôle secondaire.');
  if (value.firstPreference === value.secondPreference) throw new Error('Choisis deux rôles différents.');
  return { firstPreference: value.firstPreference, secondPreference: value.secondPreference };
}

async function applyRoles(value) {
  const preferences = validateRoles(value);
  let recovered = false;
  try { await lcu.call('PUT', endpoint, preferences); }
  catch (error) {
    if (error.status !== 400 || !/INVALID_REQUEST/.test(error.message)) throw error;
    // A stale party may be locked server-side despite an idle local lobby. Do
    // not treat the old cached role values as proof that this request succeeded.
    const [phase, search, ready, player, lobby, invitations] = await Promise.all([
      lcu.call('GET', '/lol-gameflow/v1/gameflow-phase'),
      lcu.call('GET', '/lol-matchmaking/v1/search').catch(e => { if (e.status === 404) return null; throw e; }),
      lcu.call('GET', '/lol-matchmaking/v1/ready-check').catch(e => { if (e.status === 404) return null; throw e; }),
      lcu.call('GET', '/lol-lobby/v1/parties/player'),
      lcu.call('GET', '/lol-lobby/v2/lobby'),
      lcu.call('GET', '/lol-lobby/v2/lobby/invitations')
    ]);
    const noInvitations = Array.isArray(invitations) && invitations.every(i => ['Declined', 'Revoked', 'Expired'].includes(i.state));
    if (phase !== 'Lobby' || search || ready?.state === 'InProgress' ||
      !player.currentParty?.activityLocked || player.currentParty.players?.length !== 1 ||
      lobby.members?.length !== 1 || !lobby.localMember?.isLeader || !lobby.gameConfig?.queueId || !noInvitations) {
      throw new Error('League refuse les rôles : le lobby est verrouillé. Quitte puis recrée le lobby avant de réessayer.');
    }
    // Recheck immediately before replacing only this isolated, idle lobby (same queue).
    const queueId = lobby.gameConfig.queueId;
    const latest = await lcu.call('GET', '/lol-lobby/v2/lobby');
    if (latest.members?.length !== 1 || !latest.localMember?.isLeader || latest.gameConfig?.queueId !== queueId ||
      await lcu.call('GET', '/lol-gameflow/v1/gameflow-phase') !== 'Lobby') throw new Error('Le lobby a changé. Réessaie.');
    await lcu.call('DELETE', '/lol-lobby/v2/lobby');
    await lcu.call('POST', '/lol-lobby/v2/lobby', { queueId });
    await lcu.call('PUT', endpoint, preferences);
    recovered = true;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const lobby = await lcu.call('GET', '/lol-lobby/v2/lobby');
    if (lobby.localMember?.firstPositionPreference === preferences.firstPreference &&
      (preferences.firstPreference === 'FILL' || lobby.localMember.secondPositionPreference === preferences.secondPreference)) {
      return { ...preferences, recovered };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('League n’a pas confirmé les nouveaux rôles. Réessaie.');
}
module.exports = { validateRoles, applyRoles };
