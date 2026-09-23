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

async function launch(onProgress = () => {}) {
  try { await call('GET', '/riotclient/region-locale'); return; } catch {}
  const league = await findLeague();
  const riotLock = path.join(process.env.LOCALAPPDATA, 'Riot Games/Riot Client/Config/lockfile');
  let riot;
  try {
    riot = readLockfile(riotLock);
    await request(riot, 'GET', '/rso-auth/v1/authorization');
  } catch {
    onProgress('Connexion à Riot…');
    const installs = JSON.parse(fs.readFileSync(path.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games/RiotClientInstalls.json'), 'utf8'));
    const normalize = p => path.resolve(p).toLowerCase();
    const associated = Object.entries(installs.associated_client || {}).find(([folder]) => normalize(folder) === normalize(path.dirname(league)))?.[1];
    await spawnClient(associated || installs.rc_live || installs.rc_default, ['--launch-background-mode']);
    riot = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      await delay(1000);
      try {
        const candidate = readLockfile(riotLock);
        await request(candidate, 'GET', '/rso-auth/v1/authorization');
        riot = candidate; break;
      } catch { onProgress('Connecte-toi dans Riot Client…'); }
    }
    if (!riot) throw new Error('Connecte-toi dans Riot Client, puis réessaie.');
  }
  onProgress('Démarrage de League…');
  // Supplying the current Riot session avoids ExitForDirectLaunch (the redirect
  // back to the launcher). Credentials stay local and are never logged or saved.
  await spawnClient(league, ['--headless', '--no-rads', '--disable-self-update',
    `--riotclient-app-port=${riot.port}`, `--riotclient-auth-token=${riot.token}`]);
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(1000);
    try { await call('GET', '/lol-summoner/v1/current-summoner'); return; } catch {}
  }
  throw new Error('League ne répond pas. Vérifie la connexion ou une mise à jour dans Riot Client.');
}

module.exports = { findLeague, readLockfile, request, discover, call, launch };
