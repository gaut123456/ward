const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const lcu = require('./lcu.cjs');
const exec = promisify(execFile);

async function inspectUx() {
  const { pid } = await lcu.discover();
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Impossible d’identifier la session League.');
  // Query only the UX belonging to this backend. Never print command lines or
  // credentials, never manipulate or kill a window/process via PowerShell.
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LeagueWidgetWindow { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'
    $uxProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe' AND ParentProcessId = ${pid}")
    $hasWindow = $false; $visible = $false
    foreach ($uxProcess in $uxProcesses) {
      $ux = Get-Process -Id $uxProcess.ProcessId -ErrorAction SilentlyContinue
      if ($ux -and $ux.MainWindowHandle -ne [IntPtr]::Zero) {
        $hasWindow = $true
        if ([LeagueWidgetWindow]::IsWindowVisible($ux.MainWindowHandle) -and -not [LeagueWidgetWindow]::IsIconic($ux.MainWindowHandle)) { $visible = $true }
      }
    }
    [pscustomobject]@{ exists = $uxProcesses.Count -gt 0; hasWindow = $hasWindow; visible = $visible } | ConvertTo-Json -Compress
  `;
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000 });
    return JSON.parse(stdout.trim());
  } catch { throw new Error('Impossible de vérifier la fenêtre League. Réessaie.'); }
}

function createClientUi({ call = lcu.call, inspect = inspectUx, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeout = 30000 } = {}) {
  async function open({ shouldShow = async () => true } = {}) {
    const deadline = now() + timeout;
    const initial = await inspect();
    if (!await shouldShow()) return { shown: false };
    // ux-show alone returns 204 with no UX process in a headless session.
    // Explicitly launch it, without restarting the authenticated backend.
    if (!initial.exists) await call('POST', '/riotclient/launch-ux');
    if (!await shouldShow()) return { shown: false };
    await call('POST', '/riotclient/ux-show');
    let shownAfterLoad = initial.hasWindow;
    while (now() < deadline) {
      const status = await inspect();
      if (!await shouldShow()) return { shown: false };
      if (status.hasWindow && !shownAfterLoad) {
        // The first request can arrive before CEF has loaded the main window.
        await call('POST', '/riotclient/ux-show');
        shownAfterLoad = true;
      } else if (shownAfterLoad && status.visible) return { shown: true };
      await sleep(350);
    }
    throw new Error('League n’a pas affiché sa fenêtre. Réessaie le bouton ↗. Aucun processus n’a été fermé.');
  }
  return { open };
}
module.exports = { inspectUx, createClientUi };
