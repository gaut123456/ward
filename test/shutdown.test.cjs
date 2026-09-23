const test = require('node:test');
const assert = require('node:assert/strict');
const { RISKS, closeHeadlessLeague } = require('../electron/shutdown.cjs');

function setup({ phase = 'Lobby', searching = false, visible = false, inspectFails = false, running = true, answer = false } = {}) {
  const calls = [], asked = [];
  const deps = {
    call: async (method, route) => { calls.push(`${method} ${route}`); },
    inspect: async () => { if (inspectFails) throw new Error('boom'); return { exists: true, hasWindow: visible, visible }; },
    queueState: async () => { if (!running) throw new Error('Client local indisponible.'); return { phase, searching }; },
    confirm: async message => { asked.push(message); return answer; }
  };
  return { deps, calls, asked };
}
const QUIT = 'POST /process-control/v1/process/quit';

test('ferme League en arrière-plan quand rien n’est en cours', async () => {
  for (const phase of ['None', 'Lobby', 'EndOfGame']) {
    const { deps, calls, asked } = setup({ phase });
    assert.equal(await closeHeadlessLeague(deps), 'closed');
    assert.deepEqual(calls, [QUIT]);
    assert.deepEqual(asked, []);
  }
});

test('ne ferme jamais un client affiché à l’écran', async () => {
  const { deps, calls } = setup({ visible: true });
  assert.equal(await closeHeadlessLeague(deps), 'visible');
  assert.deepEqual(calls, []);
});

test('dans le doute (League fermé ou fenêtre illisible), ne ferme rien', async () => {
  let { deps, calls } = setup({ running: false });
  assert.equal(await closeHeadlessLeague(deps), 'not-running');
  assert.deepEqual(calls, []);
  ({ deps, calls } = setup({ inspectFails: true }));
  assert.equal(await closeHeadlessLeague(deps), 'unknown');
  assert.deepEqual(calls, []);
});

test('demande avant un moment sensible et garde League par défaut', async () => {
  for (const [phase, searching, risk] of [['Lobby', true, RISKS.Matchmaking], ['ChampSelect', false, RISKS.ChampSelect], ['InProgress', false, RISKS.InProgress]]) {
    let { deps, calls, asked } = setup({ phase, searching });
    assert.equal(await closeHeadlessLeague(deps), 'kept');
    assert.deepEqual(asked, [risk]);
    assert.deepEqual(calls, []);
    ({ deps, calls } = setup({ phase, searching, answer: true }));
    assert.equal(await closeHeadlessLeague(deps), 'closed');
    assert.deepEqual(calls, [QUIT]);
  }
  assert.match(RISKS.ChampSelect, /esquive/);
});
