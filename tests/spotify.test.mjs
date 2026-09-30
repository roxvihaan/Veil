import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('Spotify help and invalid commands bypass Automation and appearance config', async () => {
  const scratch = await mkdtemp(join(tmpdir(),'veil-spotify-'));
  try {
    const env = {...process.env,XDG_CONFIG_HOME:join(scratch,'config')};
    const link = join(scratch,'veil');
    await symlink(join(root,'bin/veil'),link);
    assert.match((await run(link,['spotify','help'],{env})).stdout,/volume \[0-100\]/);
    for (const args of [['unknown'],['status','extra'],['play','extra'],['pause','extra'],
      ['volume','-1'],['volume','101'],['volume','1.5'],['volume',''],['volume','1','2'],
      ['volume','1\n'],['volume','50; quit'],['volume','999999999999999999999']])
      await assert.rejects(run(link,['spotify',...args],{env}),e => e.code === 2);
    await assert.rejects(access(env.XDG_CONFIG_HOME));
  } finally { await rm(scratch,{recursive:true,force:true}); }
});

test('Spotify script compiles without running or changing playback', async t => {
  try { await access('/Applications/Spotify.app/Contents/Resources/Spotify.sdef'); }
  catch { t.skip('Spotify desktop app is not installed'); return; }
  const scratch = await mkdtemp(join(tmpdir(),'veil-spotify-script-'));
  try {
    await run('/usr/bin/osacompile',['-o',join(scratch,'spotify.scpt'),join(root,'native/spotify.applescript')]);
  } finally { await rm(scratch,{recursive:true,force:true}); }
});
