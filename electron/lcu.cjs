const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let cachedClient, discovery, installation;

function readLockfile(file) {
  const [, pid, port, token, protocol] = fs.readFileSync(file, 'utf8').trim().split(':');
  if (!/^\d+$/.test(port) || !token || protocol !== 'https') throw new Error('Client local indisponible.');
  return { port: Number(port), token, pid: Number(pid) };
}

async function findLeague() {
  if (installation) return installation;
  const candidates = [process.env.LOL_CLIENT_PATH];
  const riotRoot = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games');
  try {
    const text = fs.readFileSync(path.join(riotRoot, 'Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml'), 'utf8');
    const quoted = text.match(/^product_install_full_path:\s*(".*")\s*$/m)?.[1];
    if (quoted) candidates.push(path.join(JSON.parse(quoted), 'LeagueClient.exe'));
  } catch {}
  try {
    const installs = JSON.parse(fs.readFileSync(path.join(riotRoot, 'RiotClientInstalls.json'), 'utf8'));
    for (const folder of Object.keys(installs.associated_client || {})) {
      if (!/pbe/i.test(folder)) candidates.push(path.join(folder, 'LeagueClient.exe'));
    }
  } catch {}
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const folder of ['Riot Games', 'Games/Riot Games', 'Program Files/Riot Games']) {
      candidates.push(path.join(`${drive}:\\`, folder, 'League of Legends/LeagueClient.exe'));
    }
  }
  installation = candidates.find(file => file && fs.existsSync(file));
  if (!installation) throw new Error('Installation League introuvable. Définis LOL_CLIENT_PATH.');
  return installation;
}

function request(client, method, endpoint, body, binary = false) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ hostname: '127.0.0.1', port: client.port, path: endpoint, method,
      rejectUnauthorized: false, auth: `riot:${client.token}`,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let data;
        try { data = JSON.parse(buffer.toString()); } catch { data = buffer.toString(); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(data?.message || `Client local : erreur ${res.statusCode}`);
          error.status = res.statusCode; return reject(error);
        }
        resolve(binary ? buffer : data);
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Le client ne répond pas.')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function discover() {
  if (cachedClient) return cachedClient;
  if (discovery) return discovery;
  discovery = (async () => {
    try {
      const client = readLockfile(path.join(path.dirname(await findLeague()), 'lockfile'));
      await request(client, 'GET', '/riotclient/region-locale');
      return cachedClient = client;
    } catch {}
    const script = `Get-CimInstance Win32_Process -Filter "name = 'LeagueClientUx.exe' OR name = 'LeagueClient.exe'" | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 6000 });
    const records = JSON.parse(stdout.trim() || '[]');
    for (const record of Array.isArray(records) ? records : [records]) {
      const port = record.CommandLine?.match(/(?:^|\s)"?--app-port=(\d+)/)?.[1];
      const token = record.CommandLine?.match(/(?:^|\s)"?--remoting-auth-token=([^\s"]+)/)?.[1];
      if (port && token) return cachedClient = { port: Number(port), token, pid: record.Name === 'LeagueClient.exe' ? record.ProcessId : record.ParentProcessId };
    }
    throw new Error('League démarre…');
  })().finally(() => { discovery = null; });
  return discovery;
}

async function call(method, endpoint, body, binary = false) {
  const client = await discover();
  try { return await request(client, method, endpoint, body, binary); }
  catch (error) {
    if (!error.status || error.status === 401) cachedClient = null;
    throw error; // Never replay a mutation automatically.
  }
}

function spawnClient(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: path.dirname(executable), detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error(`Impossible de démarrer ${path.basename(executable)}.`)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// Riot Client lancé et connecté (session réutilisée pour lancer League).
async function riotSession(onProgress, league) {
  const riotLock = path.join(process.env.LOCALAPPDATA, 'Riot Games/Riot Client/Config/lockfile');
  const installs = JSON.parse(fs.readFileSync(path.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games/RiotClientInstalls.json'), 'utf8'));
  const normalize = p => path.resolve(p).toLowerCase();
  const associated = Object.entries(installs.associated_client || {}).find(([folder]) => normalize(folder) === normalize(path.dirname(league)))?.[1];
  const executable = associated || installs.rc_live || installs.rc_default;
  try {
    const riot = readLockfile(riotLock);
    await request(riot, 'GET', '/rso-auth/v1/authorization');
    return { riot, executable };
  } catch {}
  onProgress('Connexion à Riot…');
  await spawnClient(executable, ['--launch-background-mode']);
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(1000);
    try {
      const riot = readLockfile(riotLock);
      await request(riot, 'GET', '/rso-auth/v1/authorization');
      return { riot, executable };
    } catch { onProgress('Connecte-toi dans Riot Client…'); }
  }
  throw new Error('Connecte-toi dans Riot Client, puis réessaie.');
}

async function uxRunning() {
  try {
    const { stdout } = await exec('tasklist.exe', ['/FI', 'IMAGENAME eq LeagueClientUx.exe', '/NH'], { windowsHide: true, timeout: 4000 });
    return /LeagueClientUx\.exe/i.test(stdout);
  } catch { return false; }
}

// Lance League PAR LE RIOT CLIENT (API de lancement, comme le bouton « Jouer ») : c'est le seul
// chemin prévu par Riot, et c'est lui qui gère Vanguard. Ne jamais lancer LeagueClient.exe
// directement ni toucher aux services Vanguard : ça a déclenché VAN 2266 puis une
// « Vanguard Security Violation 290 ». Le journal reste en ASCII (console Windows).
async function launch(onProgress = () => {}, log = () => {}) {
  try { await call('GET', '/riotclient/region-locale'); return { launched: false }; } catch {}
  const started = Date.now();
  const stamp = text => log(`${((Date.now() - started) / 1000).toFixed(1)} s - ${text}`);
  const league = await findLeague();
  const { riot, executable } = await riotSession(onProgress, league);
  stamp('Riot Client pret');
  onProgress('Démarrage de League…');
  try {
    await request(riot, 'POST', '/product-launcher/v1/products/league_of_legends/patchlines/live');
    stamp('League lance par le Riot Client');
  } catch (error) {
    stamp(`API de lancement refusee (${error.status || error.message}) : lancement comme le raccourci League`);
    await spawnClient(executable, ['--launch-product=league_of_legends', '--launch-patchline=live']);
  }
  for (let attempt = 0; attempt < 480; attempt++) {
    await delay(250);
    try { await call('GET', '/lol-summoner/v1/current-summoner'); stamp('client League pret'); return { launched: true }; } catch {}
  }
  throw new Error('League ne répond pas. Vérifie la connexion ou une mise à jour dans Riot Client.');
}

module.exports = { findLeague, readLockfile, request, discover, call, launch, uxRunning };
