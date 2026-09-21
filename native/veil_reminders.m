#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>

static void fail(NSString *message, int code) {
  fprintf(stderr, "veil reminders: %s\n", message.UTF8String);
  exit(code);
}
static NSString *safe(NSString *value) {
  return [[value ?: @"" componentsSeparatedByCharactersInSet:NSCharacterSet.controlCharacterSet] componentsJoinedByString:@" "];
}
static void help(void) {
  puts("veil reminders                         List incomplete reminders with IDs\n"
       "veil reminders lists                   Show list names and IDs\n"
       "veil reminders list [list name or ID]   Filter incomplete reminders\n"
       "veil reminders add \"title\" [list]      Add to a list (or your default list)\n"
       "    --notes \"description\"              Include the reminder's Notes text\n"
       "veil reminders done <ID>                Complete the exact reminder\n"
       "veil reminders help                     Show this help without requesting access");
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
    NSString *command = argc > 1 ? args[1] : @"list";
    if ([command isEqual:@"help"] || [command isEqual:@"--help"]) { help(); return 0; }
    BOOL listing = [command isEqual:@"list"], lists = [command isEqual:@"lists"];
    BOOL adding = [command isEqual:@"add"], completing = [command isEqual:@"done"];
    if (!((listing && argc <= 3) || (lists && argc == 2) ||
          (adding && argc >= 3) || (completing && argc == 3))) {
      help(); return 2;
    }
    if (adding && ![args[2] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length)
      fail(@"A reminder title is required.", 2);
    NSString *addList = nil, *notes = nil;
    if (adding) {
      for (NSUInteger i = 3; i < args.count; i++) {
        if ([args[i] isEqual:@"--notes"]) {
          if (notes != nil || i + 1 >= args.count)
            fail(@"Use --notes once, followed by a quoted description.", 2);
          notes = args[++i];
        } else if ([args[i] hasPrefix:@"--"] || addList != nil) {
          fail(@"Expected one optional list and --notes \"description\".", 2);
        } else addList = args[i];
      }
    }

    EKEventStore *store = [EKEventStore new];
    void (^perform)(void) = ^{
      NSArray<EKCalendar *> *calendars = [store calendarsForEntityType:EKEntityTypeReminder];
      if (lists) {
        for (EKCalendar *calendar in calendars)
          printf("%s  %s%s\n", safe(calendar.calendarIdentifier).UTF8String,
                 safe(calendar.title).UTF8String, calendar.allowsContentModifications ? "" : " (read-only)");
        exit(0);
      }
      NSString *requestedList = listing && argc == 3 ? args[2] : adding ? addList : nil;
      EKCalendar *selected = nil;
      if (requestedList) {
        NSMutableArray *matches = [NSMutableArray new];
        for (EKCalendar *calendar in calendars) {
          if ([calendar.calendarIdentifier isEqual:requestedList]) { selected = calendar; break; }
          if ([calendar.title isEqual:requestedList]) [matches addObject:calendar];
        }
        if (!selected) {
          if (matches.count != 1) fail(@"List missing or ambiguous. Run 'veil reminders lists' and use its ID.", 2);
          selected = matches.firstObject;
        }
      }
      NSError *error = nil;
      if (adding) {
        selected = selected ?: store.defaultCalendarForNewReminders;
        if (!selected || !selected.allowsContentModifications) fail(@"No writable reminder list. Create one in Apple Reminders or specify another list.", 1);
        EKReminder *reminder = [EKReminder reminderWithEventStore:store];
        reminder.calendar = selected;
        reminder.title = args[2];
        reminder.notes = notes;
        if (![store saveReminder:reminder commit:YES error:&error]) fail(error.localizedDescription, 1);
        printf("Added %s  %s\n", safe(reminder.calendarItemIdentifier).UTF8String, safe(reminder.title).UTF8String);
        exit(0);
      }
      if (completing) {
        EKCalendarItem *item = [store calendarItemWithIdentifier:args[2]];
        if (![item isKindOfClass:EKReminder.class]) fail(@"Reminder not found. Copy its full ID from 'veil reminders'.", 2);
        EKReminder *reminder = (EKReminder *)item;
        if (!reminder.calendar.allowsContentModifications) fail(@"This reminder belongs to a read-only list.", 1);
        if (!reminder.completed) {
          reminder.completed = YES;
          if (![store saveReminder:reminder commit:YES error:&error]) fail(error.localizedDescription, 1);
        }
        puts("Reminder completed.");
        exit(0);
      }
      NSPredicate *predicate = [store predicateForIncompleteRemindersWithDueDateStarting:nil ending:nil
        calendars:selected ? @[selected] : nil];
      [store fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *reminders) {
        if (!reminders) fail(@"Could not read reminders. Check Reminders access in System Settings.", 1);
        NSArray *sorted = [reminders sortedArrayUsingComparator:^NSComparisonResult(EKReminder *a, EKReminder *b) {
          NSComparisonResult result = [(a.calendar.title ?: @"") compare:(b.calendar.title ?: @"")];
          return result == NSOrderedSame ? [(a.title ?: @"") compare:(b.title ?: @"")] : result;
        }];
        for (EKReminder *reminder in sorted)
          printf("%s  [%s] %s\n", safe(reminder.calendarItemIdentifier).UTF8String,
            safe(reminder.calendar.title).UTF8String, safe(reminder.title).UTF8String);
        if (!sorted.count) puts("No incomplete reminders.");
        exit(0);
      }];
    };
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder];
    if (status == EKAuthorizationStatusDenied || status == EKAuthorizationStatusRestricted)
      fail(@"Access denied. Enable Reminders access for Veil (or the launching terminal) in System Settings > Privacy & Security > Reminders.", 1);
    if (status == EKAuthorizationStatusNotDetermined) {
      void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (!granted) fail(error.localizedDescription ?: @"Reminders permission was not granted.", 1);
          perform();
        });
      };
      if (@available(macOS 14.0, *)) [store requestFullAccessToRemindersWithCompletion:completion];
      else [store requestAccessToEntityType:EKEntityTypeReminder completion:completion];
    } else perform();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      fail(@"Timed out waiting for Reminders. Retry after responding to any permission prompt.", 1);
    });
    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
