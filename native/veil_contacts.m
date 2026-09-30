#import <Foundation/Foundation.h>
#import <Contacts/Contacts.h>

static void help(void) {
  puts("Usage: veil messages contacts [list [limit]]\n"
       "       veil messages contacts search <name-or-phone-or-email> [limit]\n"
       "       veil messages contacts help\n\n"
       "Lists names, phone numbers and emails from Apple Contacts.\n"
       "Limits: 1–200 (default 20). Read-only; never sends messages.\n"
       "The first data command requests macOS Contacts permission.");
}
static NSString *safe(NSString *value) {
  NSMutableString *result = [NSMutableString new];
  for (NSUInteger i=0; i<value.length; i++) {
    unichar c = [value characterAtIndex:i];
    if ([NSCharacterSet.controlCharacterSet characterIsMember:c] ||
        (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) [result appendString:@" "];
    else [result appendFormat:@"%C",c];
  }
  return result;
}
static NSString *name(CNContact *contact) {
  NSString *full = [CNContactFormatter stringFromContact:contact style:CNContactFormatterStyleFullName];
  return full.length ? full : contact.organizationName.length ? contact.organizationName : @"(Unnamed contact)";
}
static NSString *digits(NSString *value) {
  return [[value componentsSeparatedByCharactersInSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789"] invertedSet]] componentsJoinedByString:@""];
}
static BOOL contains(NSString *value, NSString *query) {
  return [value rangeOfString:query options:NSCaseInsensitiveSearch|NSDiacriticInsensitiveSearch].location != NSNotFound;
}
static BOOL matches(CNContact *contact, NSString *query) {
  if (!query || contains(name(contact),query) || contains(contact.organizationName,query)) return YES;
  for (CNLabeledValue<NSString *> *email in contact.emailAddresses) if (contains(email.value,query)) return YES;
  NSString *number = digits(query);
  BOOL phoneQuery = number.length && [query rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789+(). -"] invertedSet]].location == NSNotFound;
  for (CNLabeledValue<CNPhoneNumber *> *phone in contact.phoneNumbers) {
    if (contains(phone.value.stringValue,query) || (phoneQuery && contains(digits(phone.value.stringValue),number))) return YES;
  }
  return NO;
}
static NSString *format(CNContact *contact) {
  NSMutableString *out = [NSMutableString stringWithFormat:@"%@\n",safe(name(contact))];
  for (CNLabeledValue<CNPhoneNumber *> *phone in contact.phoneNumbers)
    [out appendFormat:@"  Phone (%@): %@\n",safe(phone.label ? [CNLabeledValue localizedStringForLabel:phone.label] : @"phone"),safe(phone.value.stringValue)];
  for (CNLabeledValue<NSString *> *email in contact.emailAddresses)
    [out appendFormat:@"  Email (%@): %@\n",safe(email.label ? [CNLabeledValue localizedStringForLabel:email.label] : @"email"),safe(email.value)];
  if (!contact.phoneNumbers.count && !contact.emailAddresses.count) [out appendString:@"  No phone number or email.\n"];
  return out;
}
static BOOL validLimit(NSString *s) {
  return s.length > 0 && s.length <= 3 &&
    [s rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789"] invertedSet]].location == NSNotFound &&
    s.intValue >= 1 && s.intValue <= 200;
}
static void denied(void) {
  fputs("veil messages contacts: Access denied. Enable Contacts for Veil (or the launching terminal) in System Settings → Privacy & Security → Contacts.\n",stderr);
  exit(1);
}
static int listContacts(CNContactStore *store, NSString *query, int limit) {
  NSArray *keys = @[[CNContactFormatter descriptorForRequiredKeysForStyle:CNContactFormatterStyleFullName],
    CNContactOrganizationNameKey,CNContactPhoneNumbersKey,CNContactEmailAddressesKey];
  CNContactFetchRequest *request = [[CNContactFetchRequest alloc] initWithKeysToFetch:keys];
  request.sortOrder = CNContactSortOrderUserDefault;
  NSMutableArray<NSString *> *rows = [NSMutableArray new];
  __block BOOL more = NO;
  NSError *error = nil;
  BOOL success = [store enumerateContactsWithFetchRequest:request error:&error usingBlock:^(CNContact *contact, BOOL *stop) {
    if (!matches(contact,query)) return;
    if (rows.count == limit) { more = YES; *stop = YES; return; }
    [rows addObject:format(contact)];
  }];
  if (!success) {
    fprintf(stderr,"veil messages contacts: %s\n",safe(error.localizedDescription ?: @"Could not read Contacts.").UTF8String);
    return 1;
  }
  if (!rows.count) puts("No matching contacts in the contacts available to Veil.");
  for (NSString *row in rows) printf("%s",row.UTF8String);
  if (more) puts("More matches available. Narrow your search or increase the limit (maximum 200).");
  return 0;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
    NSString *command = argc > 1 ? args[1] : @"list";
    if (argc == 2 && [@[@"help",@"--help",@"-h"] containsObject:command]) { help(); return 0; }
    NSString *query = nil, *limitText = nil;
    if ([command isEqual:@"list"] && argc <= 3) { if (argc == 3) limitText = args[2]; }
    else if ([command isEqual:@"search"] && (argc == 3 || argc == 4)) {
      query = [args[2] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
      if (!query.length) { help(); return 2; }
      if (argc == 4) limitText = args[3];
    } else { help(); return 2; }
    if (limitText && !validLimit(limitText)) { help(); return 2; }
    int limit = limitText ? limitText.intValue : 20;
    CNContactStore *store = [CNContactStore new];
    CNAuthorizationStatus status = [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts];
    if (status == CNAuthorizationStatusDenied || status == CNAuthorizationStatusRestricted) denied();
    if (status != CNAuthorizationStatusNotDetermined) return listContacts(store,query,limit);
    [store requestAccessForEntityType:CNEntityTypeContacts completionHandler:^(BOOL granted, NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!granted) denied();
        exit(listContacts(store,query,limit));
      });
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,120*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
      fputs("veil messages contacts: Timed out waiting for permission. Respond to the macOS prompt, then retry.\n",stderr);
      exit(1);
    });
    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
