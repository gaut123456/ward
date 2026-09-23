const { test } = require('node:test');
const assert = require('node:assert/strict');
const lcu = require('../electron/lcu.cjs');
const { applyRoles } = require('../electron/roles.cjs');

test('role recovery only replaces an isolated, idle locked lobby', async t => {
  const originalCall = lcu.call;
  try {
    for (const scenario of ['solo', 'duo', 'invitation', 'search', 'unlocked', 'changed']) {
      await t.test(scenario, async () => {
        const mutations = [];
        let writes = 0, reads = 0;
        const prefs = { firstPreference: 'MIDDLE', secondPreference: 'JUNGLE' };
        const lobby = { gameConfig: { queueId: 420 }, members: scenario === 'duo' ? [{}, {}] : [{}],
          localMember: { isLeader: true, firstPositionPreference: 'TOP', secondPositionPreference: 'BOTTOM' } };
        lcu.call = async (method, route, body) => {
          if (method !== 'GET') mutations.push({ method, route });
          if (route.endsWith('/position-preferences')) {
            if (++writes === 1) throw Object.assign(new Error('INVALID_REQUEST'), { status: 400 });
            lobby.localMember.firstPositionPreference = body.firstPreference;
            lobby.localMember.secondPositionPreference = body.secondPreference;
            return;
          }
          if (route === '/lol-gameflow/v1/gameflow-phase') return 'Lobby';
          if (route === '/lol-matchmaking/v1/search') {
            if (scenario === 'search') return { searchState: 'Searching' };
            throw Object.assign(new Error('No search'), { status: 404 });
          }
          if (route.endsWith('/ready-check')) throw Object.assign(new Error('No ready check'), { status: 404 });
          if (route.endsWith('/parties/player')) return { currentParty: { activityLocked: scenario !== 'unlocked', players: lobby.members } };
          if (route.endsWith('/invitations')) return scenario === 'invitation' ? [{ state: 'Pending' }] : [];
          if (route === '/lol-lobby/v2/lobby') {
            if (method === 'GET' && ++reads > 1 && scenario === 'changed') return { ...lobby, members: [{}, {}] };
            return lobby;
          }
          throw new Error(`Unexpected route ${route}`);
        };
        if (scenario === 'solo') {
          assert.deepEqual(await applyRoles(prefs), { ...prefs, recovered: true });
          assert.equal(mutations.filter(m => m.method === 'DELETE').length, 1);
          assert.equal(writes, 2);
        } else {
          await assert.rejects(applyRoles(prefs));
          assert.equal(mutations.some(m => m.method === 'DELETE'), false);
          assert.equal(writes, 1);
        }
      });
    }
  } finally { lcu.call = originalCall; }
});
