#import <Foundation/Foundation.h>
#import <Carbon/Carbon.h>
#import <sqlite3.h>
#import "messages_contact_names.h"

static void usage(void) {
  puts("Usage: veil messages [chats [limit]]\n"
       "       veil messages read <chat-ID> [limit]\n"
       "       veil messages send <phone-or-email> <text>\n"
       "       veil messages contacts [list|search|help]\n"
       "       veil messages help\n\n"
       "Lists iMessage chats only. Limits: 1–200 (default 20).\n"
       "Reading requires Full Disk Access for the launching terminal.\n"
       "Contact names require Contacts permission; unavailable names fall back to addresses.\n"
       "Sending uses Messages and requests Automation permission.\n"
       "Send submits immediately; Messages handles delivery.");
}
static NSString *clean(NSString *value) {
  // Remote message content must never execute terminal control sequences.
  NSMutableString *out = [NSMutableString string];
  NSCharacterSet *controls = [NSCharacterSet controlCharacterSet];
  for (NSUInteger i = 0; i < value.length; i++) {
    unichar c = [value characterAtIndex:i];
    if ([controls characterIsMember:c] || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069))
      [out appendString:@" "];
    else [out appendFormat:@"%C", c];
  }
  return out;
}
static NSString *column(sqlite3_stmt *stmt, int index) {
  const unsigned char *text = sqlite3_column_text(stmt, index);
  return text ? ([NSString stringWithUTF8String:(const char *)text] ?: @"") : @"";
}
static BOOL positive(NSString *s, long long max) {
  if (!s.length || [s rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789"] invertedSet]].location != NSNotFound) return NO;
  errno = 0;
  long long n = strtoll(s.UTF8String, NULL, 10);
  return errno == 0 && n > 0 && n <= max;
}
static int sendMessage(NSString *recipient, NSString *body) {
  VeilContactNames *names = contactNames();
  NSString *recipientName = [names displayName:recipient];
  // Keep user input in descriptors, never interpolate it into AppleScript source.
  NSString *source = @"on run argv\n"
    "set destination to item 1 of argv\nset bodyText to item 2 of argv\n"
    "tell application \"/System/Applications/Messages.app\"\n"
    "set imAccount to first account whose service type is iMessage and enabled is true\n"
    "set targetPerson to participant destination of imAccount\n"
    "send bodyText to targetPerson\nend tell\nend run";
  NSAppleScript *script = [[NSAppleScript alloc] initWithSource:source];
  NSAppleEventDescriptor *args = [NSAppleEventDescriptor listDescriptor];
  [args insertDescriptor:[NSAppleEventDescriptor descriptorWithString:recipient] atIndex:1];
  [args insertDescriptor:[NSAppleEventDescriptor descriptorWithString:body] atIndex:2];
  NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:kCoreEventClass
    eventID:kAEOpenApplication targetDescriptor:nil returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
  [event setParamDescriptor:args forKeyword:keyDirectObject];
  NSDictionary *error = nil;
  if (![script executeAppleEvent:event error:&error]) {
    fprintf(stderr, "veil messages: %s\nCheck Messages sign-in and System Settings → Privacy & Security → Automation for your terminal. Check the conversation before retrying; delivery may be uncertain.\n",
      clean(error[NSAppleScriptErrorMessage] ?: @"Messages could not accept the message.").UTF8String);
    return 1;
  }
  printf("Submitted to Messages for %s. Delivery is managed by Messages.\n",clean(recipientName).UTF8String);
  return 0;
}
static int readMessages(BOOL chats, long long chatID, int limit) {
  // A fixture path is compiled in ONLY for the separate test executable.
#ifdef VEIL_IMESSAGE_TEST_DATABASE
  NSString *path = @VEIL_IMESSAGE_TEST_DATABASE;
#else
  NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Messages/chat.db"];
#endif
  sqlite3 *db = NULL;
  if (sqlite3_open_v2(path.fileSystemRepresentation, &db, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK) {
    fputs("veil messages: Cannot read the local Messages database. Sign in to Messages, then enable Full Disk Access for Veil (or the terminal running this command) in System Settings → Privacy & Security.\n", stderr);
    if (db) sqlite3_close(db);
    return 1;
  }
  sqlite3_busy_timeout(db, 1500);
  const char *sql = chats ?
    "SELECT c.ROWID, COALESCE(c.display_name,''), c.chat_identifier, MAX(m.date) "
    "FROM chat c LEFT JOIN chat_message_join j ON j.chat_id=c.ROWID "
    "LEFT JOIN message m ON m.ROWID=j.message_id WHERE c.service_name='iMessage' "
    "GROUP BY c.ROWID ORDER BY MAX(m.date) DESC,c.ROWID DESC LIMIT ?1" :
    "SELECT m.is_from_me, COALESCE(h.id,''), m.text, m.date "
    "FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID "
    "JOIN chat c ON c.ROWID=j.chat_id LEFT JOIN handle h ON h.ROWID=m.handle_id "
    "WHERE c.ROWID=?1 AND c.service_name='iMessage' ORDER BY m.date DESC,m.ROWID DESC LIMIT ?2";
  sqlite3_stmt *stmt = NULL;
  int status = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
  NSMutableArray<NSString *> *rows = [NSMutableArray array];
  if (status == SQLITE_OK) {
    sqlite3_bind_int64(stmt, 1, chats ? limit : chatID);
    if (!chats) sqlite3_bind_int(stmt, 2, limit);
    VeilContactNames *names = contactNames();
    sqlite3_stmt *participants = NULL;
    if (chats) sqlite3_prepare_v2(db,
      "SELECT h.id FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id WHERE j.chat_id=?1 ORDER BY h.id",
      -1,&participants,NULL);
    NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
    while ((status = sqlite3_step(stmt)) == SQLITE_ROW) {
      if (chats) {
        NSString *label = column(stmt,1);
        if (!label.length) {
          NSMutableArray<NSString *> *people = [NSMutableArray new];
          if (participants) {
            sqlite3_reset(participants);
            sqlite3_bind_int64(participants,1,sqlite3_column_int64(stmt,0));
            int participantStatus;
            while ((participantStatus = sqlite3_step(participants)) == SQLITE_ROW)
              [people addObject:[names displayName:column(participants,0)]];
            if (participantStatus != SQLITE_DONE) [people removeAllObjects];
          }
          label = people.count ? [people componentsJoinedByString:@", "] : [names displayName:column(stmt,2)];
        }
        [rows addObject:[NSString stringWithFormat:@"%lld  %@",sqlite3_column_int64(stmt,0),clean(label)]];
      }
      else {
        double date = sqlite3_column_double(stmt,3);
        // Older databases store seconds; current Messages uses nanoseconds since 2001.
        if (fabs(date) > 1e11) date /= 1e9;
        NSString *timestamp = [formatter stringFromDate:[NSDate dateWithTimeIntervalSinceReferenceDate:date]];
        NSString *sender = sqlite3_column_int(stmt,0) ? @"You" : [names displayName:column(stmt,1)];
        NSString *body = column(stmt,2);
        if (!body.length) body = @"[Attachment or rich message — view in Messages]";
        [rows addObject:[NSString stringWithFormat:@"%@  %@: %@", timestamp, clean(sender), clean(body)]];
      }
    }
    if (participants) sqlite3_finalize(participants);
  }
  if (stmt) sqlite3_finalize(stmt);
  sqlite3_close(db);
  if (status != SQLITE_DONE) {
    fputs("veil messages: Cannot query Messages history (database busy or unsupported schema). No data was changed.\n", stderr);
    return 1;
  }
  if (!rows.count) puts(chats ? "No local iMessage chats." : "No local iMessage messages for that chat ID.");
  else for (NSString *row in chats ? rows : rows.reverseObjectEnumerator) puts(row.UTF8String);
  return 0;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *args = [[NSProcessInfo processInfo].arguments subarrayWithRange:NSMakeRange(1, argc-1)];
    NSString *command = args.count ? args[0] : @"chats";
    if ([@[@"help", @"--help", @"-h"] containsObject:command] && args.count == 1) { usage(); return 0; }
    if ([command isEqual:@"send"] && args.count == 3) {
      NSString *recipient = args[1];
      BOOL email = [recipient rangeOfString:@"@"].location != NSNotFound;
      NSCharacterSet *phoneChars = [NSCharacterSet characterSetWithCharactersInString:@"+0123456789"];
      BOOL phone = [recipient rangeOfCharacterFromSet:phoneChars.invertedSet].location == NSNotFound &&
        [recipient rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet].location != NSNotFound;
      if (recipient.length && (email || phone) && [recipient rangeOfCharacterFromSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].location == NSNotFound &&
          [recipient rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location == NSNotFound &&
          [args[2] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length)
        return sendMessage(recipient,args[2]);
    } else if ([command isEqual:@"chats"] && args.count <= 2) {
      if (args.count < 2 || positive(args[1],200)) return readMessages(YES,0,args.count == 2 ? args[1].intValue : 20);
    } else if ([command isEqual:@"read"] && (args.count == 2 || args.count == 3)) {
      if (positive(args[1],LLONG_MAX) && (args.count == 2 || positive(args[2],200)))
        return readMessages(NO,args[1].longLongValue,args.count == 3 ? args[2].intValue : 20);
    }
    usage(); return 2;
  }
}
