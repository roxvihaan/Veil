#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// A separate process keeps AX timeouts entirely off Electron's PTY/UI threads.
static NSMutableDictionary<NSString *, id> *windows;
static AXUIElementRef selected;
static NSString *selectedID;
static NSDictionary *pendingBounds;
static unsigned missingFrames;
static void emit(NSDictionary *message) {
  NSData *data=[NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if(data){ fwrite(data.bytes,1,data.length,stdout); fputc('\n',stdout); fflush(stdout); }
}
static id attribute(AXUIElementRef element, CFStringRef key) {
  CFTypeRef value=NULL;
  if(AXUIElementCopyAttributeValue(element,key,&value)!=kAXErrorSuccess)return nil;
  return CFBridgingRelease(value);
}
static NSDictionary *bounds(AXUIElementRef window) {
  id p=attribute(window,kAXPositionAttribute),s=attribute(window,kAXSizeAttribute);
  CGPoint point; CGSize size;
  if(!p||!s||CFGetTypeID((__bridge CFTypeRef)p)!=AXValueGetTypeID()||CFGetTypeID((__bridge CFTypeRef)s)!=AXValueGetTypeID())return nil;
  if(!AXValueGetValue((__bridge AXValueRef)p,kAXValueCGPointType,&point)||!AXValueGetValue((__bridge AXValueRef)s,kAXValueCGSizeType,&size))return nil;
  return @{ @"x":@(point.x),@"y":@(point.y),@"width":@(size.width),@"height":@(size.height) };
}
static void discover(void) {
  NSMutableArray *result=[NSMutableArray new]; [windows removeAllObjects];
  NSMutableSet *visibleOwners=[NSMutableSet new];
  NSArray *screenWindows=CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly|kCGWindowListExcludeDesktopElements,kCGNullWindowID));
  for(NSDictionary *info in screenWindows){
    NSNumber *pid=info[(id)kCGWindowOwnerPID];
    if(pid)[visibleOwners addObject:pid];
  }
  for(NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications){
    // PiP may belong to a browser, player, or a separate system helper.
    // Never infer ownership from an app name; selection is always explicit.
    if(app.processIdentifier==getpid() || app.processIdentifier==getppid() || app.terminated || ![visibleOwners containsObject:@(app.processIdentifier)])continue;
    AXUIElementRef application=AXUIElementCreateApplication(app.processIdentifier);
    AXUIElementSetMessagingTimeout(application,.06);
    CFTypeRef raw=NULL;
    AXError query=AXUIElementCopyAttributeValue(application,kAXWindowsAttribute,&raw);
    NSArray *list=raw?CFBridgingRelease(raw):nil;
    if(getenv("VEIL_PIP_DEBUG"))fprintf(stderr,"pid=%d window-query=%d count=%lu\n",app.processIdentifier,query,(unsigned long)list.count);
    NSUInteger index=0;
    for(id value in list){
      AXUIElementRef window=(__bridge AXUIElementRef)value;
      AXUIElementSetMessagingTimeout(window,.06);
      Boolean movable=false,resizable=false;
      AXUIElementIsAttributeSettable(window,kAXPositionAttribute,&movable);
      AXUIElementIsAttributeSettable(window,kAXSizeAttribute,&resizable);
      if(getenv("VEIL_PIP_DEBUG"))fprintf(stderr,"  window=%lu movable=%d resizable=%d has-bounds=%d\n",(unsigned long)index,movable,resizable,bounds(window)!=nil);
      NSString *key=[NSString stringWithFormat:@"%d:%lu",app.processIdentifier,(unsigned long)index++];
      NSDictionary *rect=bounds(window);
      if(!movable||!resizable||!rect || [attribute(window,kAXMinimizedAttribute) boolValue])continue;
      windows[key]=value;
      NSString *title=attribute(window,kAXTitleAttribute);
      NSString *label=[NSString stringWithFormat:@"%@ — %@ (%d × %d)",app.localizedName?:@"App",title.length?title:@"Untitled window",[rect[@"width"] intValue],[rect[@"height"] intValue]];
      [result addObject:@{@"id":key,@"title":label}];
    }
    CFRelease(application);
  }
  emit(@{@"type":@"windows",@"windows":result});
}
static void applyBounds(NSDictionary *r) {
    CGPoint point=CGPointMake([r[@"x"] doubleValue],[r[@"y"] doubleValue]);
    CGSize size=CGSizeMake([r[@"width"] doubleValue],[r[@"height"] doubleValue]);
    AXValueRef p=AXValueCreate(kAXValueCGPointType,&point),s=AXValueCreate(kAXValueCGSizeType,&size);
    AXError a=[r[@"positionOnly"] boolValue]?kAXErrorSuccess:AXUIElementSetAttributeValue(selected,kAXSizeAttribute,s);
    AXError b=AXUIElementSetAttributeValue(selected,kAXPositionAttribute,p);
    CFRelease(p);CFRelease(s);
    if(a!=kAXErrorSuccess||b!=kAXErrorSuccess)emit(@{@"type":@"error",@"message":@"The source app refused window resizing or movement. PiP was released."});
}
static void command(NSDictionary *message) {
  NSString *op=message[@"op"];
  if([op isEqual:@"scan"] && !selected)discover();
  if([op isEqual:@"select"]){
    id value=windows[message[@"id"]];
    if(!value){emit(@{@"type":@"error",@"message":@"That window is no longer available. Refresh and select again."});return;}
    if(selected)CFRelease(selected);
    selected=(AXUIElementRef)CFRetain((__bridge CFTypeRef)value); selectedID=message[@"id"];
    missingFrames=0;AXUIElementSetMessagingTimeout(selected,.15);
  }
  if([op isEqual:@"set"] && selected){
    NSDictionary *r=message[@"rect"];
    for(NSString *key in @[@"x",@"y",@"width",@"height"])
      if(![r[key] isKindOfClass:NSNumber.class] || !isfinite([r[key] doubleValue]))return;
    if([r[@"width"] doubleValue]<1 || [r[@"height"] doubleValue]<1)return;
    // Keep only the latest geometry; a slow AX server must not build a queue
    // of old animation frames and keep moving a window after the drag ends.
    NSMutableDictionary *next=[r mutableCopy];
    next[@"positionOnly"]=@([message[@"positionOnly"] boolValue]);
    pendingBounds=next;
  }
}
int main(int argc,const char *argv[]){ @autoreleasepool {
  BOOL prompt=argc>1 && strcmp(argv[1],"--request-access")==0;
  BOOL trusted=AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@(prompt)});
  if(!trusted){emit(@{@"type":@"permission",@"message":@"macOS denied Veil’s Accessibility access. If Veil is already enabled, its saved grant may belong to an older build: remove the old Veil entry and add the app you are running in System Settings → Privacy & Security → Accessibility, then retry."});return 0;}
  windows=[NSMutableDictionary new]; discover();
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
    char *line=NULL; size_t capacity=0;
    while(getline(&line,&capacity,stdin)>0){
      NSData *data=[[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
      id message=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if([message isKindOfClass:NSDictionary.class])dispatch_async(dispatch_get_main_queue(),^{command(message);});
    }
    free(line); exit(0);
  });
  [NSTimer scheduledTimerWithTimeInterval:1.0/30 repeats:YES block:^(NSTimer *timer){
    if(!selected)return;
    if(pendingBounds){NSDictionary *r=pendingBounds;pendingBounds=nil;applyBounds(r);}
    NSDictionary *rect=bounds(selected);
    // AX can briefly time out during video startup, Spaces changes or resize.
    // A single failed read is not proof that the user closed the window.
    if(!rect){if(++missingFrames>=15){emit(@{@"type":@"gone"});CFRelease(selected);selected=NULL;}return;}
    missingFrames=0;
    CGEventRef event=CGEventCreate(NULL); CGPoint point=event?CGEventGetLocation(event):CGPointZero; if(event)CFRelease(event);
    emit(@{@"type":@"frame",@"id":selectedID,@"rect":rect,@"reduceMotion":@(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion),@"down":@(CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState,kCGMouseButtonLeft)),@"escape":@(CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,53)),@"pointer":@{@"x":@(point.x),@"y":@(point.y)}});
  }];
  [[NSRunLoop mainRunLoop] run];
}return 0;}
