// Mise à jour automatique de l'exe portable depuis les releases GitHub.
// electron-updater ne gère pas la cible « portable » : on télécharge le nouvel
// exe à côté de l'actuel, puis un script PowerShell le met en place une fois
// Ward fermé et relance l'application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = 'gaut123456/ward';
const ASSET = 'Ward-portable.exe';

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Retient la release si elle est plus récente et contient l'exe attendu.
function pickUpdate(release, currentVersion) {
  if (!release || release.draft || release.prerelease || !isNewer(release.tag_name, currentVersion)) return null;
  const asset = (release.assets || []).find(item => item.name === ASSET);
  if (!asset?.browser_download_url || !Number.isSafeInteger(asset.size) || asset.size <= 0) return null;
  const sha256 = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1]?.toLowerCase() || null;
  return { version: parseVersion(release.tag_name).join('.'), url: asset.browser_download_url, size: asset.size, sha256 };
}

// Garde le nom versionné à jour (Ward-0.1.2-portable.exe → Ward-0.1.3-portable.exe),
// sinon remplace le fichier en place pour ne pas casser un raccourci renommé.
function targetPath(currentFile, currentVersion, nextVersion) {
  const name = path.basename(currentFile);
  const renamed = name.includes(currentVersion) ? name.split(currentVersion).join(nextVersion) : name;
  return path.join(path.dirname(currentFile), renamed);
}

async function checkForUpdate({ currentVersion, fetch }) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ward-updater' }
  });
  if (!response.ok) throw new Error(`GitHub a répondu ${response.status}`);
  return pickUpdate(await response.json(), currentVersion);
}

async function download(update, destination, { fetch, onProgress = () => {} }) {
  const partial = `${destination}.part`;
  const response = await fetch(update.url, { headers: { 'User-Agent': 'Ward-updater' } });
  if (!response.ok || !response.body) throw new Error(`Téléchargement refusé (${response.status})`);
  const hash = crypto.createHash('sha256');
  const file = fs.createWriteStream(partial);
  let received = 0, lastPercent = -1, streamError = null;
  file.on('error', error => { streamError = error; });
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (streamError) throw streamError;
      if (received > update.size) throw new Error('Fichier de mise à jour plus gros que prévu');
      hash.update(value);
      if (!file.write(value)) await new Promise(resolve => file.once('drain', resolve));
      const percent = Math.floor(received / update.size * 100);
      if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
    }
    await new Promise((resolve, reject) => file.end(error => error ? reject(error) : resolve()));
    if (received !== update.size) throw new Error('Téléchargement incomplet');
    if (update.sha256 && hash.digest('hex') !== update.sha256) throw new Error('Empreinte de la mise à jour invalide');
    fs.renameSync(partial, destination);
  } catch (error) {
    if (!file.closed) await new Promise(resolve => { file.once('close', resolve); file.destroy(); });
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

const INSTALL_SCRIPT = `param([string]$Old, [string]$New, [string]$Target, [string]$ArgumentsB64)
# Waits until Ward and the portable launcher release the old exe, then swaps it.
$log = Join-Path $env:TEMP 'ward-update.log'
function Log($text) { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $text) -ErrorAction SilentlyContinue }
Log "start old=$Old target=$Target"
$arguments = if ($ArgumentsB64 -and $ArgumentsB64 -ne '-') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsB64)) } else { '' }
$unlocked = $false
for ($i = 0; $i -lt 240; $i++) {
  try { $stream = [IO.File]::Open($Old, 'Open', 'ReadWrite', 'None'); $stream.Close(); $unlocked = $true; break }
  catch { Start-Sleep -Milliseconds 500 }
}
$launch = $Old
if ($unlocked) {
  try {
    Move-Item -LiteralPath $New -Destination $Target -Force -ErrorAction Stop
    if ($Target -ne $Old) { Remove-Item -LiteralPath $Old -Force -ErrorAction SilentlyContinue }
    $launch = $Target
    Log "swapped"
  } catch { Log "swap failed: $_" }
} else { Log "old exe still locked, keeping it" }
try {
  if ($arguments) { Start-Process -FilePath $launch -ArgumentList $arguments } else { Start-Process -FilePath $launch }
  Log "launched $launch $arguments"
} catch { Log "launch failed: $_" }
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`;

function quoteArgument(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

// Lance le script via WMI : il ne fait alors pas partie de l'arbre de processus
// de Ward et survit à la fermeture du lanceur portable.
function install({ currentFile, downloaded, target, args = [], tempDir, execFile = require('node:child_process').execFile }) {
  const script = path.join(tempDir, `ward-update-${process.pid}.ps1`);
  fs.writeFileSync(script, INSTALL_SCRIPT);
  const joined = args.map(quoteArgument).join(' ');
  const argumentsB64 = joined ? Buffer.from(joined, 'utf8').toString('base64') : '-';
  const commandLine = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', `"${script}"`,
    '-Old', `"${currentFile}"`, '-New', `"${downloaded}"`, '-Target', `"${target}"`, '-ArgumentsB64', argumentsB64].join(' ');
  const encoded = Buffer.from(commandLine, 'utf8').toString('base64');
  const create = `$line = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));` +
    ` $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line }; exit $result.ReturnValue`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', create], { windowsHide: true, timeout: 20000 },
      error => error ? reject(new Error(`Installation impossible : ${error.message}`)) : resolve());
  });
}

module.exports = { REPO, ASSET, parseVersion, isNewer, pickUpdate, targetPath, checkForUpdate, download, install };
