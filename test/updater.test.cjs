const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isNewer, pickUpdate, targetPath, download } = require('../electron/updater.cjs');

const release = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets, ...extra });
const asset = (name = 'Ward-portable.exe', extra = {}) => ({ name, size: 10, browser_download_url: `https://example.test/${name}`, ...extra });

test('compare les versions numériquement', () => {
  assert.equal(isNewer('v0.1.10', '0.1.9'), true);
  assert.equal(isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(isNewer('v0.1.3', '0.1.3'), false);
  assert.equal(isNewer('v0.1.2', '0.1.3'), false);
  assert.equal(isNewer('nightly', '0.1.3'), false);
});

test('ne retient qu’une release publiée, plus récente, avec l’exe attendu', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  assert.deepEqual(pickUpdate(release('v0.1.4', [asset('Ward-0.1.4-portable.exe'), asset('Ward-portable.exe', { digest })]), '0.1.3'),
    { version: '0.1.4', url: 'https://example.test/Ward-portable.exe', size: 10, sha256: 'a'.repeat(64) });
  assert.equal(pickUpdate(release('v0.1.3', [asset()]), '0.1.3'), null);
  assert.equal(pickUpdate(release('v0.1.4', [asset('Autre.exe')]), '0.1.3'), null);
  assert.equal(pickUpdate(release('v0.1.4', [asset()], { prerelease: true }), '0.1.3'), null);
  assert.equal(pickUpdate(release('v0.1.4', [asset('Ward-portable.exe', { size: 0 })]), '0.1.3'), null);
  assert.equal(pickUpdate(release('v0.1.4', [asset()]), '0.1.3').sha256, null);
});

test('garde le nom versionné à jour, sinon remplace en place', () => {
  assert.equal(targetPath('C:\\Jeux\\Ward-0.1.3-portable.exe', '0.1.3', '0.1.4'), path.join('C:\\Jeux', 'Ward-0.1.4-portable.exe'));
  assert.equal(targetPath('C:\\Jeux\\Ward-portable.exe', '0.1.3', '0.1.4'), path.join('C:\\Jeux', 'Ward-portable.exe'));
  assert.equal(targetPath('C:\\Jeux\\MonWard.exe', '0.1.3', '0.1.4'), path.join('C:\\Jeux', 'MonWard.exe'));
});

function fakeFetch(bytes) {
  return async () => ({ ok: true, status: 200, body: new Blob([bytes]).stream() });
}

test('télécharge, vérifie la taille et l’empreinte, puis renomme', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ward-updater-'));
  const bytes = Buffer.from('nouvel exe!');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const destination = path.join(dir, 'Ward.update');
  const progress = [];
  await download({ url: 'x', size: bytes.length, sha256 }, destination, { fetch: fakeFetch(bytes), onProgress: p => progress.push(p) });
  assert.deepEqual(fs.readFileSync(destination), bytes);
  assert.equal(progress.at(-1), 100);
  assert.equal(fs.existsSync(`${destination}.part`), false);

  const corrupted = path.join(dir, 'Corrupted.update');
  await assert.rejects(download({ url: 'x', size: bytes.length, sha256: 'b'.repeat(64) }, corrupted, { fetch: fakeFetch(bytes) }), /Empreinte/);
  await assert.rejects(download({ url: 'x', size: bytes.length + 5, sha256: null }, corrupted, { fetch: fakeFetch(bytes) }), /incomplet/);
  await assert.rejects(download({ url: 'x', size: 3, sha256: null }, corrupted, { fetch: fakeFetch(bytes) }), /plus gros/);
  assert.equal(fs.existsSync(corrupted), false);
  assert.equal(fs.existsSync(`${corrupted}.part`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
