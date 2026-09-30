import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,symlink,rm,access,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const run = promisify(execFile);
const root = resolve(import.meta.dirname,'..');

test('Contacts help and validation bypass permission requests and appearance config',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'veil-contacts-'));
  try {
    const env={...process.env,XDG_CONFIG_HOME:join(scratch,'config')};
    const link=join(scratch,'veil');
    await symlink(join(root,'bin/veil'),link);
    const help = (await run(link,['messages','contacts','help'],{env})).stdout;
    assert.match(help,/veil messages contacts search/);
    assert.equal((await run(link,['contacts','help'],{env})).stdout,help);
    assert.equal((await run(link,['imessage','contacts','help'],{env})).stdout,help);
    for(const args of [['unknown'],['search'],['search',' '],['list','0'],['list','201'],
      ['list','1.5'],['list','2','extra'],['search','Alex','-1'],['search','Alex','20','extra'],['help','extra']])
      for (const prefix of [['messages','contacts'],['imessage','contacts'],['contacts']])
        await assert.rejects(run(link,[...prefix,...args],{env}),e=>e.code===2);
    await assert.rejects(access(env.XDG_CONFIG_HOME));
  } finally {await rm(scratch,{recursive:true,force:true});}
});

test('Synthetic Contacts match names, formatted phones and emails, and escape terminal controls',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'veil-contacts-fixture-'));
  try {
    const source=join(scratch,'fixture.m');
    await writeFile(source,`
#define main veil_contacts_main
#include "${join(root,'native/veil_contacts.m')}"
#undef main
#include <assert.h>
int main(void) { @autoreleasepool {
  CNMutableContact *c = [CNMutableContact new];
  c.givenName = @"José"; c.familyName = @"Example";
  c.phoneNumbers = @[[CNLabeledValue labeledValueWithLabel:CNLabelPhoneNumberMobile value:[[CNPhoneNumber alloc] initWithStringValue:@"+1 (555) 123-4567"]]];
  c.emailAddresses = @[[CNLabeledValue labeledValueWithLabel:CNLabelHome value:@"jose@example.invalid"]];
  assert(matches(c,@"JOSE")); assert(matches(c,@"555123"));
  assert(matches(c,@"EXAMPLE.INVALID")); assert(!matches(c,@"unknown555"));
  NSString *out = format(c);
  assert([out containsString:@"+1 (555) 123-4567"]);
  assert([out containsString:@"jose@example.invalid"]);
  c.givenName = @"Unsafe\\033[31m\\nName";
  assert([format(c) rangeOfString:@"\\033"].location == NSNotFound);
  assert(!validLimit(@"99999999999999999999"));
  assert(validLimit(@"1") && validLimit(@"200"));
  CNMutableContact *blank = [CNMutableContact new];
  assert([format(blank) containsString:@"No phone number or email"]);
} return 0; }
`);
    const exe=join(scratch,'fixture');
    await run('xcrun',['clang','-fobjc-arc','-framework','Foundation','-framework','Contacts',source,'-o',exe]);
    await run(exe,[]);
  } finally {await rm(scratch,{recursive:true,force:true});}
});
