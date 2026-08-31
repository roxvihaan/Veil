#import <AppKit/AppKit.h>

// Validate rendered pixels, not just TIFF dimensions: Retina metadata can be
// correct even when AppKit and a manual transform accidentally scale twice.
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSData *data = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
    NSArray *reps = data ? [NSBitmapImageRep imageRepsWithData:data] : nil;
    if (reps.count != 2) return 1;
    for (NSBitmapImageRep *rep in reps) {
      NSInteger scale = rep.pixelsWide / 760;
      if ((scale != 1 && scale != 2) || rep.pixelsHigh != 480 * scale) return 1;
      NSColor *arrow = [[rep colorAtX:380 * scale y:246 * scale]
        colorUsingColorSpace:NSColorSpace.genericRGBColorSpace];
      NSColor *background = [[rep colorAtX:380 * scale y:220 * scale]
        colorUsingColorSpace:NSColorSpace.genericRGBColorSpace];
      if (!arrow || !background || arrow.redComponent > 0.65 ||
          background.redComponent - arrow.redComponent < 0.20) {
        fprintf(stderr, "Installer arrow is misplaced or double-scaled at %ldx\n", (long)scale);
        return 1;
      }
    }
    puts("Installer artwork pixels align at 1x and 2x");
  }
  return 0;
}
