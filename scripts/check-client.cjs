const lcu = require('../electron/lcu.cjs');
(async () => {
  if (process.argv.includes('--launch')) await lcu.launch(message => console.log(message));
  const summoner = await lcu.call('GET', '/lol-summoner/v1/current-summoner');
  const phase = await lcu.call('GET', '/lol-gameflow/v1/gameflow-phase');
  console.log(JSON.stringify({ connected: true, hasProfile: !!summoner.profileIconId, level: summoner.summonerLevel, phase }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
