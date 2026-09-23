// Lecture seule : compare chaque seconde trois sources d'icône du partenaire
// (membre du lobby, endpoint summoner, présence chat) pour identifier celle
// qui se met à jour quand il change de photo. Aucune mutation, rien de sensible.
const lcu = require('../electron/lcu.cjs');
const seconds = Number(process.argv[2]) || 60;
(async () => {
  console.log(`Sonde ${seconds}s — demande à ton pote de changer de PP maintenant.`);
  let last = '';
  for (let i = 0; i < seconds; i++) {
    try {
      const lobby = await lcu.call('GET', '/lol-lobby/v2/lobby').catch(e => e.status === 404 ? null : Promise.reject(e));
      const local = lobby?.localMember?.summonerId;
      const member = (lobby?.members || []).find(m => m.summonerId && String(m.summonerId) !== String(local));
      let endpoint = null, chat = null;
      if (member) {
        endpoint = await lcu.call('GET', `/lol-summoner/v1/summoners/${member.summonerId}`).catch(() => null);
        const friends = await lcu.call('GET', '/lol-chat/v1/friends').catch(() => []);
        chat = (Array.isArray(friends) ? friends : []).find(f => String(f.summonerId) === String(member.summonerId));
      }
      const line = `${(new Date()).toISOString().slice(11, 19)}  lobby=${member ? member.summonerIconId : '—'}  summoner=${endpoint ? endpoint.profileIconId : '—'}  chat=${chat ? chat.icon : '—'}  ${member ? (member.summonerName || chat?.gameName || '') : '(pas de partenaire)'}`;
      if (line !== last) console.log(line);
      last = line;
    } catch (e) { console.log(`${(new Date()).toISOString().slice(11, 19)}  indisponible : ${e.message}`); await new Promise(r => setTimeout(r, 2000)); continue; }
    await new Promise(r => setTimeout(r, 1000));
  }
})();
