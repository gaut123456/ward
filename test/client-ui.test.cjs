const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClientUi } = require('../electron/client-ui.cjs');
const absent = { exists: false, hasWindow: false, visible: false };
const loading = { exists: true, hasWindow: false, visible: false };
const visible = { exists: true, hasWindow: true, visible: true };
function fixture(states) {
  let time = 0, index = 0;
  const calls = [];
  const ui = createClientUi({
    call: async (method, route) => { calls.push([method, route]); },
    inspect: async () => states[Math.min(index++, states.length - 1)],
    now: () => time, sleep: async ms => { time += ms; }, timeout: 2000
  });
  return { ui, calls };
}
test('headless startup explicitly launches UX, waits for its window, then shows it', async () => {
  const { ui, calls } = fixture([absent, loading, visible, visible]);
  assert.deepEqual(await ui.open(), { shown: true });
  assert.deepEqual(calls, [['POST', '/riotclient/launch-ux'], ['POST', '/riotclient/ux-show'], ['POST', '/riotclient/ux-show']]);
});
test('an existing UX is shown, never launched twice or killed', async () => {
  const { ui, calls } = fixture([visible, visible]);
  assert.deepEqual(await ui.open(), { shown: true });
  assert.deepEqual(calls, [['POST', '/riotclient/ux-show']]);
});
test('204 responses without any window are a failure, not a fake success', async () => {
  const { ui, calls } = fixture([absent]);
  await assert.rejects(ui.open(), /n’a pas affiché sa fenêtre/);
  assert.equal(calls.filter(c => c[1] === '/riotclient/launch-ux').length, 1);
  assert.ok(calls.every(c => ['/riotclient/launch-ux', '/riotclient/ux-show'].includes(c[1])));
});
test('a minimized window is not reported as visible until actually restored', async () => {
  const minimized = { exists: true, hasWindow: true, visible: false };
  const { ui } = fixture([minimized]);
  await assert.rejects(ui.open(), /n’a pas affiché sa fenêtre/);
  const restored = fixture([minimized, minimized, visible]);
  assert.deepEqual(await restored.ui.open(), { shown: true });
});
test('automatic opening stops when champion select ends', async () => {
  const { ui, calls } = fixture([absent, loading, visible]);
  let checks = 0;
  assert.deepEqual(await ui.open({ shouldShow: async () => ++checks < 3 }), { shown: false });
  assert.deepEqual(calls, [['POST', '/riotclient/launch-ux'], ['POST', '/riotclient/ux-show']]);
});
test('inspection errors are surfaced without touching League', async () => {
  let calls = 0;
  const ui = createClientUi({ call: async () => calls++, inspect: async () => { throw Error('Inspection unavailable'); } });
  await assert.rejects(ui.open(), /Inspection unavailable/);
  assert.equal(calls, 0);
});
