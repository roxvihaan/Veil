import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readlink, rm, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const filename = `Veil-${version}-arm64.dmg`;
const dmg = join(root, 'release', filename);

test('DMG checksum, Applications shortcut, signed app and image helper survive packaging', {timeout:60000}, async () => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(dmg)) hash.update(chunk);
  assert.equal(await readFile(`${dmg}.sha256`, 'utf8'), `${hash.digest('hex')}  ${filename}\n`);
  await run('hdiutil', ['verify', dmg]);
  const mount = await mkdtemp(join(tmpdir(), 'veil-dmg-test-'));
  let attached = false;
  try {
    await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg]);
    attached = true;
    assert.equal(await readlink(join(mount, 'Applications')), '/Applications');
    const bundle = join(mount, 'Veil Terminal.app');
    await run('codesign', ['--verify', '--deep', '--strict', bundle]);
    const plist = join(bundle, 'Contents/Info.plist');
    const { stdout: bundleVersion } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]);
    assert.equal(bundleVersion.trim(), version);
    const resources = join(bundle, 'Contents/Resources');
    await access(join(resources, 'THIRD_PARTY_NOTICES.md'));
    await access(join(resources, 'LICENSES.chromium.html'));
    await access(join(resources, 'licenses/xterm.txt'));
    const { stdout } = await run(join(resources, 'app/bin/veil'), ['image', join(resources, 'electron.icns')]);
    assert.match(stdout, /\x1b\[38;2;/);
    const { stdout: blurBuild } = await run('xcrun', ['vtool', '-show-build', join(resources, 'app/native/veil_blur.node')]);
    assert.match(blurBuild, /minos 12\.0/);
  } finally {
    // Never recurse into a mounted image if detach fails.
    if (attached) await run('hdiutil', ['detach', mount]);
    await rm(mount, { recursive:true, force:true });
  }
});
