import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'native/build/veil-spotify');
await mkdir(join(root, 'native/build'), { recursive:true });
const build = spawnSync('xcrun', ['clang', '-fobjc-arc', '-mmacosx-version-min=12.0',
  '-framework', 'AppKit', '-framework', 'Carbon',
  '-sectcreate', '__TEXT', '__info_plist', join(root, 'native/spotify-info.plist'),
  join(root, 'native/veil_spotify.m'), '-o', output], { stdio:'inherit' });
if (build.status !== 0) throw new Error('Spotify helper compilation failed');
await copyFile(output, join(root, 'bin/veil-spotify'));
if (process.argv.includes('--bundle'))
  await copyFile(output, join(root, 'release/Veil Terminal.app/Contents/Resources/app/bin/veil-spotify'));

await copyFile(join(root, 'native/spotify.applescript'), join(root, 'bin/veil-spotify.applescript'));
if (process.argv.includes('--bundle'))
  await copyFile(join(root, 'native/spotify.applescript'), join(root, 'release/Veil Terminal.app/Contents/Resources/app/bin/veil-spotify.applescript'));
