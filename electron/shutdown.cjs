// Fermeture de Ward : ferme aussi League quand il tourne en arrière-plan (headless).
// On ne ferme jamais un client affiché à l'écran, et on demande avant un moment
// où fermer League aurait un effet sur la partie.

const RISKS = {
  Matchmaking: 'Une recherche est en cours : fermer League te retire de la file.',
  ReadyCheck: 'Une partie vient d’être trouvée : fermer League la refusera.',
  ChampSelect: 'Tu es en sélection des champions : fermer League compte comme une esquive, avec pénalité.',
  GameStart: 'Une partie est en cours de chargement.',
  InProgress: 'Une partie est en cours.',
  Reconnect: 'Une partie est en cours : tu devras rouvrir League pour la rejoindre.'
};

// Renvoie ce qui a été fait : 'not-running' | 'unknown' | 'visible' | 'kept' | 'closed'.
async function closeHeadlessLeague({ call, inspect, queueState, confirm }) {
  let state;
  try { state = await queueState(); } catch { return 'not-running'; }
  let ux;
  try { ux = await inspect(); } catch { return 'unknown'; } // Dans le doute, on ne ferme rien.
  if (ux?.visible) return 'visible';
  const risk = state.searching ? RISKS.Matchmaking : RISKS[state.phase];
  if (risk && !await confirm(risk)) return 'kept';
  await call('POST', '/process-control/v1/process/quit');
  return 'closed';
}

module.exports = { RISKS, closeHeadlessLeague };
