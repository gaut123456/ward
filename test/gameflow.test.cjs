const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readySnapshot, READY_DURATION_MS, createClientHandoff: createHandoff } = require('../electron/gameflow.cjs');
// Isolate gameflow policy; the real UX startup sequence is covered separately.
const createClientHandoff = call => createHandoff(call, () => call('POST', '/riotclient/ux-show'));

test('ready-check elapsed seconds become a deadline, never a countdown reset', () => {
  const first = readySnapshot({ state: 'InProgress', timer: 3.5 }, 10000);
  assert.equal(first.deadline, 10000 + READY_DURATION_MS - 3500);
  const stalled = readySnapshot({ state: 'InProgress', timer: 3.5 }, 11000, first);
  assert.equal(stalled.deadline, first.deadline);
  const advanced = readySnapshot({ state: 'InProgress', timer: 5.5 }, 12000, stalled);
  assert.equal(advanced.deadline, first.deadline);
  const nextCheck = readySnapshot({ state: 'InProgress', timer: 0.2 }, 20000, advanced);
  assert.equal(nextCheck.deadline, 20000 + READY_DURATION_MS - 200);
});
test('unknown timer stays unknown; inactive/accepted states are explicit', () => {
  assert.equal(readySnapshot({ state: 'InProgress' }).deadline, null);
  assert.equal(readySnapshot({ state: 'Invalid', timer: 4 }).deadline, null);
  assert.equal(readySnapshot(null).active, false);
  assert.equal(readySnapshot({ state: 'InProgress', playerResponse: 'Accepted', timer: 5 }).response, 'Accepted');
});
test('handoff launches UX only at champion select/reconnect and does not steal focus repeatedly', async () => {
  let phase = 'Lobby'; const calls = [];
  const handoff = createClientHandoff(async (method, route) => { calls.push(route); return phase; });
  for (phase of ['Lobby', 'Matchmaking', 'ReadyCheck', 'InProgress']) await handoff.observe(phase);
  assert.deepEqual(calls, []);
  phase = 'ChampSelect'; await handoff.observe(phase);
  assert.deepEqual(calls, ['/lol-gameflow/v1/gameflow-phase', '/riotclient/ux-show']);
  await handoff.observe(phase); await handoff.observe(phase);
  assert.equal(calls.length, 2);
  phase = 'Reconnect'; await handoff.observe(phase);
  assert.equal(calls.length, 4);
});
test('failed UX handoff retries with a bound, then permits manual retry', async () => {
  let failures = true, launches = 0;
  const handoff = createClientHandoff(async (method, route) => {
    if (route === '/riotclient/ux-show') { launches++; if (failures) throw Error('not ready'); }
    return 'ChampSelect';
  });
  await handoff.observe('ChampSelect', 0);
  await handoff.observe('ChampSelect', 100);
  assert.equal(launches, 1); assert.ok(handoff.state.error);
  await handoff.observe('ChampSelect', 5000); await handoff.observe('ChampSelect', 10000);
  await handoff.observe('ChampSelect', 20000); assert.equal(launches, 3);
  failures = false; await handoff.open(); assert.equal(launches, 4); assert.equal(handoff.state.error, '');
});
test('manual opening works in every phase without killing, relaunching or changing the lobby', async () => {
  for (const phase of ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'InProgress', 'EndOfGame']) {
    const calls = [];
    const handoff = createClientHandoff(async (method, route) => { calls.push([method, route]); return phase; });
    await handoff.open({ manual: true });
    assert.deepEqual(calls, [['GET', '/lol-gameflow/v1/gameflow-phase'], ['POST', '/riotclient/ux-show']]);
  }
});
test('manual opening reports errors and can be retried', async () => {
  let fail = true;
  const handoff = createClientHandoff(async (method) => { if (method === 'POST' && fail) throw Error('Offline'); return 'Lobby'; });
  await assert.rejects(handoff.open({ manual: true }), /Offline/);
  assert.equal(handoff.state.opening, false);
  fail = false;
  await handoff.open({ manual: true });
  assert.equal(handoff.state.error, '');
});
test('a slow UX launch cannot focus over the game after champion select ends', async () => {
  const calls = [];
  const handoff = createClientHandoff(async (method, route) => { calls.push(route); return 'InProgress'; });
  await handoff.observe('ChampSelect');
  assert.ok(!calls.includes('/riotclient/ux-show'));
});
