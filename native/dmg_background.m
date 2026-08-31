#import <AppKit/AppKit.h>

// Finder supplies the actual draggable icons. This artwork contains only
// the installation copy and arrow, in a 760 x 480 point canvas at 1x and 2x.
static void Label(NSString *text, CGFloat y, CGFloat size, NSFontWeight weight, NSColor *color) {
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = NSTextAlignmentCenter;
  [text drawInRect:NSMakeRect(30, y, 700, size * 1.6)
    withAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:size weight:weight],
      NSForegroundColorAttributeName:color, NSParagraphStyleAttributeName:paragraph}];
}

static NSBitmapImageRep *Render(CGFloat scale) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
    pixelsWide:760 * scale pixelsHigh:480 * scale bitsPerSample:8 samplesPerPixel:4
    hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  rep.size = NSMakeSize(760, 480);
  NSGraphicsContext *bitmap = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  CGContextRef cg = bitmap.CGContext;
  CGContextTranslateCTM(cg, 0, 480 * scale);
  CGContextScaleCTM(cg, scale, -scale);
  [NSGraphicsContext saveGraphicsState];
  [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithCGContext:cg flipped:YES]];

  NSColor *top = [NSColor colorWithCalibratedRed:0.98 green:0.99 blue:1 alpha:1];
  NSColor *bottom = [NSColor colorWithCalibratedRed:0.88 green:0.94 blue:0.985 alpha:1];
  NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:top endingColor:bottom];
  [gradient drawInRect:NSMakeRect(0, 0, 760, 480) angle:90];

  NSColor *ink = [NSColor colorWithCalibratedRed:0.12 green:0.18 blue:0.24 alpha:1];
  NSColor *muted = [NSColor colorWithCalibratedRed:0.37 green:0.44 blue:0.52 alpha:1];
  Label(@"VEIL TERMINAL", 40, 11, NSFontWeightSemibold, muted);
  Label(@"Drag Veil to Applications", 69, 30, NSFontWeightSemibold, ink);
  Label(@"One drag. You're installed.", 112, 15, NSFontWeightRegular, muted);

  [muted setStroke];
  NSBezierPath *arrow = [NSBezierPath bezierPath];
  arrow.lineWidth = 3;
  arrow.lineCapStyle = NSLineCapStyleRound;
  arrow.lineJoinStyle = NSLineJoinStyleRound;
  [arrow moveToPoint:NSMakePoint(342, 246)];
  [arrow lineToPoint:NSMakePoint(418, 246)];
  [arrow moveToPoint:NSMakePoint(404, 232)];
  [arrow lineToPoint:NSMakePoint(418, 246)];
  [arrow lineToPoint:NSMakePoint(404, 260)];
  [arrow stroke];

  Label(@"Then open Veil from your Applications folder.", 402, 14, NSFontWeightRegular, muted);
  [NSGraphicsContext restoreGraphicsState];
  return rep;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSData *tiff = [NSBitmapImageRep TIFFRepresentationOfImageRepsInArray:@[Render(1), Render(2)]];
    NSError *error = nil;
    if (![tiff writeToFile:[NSString stringWithUTF8String:argv[1]] options:NSDataWritingAtomic error:&error]) {
      fprintf(stderr, "Cannot write DMG background: %s\n", error.localizedDescription.UTF8String);
      return 1;
    }
  }
  return 0;
}
