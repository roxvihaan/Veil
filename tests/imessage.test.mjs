import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, symlink, rm, access, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('iMessage help and invalid commands bypass data access and config', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'veil-imessage-'));
  try {
    const env = {...process.env, XDG_CONFIG_HOME:join(scratch,'config')};
    const link = join(scratch,'veil');
    await symlink(join(root,'bin/veil'),link);
    const {stdout} = await run(link,['imessage','help'],{env});
    assert.match(stdout,/veil messages send/);
    assert.match(stdout,/veil messages contacts/);
    assert.equal((await run(link,['messages','help'],{env})).stdout,stdout);
    for (const args of [['unknown'], ['read'], ['read','0'], ['read','1;DROP TABLE chat'],
      ['read','9223372036854775808'], ['read','1','201'], ['chats','0'], ['chats','2','extra'],
      ['send'], ['send','someone','text'], ['send','+15555550123',' '], ['send','a\nb@example.com','text']])
      for (const command of ['messages','imessage'])
        await assert.rejects(run(link,[command,...args],{env}), e => e.code === 2);
    await assert.rejects(access(env.XDG_CONFIG_HOME));
  } finally { await rm(scratch,{recursive:true,force:true}); }
});

test('iMessage reads synthetic history read-only, filters services, limits and escapes content', async () => {
  const scratch = await mkdtemp(join(tmpdir(),'veil-imessage-db-'));
  try {
    const db = join(scratch,'chat.db');
    const helper = join(scratch,'imessage');
    await run('/usr/bin/sqlite3',[db, `
      CREATE TABLE chat (chat_identifier TEXT, display_name TEXT, service_name TEXT);
      CREATE TABLE message (is_from_me INTEGER, handle_id INTEGER, text TEXT, date INTEGER);
      CREATE TABLE handle (id TEXT);
      CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
      CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
      INSERT INTO chat VALUES ('friend@example.com','','iMessage'),('sms','','SMS'),('group-unnamed','','iMessage'),('group-named','Family','iMessage');
      INSERT INTO handle VALUES ('friend@example.com'),('+15555550123');
      INSERT INTO chat_handle_join VALUES (1,1),(3,1),(3,2),(4,1),(4,2);
      INSERT INTO message VALUES (0,1,'older',700000000000000000),
        (1,1,'hello'||char(27)||'[31m'||char(10)||'world',700000001000000000),
        (0,1,NULL,700000002000000000),(0,1,'SMS secret',700000003000000000);
      INSERT INTO chat_message_join VALUES (1,1),(1,2),(1,3),(2,4);
    `]);
    const before = await readFile(db);
    await run('xcrun',['clang','-fobjc-arc','-framework','Foundation','-framework','Carbon','-framework','Contacts','-lsqlite3',
      `-DVEIL_IMESSAGE_TEST_DATABASE="${db}"`,join(root,'native/veil_imessage.m'),'-o',helper]);
    const chats = (await run(helper,['chats'])).stdout;
    assert.match(chats,/1  friend@example.com/);
    assert.doesNotMatch(chats,/sms/);
    assert.match(chats,/3  \+15555550123, friend@example.com/);
    assert.match(chats,/4  Family/);
    const history = (await run(helper,['read','1','2'])).stdout;
    assert.doesNotMatch(history,/older|SMS secret|\x1b/);
    assert.match(history,/You: hello \[31m world/);
    assert.match(history,/Attachment or rich message/);
    assert.ok(history.indexOf('You:') < history.indexOf('Attachment'));
    assert.match((await run(helper,['read','2'])).stdout,/No local iMessage messages/);
    assert.deepEqual(await readFile(db),before);
  } finally { await rm(scratch,{recursive:true,force:true}); }
});

// Compile the real send script without running it or sending anything.
test('send AppleScript compiles against the installed Messages dictionary', async () => {
  const scratch = await mkdtemp(join(tmpdir(),'veil-imessage-script-'));
  try {
    const source = await readFile(join(root,'native/veil_imessage.m'),'utf8');
    const literal = source.split('NSString *source = ')[1].split(';')[0];
    const script = [...literal.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m => JSON.parse(m[0])).join('');
    const path = join(scratch,'send.applescript');
    await writeFile(path,script);
    await run('/usr/bin/osacompile',['-o',join(scratch,'send.scpt'),path]);
  } finally { await rm(scratch,{recursive:true,force:true}); }
});

// Fake store exercises the production resolver without reading personal contacts.
test('Messages contact names cache lookups and preserve unknown or ambiguous addresses', async () => {
  const scratch = await mkdtemp(join(tmpdir(),'veil-message-names-'));
  try {
    const source = join(scratch,'names.m');
    await writeFile(source,`
#import <Foundation/Foundation.h>
#import "${join(root,'native/messages_contact_names.h')}"
#include <assert.h>
@interface FixtureStore : CNContactStore
@property(nonatomic,strong) NSArray *results;
@property(nonatomic) int calls;
@property(nonatomic) BOOL fail;
@end
@implementation FixtureStore
- (NSArray *)unifiedContactsMatchingPredicate:(NSPredicate *)predicate keysToFetch:(NSArray *)keys error:(NSError **)error {
  self.calls++;
  assert(predicate != nil);
  if (self.fail) { *error = [NSError errorWithDomain:@"fixture" code:1 userInfo:nil]; return nil; }
  return self.results;
}
@end
int main(void) { @autoreleasepool {
  VeilContactNames *names = [VeilContactNames new];
  assert([[names displayName:@"+15555550123"] isEqual:@"+15555550123"]);
  FixtureStore *store = [FixtureStore new]; names.store = store;
  CNMutableContact *alex = [CNMutableContact new]; alex.givenName = @"Alex";
  store.results = @[alex];
  assert([[names displayName:@"+1 (555) 555-0123"] isEqual:@"Alex"]);
  assert([[names displayName:@"+1 (555) 555-0123"] isEqual:@"Alex"]);
  assert(store.calls == 1);
  assert([[names displayName:@"ALEX@example.com"] isEqual:@"Alex"]);
  assert(store.calls == 2);
  assert([[names displayName:@"chat123"] isEqual:@"chat123"]);
  assert(store.calls == 2);
  store.results = @[];
  assert([[names displayName:@"unknown@example.com"] isEqual:@"unknown@example.com"]);
  CNMutableContact *other = [CNMutableContact new]; other.givenName = @"Other";
  store.results = @[alex,other];
  assert([[names displayName:@"shared@example.com"] isEqual:@"shared@example.com"]);
  store.results = @[[CNMutableContact new]];
  assert([[names displayName:@"nameless@example.com"] isEqual:@"nameless@example.com"]);
  store.fail = YES;
  assert([[names displayName:@"failed@example.com"] isEqual:@"failed@example.com"]);
} return 0; }
`);
    const exe = join(scratch,'names');
    await run('xcrun',['clang','-fobjc-arc','-framework','Foundation','-framework','Contacts',source,'-o',exe]);
    await run(exe,[]);
  } finally { await rm(scratch,{recursive:true,force:true}); }
});
