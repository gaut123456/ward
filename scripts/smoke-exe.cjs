const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'out/win-unpacked/Ward.exe');
const portable = path.basename(executable).endsWith('-portable.exe');
const archive = path.join(root, 'out/win-unpacked/resources/app.asar');
const files = asar.listPackage(archive);
for (const required of ['/electron/main.cjs', '/electron/preload.cjs', '/electron/gameflow.cjs', '/renderer/index.html', '/renderer/ready.html', '/renderer/assets/roles/middle.png']) {
  if (!files.some(file => file.replaceAll('\\', '/') === required)) throw new Error(`Missing packaged asset: ${required}`);
}
if (files.some(file => /(?:^|[/\\])(?:\.qa|test|scripts|lockfile|roles\.json)(?:$|[/\\])/.test(file))) throw new Error('Unexpected test or user data in the package');
if (!fs.existsSync(executable)) throw new Error('Build the executable first with npm run build:exe');
// Preview never launches League or sends LCU requests. The executable itself
// checks the bundled renderer, isolated preload and role PNGs, then exits.
const child = spawn(executable, ['--preview', '--smoke-test'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => process.stderr.write(chunk));
const timeout = setTimeout(() => { child.kill(); console.error('Packaged smoke test timed out'); process.exitCode = 1; }, 30000);
child.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  clearTimeout(timeout);
  // NSIS portable.nsi uses ExecWait + SetErrorLevel: it forwards the internal
  // smoke test's exit code, but not its stdout. The unpacked exe has both.
  if (code !== 0 || (!portable && (!output.includes('PACKAGED_SMOKE_OK') || !output.includes('"packaged":true')))) {
    console.error(`Smoke test failed (exit ${code}, portable ${portable})`); process.exitCode = 1;
  }
  else console.log('PASS: Windows executable, packaged renderer/preload/assets; no live LCU calls.');
});
