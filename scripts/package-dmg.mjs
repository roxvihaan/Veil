import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The current DMG release is supported only on Apple Silicon macOS.');
}
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const appBundle = join(root, 'release/Veil Terminal.app');
const filename = `Veil-${version}-arm64.dmg`;
const destination = join(root, 'release', filename);
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding:'utf8', stdio:capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.status}`);
  return result.stdout?.trim();
}
try {
  await access(destination);
  throw new Error(`Refusing to replace ${filename}. Bump the version for a new release.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
run('codesign', ['--verify', '--deep', '--strict', appBundle]);
const bundledVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(appBundle, 'Contents/Info.plist')], true);
if (bundledVersion !== version) throw new Error('App version is stale; run npm run package:mac first');

// Keep packaging-only Python dependencies isolated from the user's Python.
const python = join(root, '.cache/dmg-venv/bin/python');
try { await access(python); }
catch { run('python3', ['-m', 'venv', join(root, '.cache/dmg-venv')]); }
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(root, 'scripts/requirements-dmg.txt')]);
await mkdir(join(root, 'native/build'), {recursive:true});
const backgroundTool = join(root, 'native/build/dmg-background');
const background = join(root, '.cache/dmg-background.tiff');
run('xcrun', ['clang', '-fobjc-arc', '-mmacosx-version-min=12.0', '-framework', 'AppKit',
  join(root, 'native/dmg_background.m'), '-o', backgroundTool]);
run(backgroundTool, [background]);

// Only this newly-created staging directory is cleaned up. Published DMGs
// and installed/live app bundles are never overwritten by this script.
const staging = await mkdtemp(join(root, 'release/.dmg-stage-'));
try {
  const temporaryDmg = join(staging, filename);
  run(python, ['-m', 'dmgbuild', '-s', join(root, 'scripts/dmg-settings.py'),
    '-D', `app=${appBundle}`, '-D', `background=${background}`, '-D', `icon=${join(root, 'assets/veil.icns')}`,
    'Veil Terminal', temporaryDmg]);
  run('hdiutil', ['verify', temporaryDmg]);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(temporaryDmg)) hash.update(chunk);
  const checksum = hash.digest('hex');
  await rename(temporaryDmg, destination);
  await writeFile(`${destination}.sha256`, `${checksum}  ${filename}\n`);
  console.log(`Created ${destination}\nSHA-256: ${checksum}`);
} finally {
  await rm(staging, { recursive:true, force:true });
}
