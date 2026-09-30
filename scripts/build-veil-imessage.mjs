import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'native/build/veil-imessage');
await mkdir(join(root, 'native/build'), { recursive:true });
const build = spawnSync('xcrun', ['clang', '-fobjc-arc', '-mmacosx-version-min=12.0',
  '-framework', 'Foundation', '-framework', 'Carbon', '-framework', 'Contacts', '-lsqlite3',
  '-sectcreate', '__TEXT', '__info_plist', join(root, 'native/imessage-info.plist'),
  join(root, 'native/veil_imessage.m'), '-o', output], { stdio:'inherit' });
if (build.status !== 0) throw new Error('iMessage helper compilation failed');
await copyFile(output, join(root, 'bin/veil-imessage'));
if (process.argv.includes('--bundle'))
  await copyFile(output, join(root, 'release/Veil Terminal.app/Contents/Resources/app/bin/veil-imessage'));
