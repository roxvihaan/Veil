import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'native/build/veil-reminders');
await mkdir(join(root, 'native/build'), { recursive:true });
const build = spawnSync('xcrun', ['clang', '-fobjc-arc', '-mmacosx-version-min=12.0',
  '-framework', 'Foundation', '-framework', 'EventKit',
  '-sectcreate', '__TEXT', '__info_plist', join(root, 'native/reminders-info.plist'),
  join(root, 'native/veil_reminders.m'), '-o', output], { stdio:'inherit' });
if (build.status !== 0) throw new Error('Reminders helper compilation failed');
await copyFile(output, join(root, 'bin/veil-reminders'));
if (process.argv.includes('--bundle'))
  await copyFile(output, join(root, 'release/Veil Terminal.app/Contents/Resources/app/bin/veil-reminders'));
