import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetName, assetUrl, compareVersions, defaultBranch, githubRepo, isNewer, parseVersion, releaseTarget, sha256For, vsixAsset } from '../src/release';

test('each supported machine maps to its release archive', () => {
  assert.equal(assetName(releaseTarget('linux', 'x64')!), 'rtex-x86_64-unknown-linux-gnu.tar.gz');
  assert.equal(assetName(releaseTarget('linux', 'arm64')!), 'rtex-aarch64-unknown-linux-gnu.tar.gz');
  assert.equal(assetName(releaseTarget('darwin', 'arm64')!), 'rtex-aarch64-apple-darwin.tar.gz');
  assert.equal(assetName(releaseTarget('darwin', 'x64')!), 'rtex-x86_64-apple-darwin.tar.gz');
  assert.equal(assetName(releaseTarget('win32', 'x64')!), 'rtex-x86_64-pc-windows-msvc.zip');
  assert.equal(releaseTarget('win32', 'arm64'), undefined);
  assert.equal(releaseTarget('freebsd', 'x64'), undefined);
  assert.equal(
    assetUrl('v0.0.2', releaseTarget('linux', 'x64')!),
    'https://github.com/kenny-21342/realtime-tex/releases/download/v0.0.2/rtex-x86_64-unknown-linux-gnu.tar.gz',
  );
});

test('the fork builds its working branch, any other repository main', () => {
  assert.equal(defaultBranch('https://github.com/kenny-21342/realtime-tex'), 'kenny/main');
  assert.equal(defaultBranch('https://github.com/Kenny-21342/realtime-tex.git'), 'kenny/main');
  assert.equal(defaultBranch('kenny-21342/realtime-tex'), 'kenny/main');
  assert.equal(defaultBranch('https://github.com/HenryXiaoYang/realtime-tex'), 'main');
  assert.equal(defaultBranch('https://gitlab.com/someone/realtime-tex'), 'main');
});

test('versions compare numerically', () => {
  assert.deepEqual(parseVersion('v0.0.2'), [0, 0, 2]);
  assert.deepEqual(parseVersion('0.10.1-rc1'), [0, 10, 1]);
  assert.equal(parseVersion('nightly'), undefined);
  assert.equal(isNewer('v0.0.3', 'v0.0.2'), true);
  assert.equal(isNewer('v0.0.10', 'v0.0.9'), true);
  assert.equal(isNewer('v0.1', 'v0.0.9'), true);
  assert.equal(isNewer('v0.0.2', 'v0.0.2'), false);
  assert.equal(isNewer('v0.0.1', 'v0.0.2'), false);
  assert.equal(isNewer('v0.0.2', undefined), true);
  assert.equal(isNewer('nightly', 'v0.0.2'), false);
});

test('checksums are read from .sha256 files and SHA256SUMS', () => {
  const h = 'ab'.repeat(32);
  const other = 'cd'.repeat(32);
  assert.equal(sha256For(`${h}  rtex-x86_64-unknown-linux-gnu.tar.gz\n`, 'rtex-x86_64-unknown-linux-gnu.tar.gz'), h);
  // Windows assets are listed in binary mode (`*name`)
  assert.equal(sha256For(`${h.toUpperCase()} *rtex-x86_64-pc-windows-msvc.zip\r\n`, 'rtex-x86_64-pc-windows-msvc.zip'), h);
  assert.equal(sha256For(`${other}  a.tar.gz\n${h}  b.tar.gz\n`, 'b.tar.gz'), h);
  assert.equal(sha256For(`${other}  a.tar.gz\n`, 'b.tar.gz'), undefined);
  assert.equal(sha256For(`${h}\n`, 'anything'), h);
  assert.equal(sha256For('not a checksum', 'a'), undefined);
});

test('releases follow a GitHub engine repository', () => {
  assert.equal(githubRepo('https://github.com/kenny-21342/realtime-tex'), 'kenny-21342/realtime-tex');
  assert.equal(githubRepo('https://github.com/kenny-21342/realtime-tex.git/'), 'kenny-21342/realtime-tex');
  assert.equal(githubRepo('git@github.com:kenny-21342/realtime-tex.git'), 'kenny-21342/realtime-tex');
  assert.equal(githubRepo('https://gitlab.com/a/b'), undefined);
  assert.equal(githubRepo(''), undefined);
  assert.equal(
    assetUrl('v0.0.3', releaseTarget('darwin', 'arm64')!, 'kenny-21342/realtime-tex'),
    'https://github.com/kenny-21342/realtime-tex/releases/download/v0.0.3/rtex-aarch64-apple-darwin.tar.gz',
  );
});

test('versions order like semver, main builds between releases', () => {
  assert.ok(compareVersions('0.0.2-main.5', '0.0.1') > 0);
  assert.ok(compareVersions('0.0.2-main.5', '0.0.2') < 0);
  assert.ok(compareVersions('0.0.2-main.10', '0.0.2-main.9') > 0);
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0);
  assert.ok(compareVersions('0.1.0', '0.0.9') > 0);
  assert.ok(compareVersions('0.0.3-main.1', '0.0.2-main.99') > 0);
});

test('the extension package is found in a release', () => {
  const a = vsixAsset([
    { name: 'notes.txt', browser_download_url: 'u0' },
    { name: 'realtime-tex-0.0.2-main.7.vsix.sha256', browser_download_url: 'u2' },
    { name: 'realtime-tex-0.0.2-main.7.vsix', browser_download_url: 'u1' },
  ]);
  assert.deepEqual(a, { name: 'realtime-tex-0.0.2-main.7.vsix', version: '0.0.2-main.7', url: 'u1', sha256Url: 'u2' });
  assert.equal(vsixAsset([{ name: 'rtex-x86_64-unknown-linux-gnu.tar.gz', browser_download_url: 'x' }]), undefined);
});
