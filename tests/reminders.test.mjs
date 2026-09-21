import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
const veil = resolve(import.meta.dirname, '../bin/veil');

test('Reminders dispatch and validation work without accessing personal reminders', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'veil-reminders-test-'));
  try {
    const env = {...process.env, XDG_CONFIG_HOME:join(scratch, 'config')};
    const link = join(scratch, 'veil');
    await symlink(veil, link);
    const {stdout} = await run(link, ['reminders', 'help'], {env});
    assert.match(stdout, /veil reminders done <ID>/);
    assert.match(stdout, /--notes "description"/);
    for (const args of [['unknown'], ['done'], ['add', ''], ['lists', 'extra'],
      ['add', 'Coffee', '--notes'], ['add', 'Coffee', 'Personal', '--notes'],
      ['add', 'Coffee', '--notes', 'Milk', '--notes', 'Beans'],
      ['add', 'Coffee', '--unknown', 'Milk'], ['add', 'Coffee', 'Personal', 'Extra']])
      await assert.rejects(run(link, ['reminders', ...args], {env}), error => error.code === 2);
    await assert.rejects(access(env.XDG_CONFIG_HOME), 'Reminders must bypass appearance config');
  } finally { await rm(scratch, {recursive:true, force:true}); }
});
