#import <Contacts/Contacts.h>

// One lookup per distinct address; retain no contact data between commands.
@interface VeilContactNames : NSObject
@property(nonatomic, strong) CNContactStore *store;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *cache;
- (NSString *)displayName:(NSString *)address;
@end
@implementation VeilContactNames
- (instancetype)init {
  if ((self = [super init])) _cache = [NSMutableDictionary new];
  return self;
}
- (NSString *)displayName:(NSString *)address {
  if (!address.length || !self.store) return address;
  if (self.cache[address]) return self.cache[address];
  NSPredicate *predicate = nil;
  if ([address containsString:@"@"]) predicate = [CNContact predicateForContactsMatchingEmailAddress:address];
  else {
    NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"+0123456789 ()-."];
    if ([address rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound &&
        [address rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet].location != NSNotFound)
      predicate = [CNContact predicateForContactsMatchingPhoneNumber:[[CNPhoneNumber alloc] initWithStringValue:address]];
  }
  NSString *label = address;
  if (predicate) {
    NSError *error = nil;
    NSArray<CNContact *> *matches = [self.store unifiedContactsMatchingPredicate:predicate keysToFetch:
      @[[CNContactFormatter descriptorForRequiredKeysForStyle:CNContactFormatterStyleFullName]] error:&error];
    // Never guess between different people sharing an address.
    if (!error && matches.count == 1) {
      NSString *name = [CNContactFormatter stringFromContact:matches.firstObject style:CNContactFormatterStyleFullName];
      if (name.length) label = name;
    }
  }
  self.cache[address] = label;
  return label;
}
@end

static VeilContactNames *contactNames(void) {
  VeilContactNames *names = [VeilContactNames new];
#ifdef VEIL_IMESSAGE_TEST_DATABASE
  // Fixture reads must never access the real address book or trigger TCC.
  return names;
#else
  CNContactStore *store = [CNContactStore new];
  CNAuthorizationStatus status = [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts];
  if (status == CNAuthorizationStatusNotDetermined) {
    __block BOOL finished = NO;
    [store requestAccessForEntityType:CNEntityTypeContacts completionHandler:^(BOOL granted, NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{ finished = YES; });
    }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:120];
    while (!finished && deadline.timeIntervalSinceNow > 0)
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    status = [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts];
  }
  if (status == CNAuthorizationStatusAuthorized) names.store = store;
  if (!names.store) fputs("veil messages: Contact names unavailable. Enable Contacts access in System Settings → Privacy & Security → Contacts; showing addresses instead.\n",stderr);
  return names;
#endif
}
