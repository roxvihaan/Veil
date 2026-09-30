#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

static void usage(void) {
  puts("Usage: veil spotify [status]\n"
       "       veil spotify play|pause|toggle|next|previous\n"
       "       veil spotify volume [0-100]\n"
       "       veil spotify help\n\n"
       "Controls the Spotify desktop app on this Mac. Open Spotify and sign in first.\n"
       "macOS may request Automation permission for Spotify.");
}
static NSString *clean(NSString *value) {
  NSMutableString *out = [NSMutableString string];
  NSCharacterSet *controls = NSCharacterSet.controlCharacterSet;
  for (NSUInteger i = 0; i < value.length; i++) {
    unichar c = [value characterAtIndex:i];
    if ([controls characterIsMember:c] || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069))
      [out appendString:@" "];
    else [out appendFormat:@"%C",c];
  }
  return out;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *args = [[NSProcessInfo processInfo].arguments subarrayWithRange:NSMakeRange(1,argc-1)];
    if (!args.count) args = @[@"status"];
    NSString *action = args[0];
    if (args.count == 1 && [@[@"help",@"--help",@"-h"] containsObject:action]) { usage(); return 0; }
    BOOL valid = args.count == 1 && [@[@"status",@"play",@"pause",@"toggle",@"next",@"previous",@"volume"] containsObject:action];
    if ([action isEqual:@"volume"] && args.count == 2) {
      NSString *volume = args[1];
      valid = volume.length > 0 && volume.length <= 3 &&
        [volume rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789"] invertedSet]].location == NSNotFound && volume.intValue <= 100;
    }
    if (!valid) { usage(); return 2; }
    if (![[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:@"com.spotify.client"]) {
      fputs("veil spotify: Spotify is not installed. Install the Spotify desktop app, open it and sign in.\n",stderr);
      return 1;
    }
    // Do not launch Spotify or start playback merely to inspect its state.
    if (![NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.spotify.client"].count) {
      fputs("veil spotify: Spotify is not running. Open Spotify and sign in, then try again.\n",stderr);
      return 1;
    }
    NSString *executable = [NSBundle mainBundle].executablePath;
    NSURL *scriptURL = [NSURL fileURLWithPath:[[executable stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"veil-spotify.applescript"]];
    NSDictionary *error = nil;
    NSAppleScript *script = [[NSAppleScript alloc] initWithContentsOfURL:scriptURL error:&error];
    if (!script) {
      fputs("veil spotify: The bundled Spotify script is missing or unreadable. Rebuild or reinstall Veil.\n",stderr);
      return 1;
    }
    NSAppleEventDescriptor *arguments = [NSAppleEventDescriptor listDescriptor];
    for (NSUInteger i=0; i<args.count; i++)
      [arguments insertDescriptor:[NSAppleEventDescriptor descriptorWithString:args[i]] atIndex:i+1];
    NSAppleEventDescriptor *event = [NSAppleEventDescriptor appleEventWithEventClass:kCoreEventClass
      eventID:kAEOpenApplication targetDescriptor:nil returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:arguments forKeyword:keyDirectObject];
    NSAppleEventDescriptor *result = [script executeAppleEvent:event error:&error];
    if (!result) {
      fprintf(stderr,"veil spotify: %s\nCheck Spotify sign-in and System Settings → Privacy & Security → Automation → Spotify for your terminal.\n",
        clean(error[NSAppleScriptErrorMessage] ?: @"Spotify could not complete the command.").UTF8String);
      return 1;
    }
    if ([action isEqual:@"status"]) {
      printf("Spotify: %s · Volume: %s%%\n",clean([result descriptorAtIndex:1].stringValue).UTF8String,
        clean([result descriptorAtIndex:2].stringValue).UTF8String);
      if (result.numberOfItems >= 6) {
        printf("%s — %s\nAlbum: %s\n%s\n",clean([result descriptorAtIndex:3].stringValue).UTF8String,
          clean([result descriptorAtIndex:4].stringValue).UTF8String,clean([result descriptorAtIndex:5].stringValue).UTF8String,
          clean([result descriptorAtIndex:6].stringValue).UTF8String);
      } else puts("No current track.");
    } else if ([action isEqual:@"volume"]) {
      printf("Spotify volume: %s%%\n",clean([result descriptorAtIndex:1].stringValue).UTF8String);
    } else printf("Spotify: %s command accepted.\n",action.UTF8String);
    return 0;
  }
}
