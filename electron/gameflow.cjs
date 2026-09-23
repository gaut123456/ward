const lcu = require('./lcu.cjs');
const { createClientUi } = require('./client-ui.cjs');

// Matches the client ready-check countdown animation (timer-countdown.webm,
// 10.733 s, client 16.18). LCU timer is ELAPSED seconds. This visual estimate
// never overrides the backend state or prevents accepting an active check.
const READY_DURATION_MS = 10733;
function readySnapshot(ready, now = Date.now(), previous = null) {
  const active = ready?.state === 'InProgress';
  const elapsed = Number.isFinite(ready?.timer) ? Math.max(0, ready.timer) : null;
  let deadline = active && elapsed !== null ? now + READY_DURATION_MS - elapsed * 1000 : null;
  if (deadline !== null && previous?.active && previous.deadline !== null && elapsed >= previous.elapsed - 1) {
    deadline = Math.min(deadline, previous.deadline);
  }
  return { active, response: ready?.playerResponse || 'None', elapsed, deadline,
    duration: READY_DURATION_MS, sampledAt: now };
}

async function queueState() {
  const [phase, search, fallback] = await Promise.all([
    lcu.call('GET', '/lol-gameflow/v1/gameflow-phase'),
    lcu.call('GET', '/lol-matchmaking/v1/search').catch(() => null),
    lcu.call('GET', '/lol-lobby/v2/lobby/matchmaking/search-state').catch(() => null)
  ]);
  const searching = phase === 'Matchmaking' || (['None', 'Lobby'].includes(phase) &&
    (search?.searchState === 'Searching' || fallback?.searchState === 'Searching'));
  return { phase, searching, sampledAt: Date.now(),
    timeInQueue: searching && Number.isFinite(search?.timeInQueue) ? Math.max(0, search.timeInQueue) : null,
    estimatedQueueTime: searching && Number.isFinite(search?.estimatedQueueTime) ? Math.max(0, search.estimatedQueueTime) : null };
}

function createClientHandoff(call = lcu.call, showClient = createClientUi({ call }).open) {
  let lastPhase, attempts = 0, retryAt = 0, complete = false, pending = null;
  const state = { opening: false, error: '' };
  async function open({ manual = false } = {}) {
    if (pending) return pending;
    state.opening = true; state.error = '';
    pending = (async () => {
      const phase = await call('GET', '/lol-gameflow/v1/gameflow-phase');
      if (!manual && !['ChampSelect', 'Reconnect'].includes(phase)) return { shown: false };
      const result = await showClient({ shouldShow: async () => manual || ['ChampSelect', 'Reconnect'].includes(await call('GET', '/lol-gameflow/v1/gameflow-phase')) });
      complete = result?.shown !== false;
      return result;
    })().catch(error => {
      state.error = 'Client masqué · clique pour réessayer';
      throw error;
    }).finally(() => { state.opening = false; pending = null; });
    return pending;
  }
  async function observe(phase, now = Date.now()) {
    if (phase !== lastPhase) { lastPhase = phase; attempts = 0; retryAt = 0; complete = false; state.error = ''; }
    if (!['ChampSelect', 'Reconnect'].includes(phase) || complete || pending || attempts >= 3 || now < retryAt) return;
    attempts++; retryAt = now + 5000;
    try { await open(); } catch { /* Retry at most three times; manual action remains available. */ }
  }
  return { open, observe, state };
}

module.exports = { queueState, readySnapshot, createClientHandoff, READY_DURATION_MS };
