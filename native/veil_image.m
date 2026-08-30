#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <errno.h>
#import <signal.h>
#import <stdarg.h>
#import <sys/ioctl.h>
#import <time.h>
#import <unistd.h>

typedef struct {
    char *bytes;
    size_t length;
    size_t capacity;
} OutputBuffer;

static volatile sig_atomic_t interrupted = 0;
static BOOL alternateScreenActive = NO;
static BOOL plainOutput = NO;
static BOOL neofetchOutput = NO;

typedef struct {
    int red;
    int green;
    int blue;
} VeilRGBColor;

static void handleSignal(int signalNumber) {
    (void)signalNumber;
    interrupted = 1;
}

static void restoreTerminal(void) {
    if (!alternateScreenActive) return;
    fputs("\033[0m\033[?25h\033[?1049l", stdout);
    fflush(stdout);
    alternateScreenActive = NO;
}

static void printUsage(void) {
    fprintf(stderr, "Usage: veil image <path>\n");
}

static size_t terminalColumns(void) {
    struct winsize size = {0};
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &size) == 0 && size.ws_col > 0) return size.ws_col;
    const char *configured = getenv("VEIL_IMAGE_WIDTH");
    if (configured == NULL) configured = getenv("COLUMNS");
    const long columns = configured == NULL ? 0 : strtol(configured, NULL, 10);
    return columns > 0 ? (size_t)columns : 80;
}

static size_t terminalRows(void) {
    struct winsize size = {0};
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &size) == 0 && size.ws_row > 0) return size.ws_row;
    const char *configured = getenv("VEIL_IMAGE_HEIGHT");
    if (configured == NULL) configured = getenv("LINES");
    const long rows = configured == NULL ? 0 : strtol(configured, NULL, 10);
    return rows > 0 ? (size_t)rows : 40;
}

static BOOL reserveBuffer(OutputBuffer *buffer, size_t additional) {
    if (buffer->length + additional <= buffer->capacity) return YES;
    size_t capacity = MAX(buffer->capacity * 2, buffer->length + additional + 4096);
    char *bytes = realloc(buffer->bytes, capacity);
    if (bytes == NULL) return NO;
    buffer->bytes = bytes;
    buffer->capacity = capacity;
    return YES;
}

static BOOL appendBytes(OutputBuffer *buffer, const char *bytes, size_t length) {
    if (!reserveBuffer(buffer, length)) return NO;
    memcpy(buffer->bytes + buffer->length, bytes, length);
    buffer->length += length;
    return YES;
}

static BOOL appendCharacter(OutputBuffer *buffer, char character) {
    return appendBytes(buffer, &character, 1);
}

static BOOL appendFormat(OutputBuffer *buffer, const char *format, ...) {
    char formatted[64];
    va_list arguments;
    va_start(arguments, format);
    const int length = vsnprintf(formatted, sizeof(formatted), format, arguments);
    va_end(arguments);
    return length > 0 && appendBytes(buffer, formatted, (size_t)length);
}

static int quantizedColor(int value) {
    if (value >= 248) return 255;
    return (value / 8) * 8;
}

static VeilRGBColor xtermColor(int index) {
    static const int basic[16][3] = {
        {0, 0, 0},       {128, 0, 0},     {0, 128, 0},     {128, 128, 0},
        {0, 0, 128},     {128, 0, 128},   {0, 128, 128},   {192, 192, 192},
        {128, 128, 128}, {255, 0, 0},     {0, 255, 0},     {255, 255, 0},
        {0, 0, 255},     {255, 0, 255},   {0, 255, 255},   {255, 255, 255},
    };
    if (index < 16) return (VeilRGBColor){basic[index][0], basic[index][1], basic[index][2]};
    if (index < 232) {
        static const int levels[6] = {0, 95, 135, 175, 215, 255};
        const int cube = index - 16;
        return (VeilRGBColor){levels[cube / 36], levels[(cube / 6) % 6], levels[cube % 6]};
    }
    const int gray = 8 + (index - 232) * 10;
    return (VeilRGBColor){gray, gray, gray};
}

static long colorDistance(int red, int green, int blue, VeilRGBColor candidate) {
    const long dr = red - candidate.red;
    const long dg = green - candidate.green;
    const long db = blue - candidate.blue;
    return dr * dr + dg * dg + db * db;
}

static int nearestXtermColor(int red, int green, int blue) {
    int nearest = 0;
    long nearestDistance = LONG_MAX;
    for (int index = 0; index < 256; index += 1) {
        const long distance = colorDistance(red, green, blue, xtermColor(index));
        if (distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    }
    return nearest;
}

static void writeNeofetchPalette(const int palette[6]) {
    const char *path = getenv("VEIL_IMAGE_PALETTE_FILE");
    if (path == NULL) return;
    FILE *file = fopen(path, "w");
    if (file == NULL) return;
    fprintf(file, "%d %d %d %d %d %d\n", palette[0], palette[1], palette[2], palette[3], palette[4], palette[5]);
    fclose(file);
}

static BOOL renderFrame(CGImageRef source, OutputBuffer *output) {
    if (source == NULL || CGImageGetWidth(source) == 0 || CGImageGetHeight(source) == 0) return NO;

    const CGFloat sourceWidth = (CGFloat)CGImageGetWidth(source);
    const CGFloat sourceHeight = (CGFloat)CGImageGetHeight(source);
    const size_t columns = terminalColumns();
    const size_t rows = terminalRows();
    const size_t maxWidth = MAX(16, MIN((size_t)180, columns > 2 ? columns - 2 : 16));
    const size_t maxHeight = MAX(8, MIN((size_t)100, rows > 3 ? rows - 3 : 8));

    size_t width = maxWidth;
    size_t height = MAX(1, (size_t)llround((sourceHeight / sourceWidth) * (CGFloat)width * 0.48));
    if (height > maxHeight) {
        height = maxHeight;
        width = MAX(1, (size_t)llround(((CGFloat)height / 0.48) * (sourceWidth / sourceHeight)));
    }

    const size_t bytesPerRow = width * 4;
    unsigned char *pixels = calloc(height, bytesPerRow);
    if (pixels == NULL) return NO;

    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(
        pixels,
        width,
        height,
        8,
        bytesPerRow,
        colorSpace,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
    );
    CGColorSpaceRelease(colorSpace);
    if (context == NULL) {
        free(pixels);
        return NO;
    }

    CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    CGContextClearRect(context, CGRectMake(0, 0, width, height));
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), source);

    static const char ramp[] = ".'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
    const size_t rampLength = sizeof(ramp) - 2;
    int palette[6] = {7, 7, 7, 7, 7, 7};
    if (neofetchOutput) {
        size_t histogram[256] = {0};
        for (size_t row = 0; row < height; row += 1) {
            for (size_t x = 0; x < width; x += 1) {
                const unsigned char *pixel = pixels + row * bytesPerRow + x * 4;
                const CGFloat alpha = pixel[3] / 255.0;
                if (alpha < 0.08) continue;
                const int red = MIN(255, (int)llround(pixel[0] / alpha));
                const int green = MIN(255, (int)llround(pixel[1] / alpha));
                const int blue = MIN(255, (int)llround(pixel[2] / alpha));
                histogram[nearestXtermColor(red, green, blue)] += 1;
            }
        }
        for (int slot = 0; slot < 6; slot += 1) {
            size_t highestCount = 0;
            int highestIndex = slot == 0 ? 7 : palette[0];
            for (int index = 0; index < 256; index += 1) {
                if (histogram[index] > highestCount) {
                    highestCount = histogram[index];
                    highestIndex = index;
                }
            }
            palette[slot] = highestIndex;
            histogram[highestIndex] = 0;
        }
        writeNeofetchPalette(palette);
    }
    int previousRed = -1;
    int previousGreen = -1;
    int previousBlue = -1;
    int previousPalette = -1;
    BOOL ok = YES;

    for (size_t outputRow = 0; outputRow < height && ok; outputRow += 1) {
        const size_t sourceRow = outputRow;
        for (size_t x = 0; x < width; x += 1) {
            const unsigned char *pixel = pixels + sourceRow * bytesPerRow + x * 4;
            const CGFloat alpha = pixel[3] / 255.0;
            if (alpha < 0.08) {
                ok = appendCharacter(output, ' ');
                continue;
            }

            const int red = MIN(255, (int)llround(pixel[0] / alpha));
            const int green = MIN(255, (int)llround(pixel[1] / alpha));
            const int blue = MIN(255, (int)llround(pixel[2] / alpha));
            const CGFloat luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255.0;
            const size_t index = MIN(rampLength, (size_t)llround(luminance * rampLength));
            const int displayRed = quantizedColor(red);
            const int displayGreen = quantizedColor(green);
            const int displayBlue = quantizedColor(blue);

            if (neofetchOutput) {
                int nearestPalette = 0;
                long nearestDistance = LONG_MAX;
                for (int slot = 0; slot < 6; slot += 1) {
                    const long distance = colorDistance(red, green, blue, xtermColor(palette[slot]));
                    if (distance < nearestDistance) {
                        nearestPalette = slot;
                        nearestDistance = distance;
                    }
                }
                if (nearestPalette != previousPalette) {
                    ok = appendFormat(output, "${c%d}", nearestPalette + 1);
                    previousPalette = nearestPalette;
                }
            } else if (!plainOutput && (displayRed != previousRed || displayGreen != previousGreen || displayBlue != previousBlue)) {
                ok = appendFormat(output, "\033[38;2;%d;%d;%dm", displayRed, displayGreen, displayBlue);
                previousRed = displayRed;
                previousGreen = displayGreen;
                previousBlue = displayBlue;
            }
            if (ok) ok = appendCharacter(output, ramp[index]);
        }
        if (ok) ok = plainOutput ? appendCharacter(output, '\n') : appendBytes(output, "\033[0m\n", 5);
        previousRed = -1;
        previousGreen = -1;
        previousBlue = -1;
        previousPalette = -1;
    }

    CGContextRelease(context);
    free(pixels);
    return ok;
}

static BOOL writeFrame(CGImageRef source, BOOL animated) {
    OutputBuffer output = {0};
    const BOOL rendered = renderFrame(source, &output);
    if (rendered) {
        if (animated) fputs("\033[H", stdout);
        fwrite(output.bytes, 1, output.length, stdout);
        if (animated) fputs("\033[J", stdout);
        fflush(stdout);
    }
    free(output.bytes);
    return rendered;
}

static void waitForFrame(NSTimeInterval duration) {
    // ASCII rendering is intentionally capped at 20 FPS so a decorative GIF
    // cannot monopolize the shared Electron renderer while another split types.
    duration = MAX(0.05, MIN(duration, 10.0));
    struct timespec remaining = {
        .tv_sec = (time_t)duration,
        .tv_nsec = (long)((duration - floor(duration)) * 1000000000.0),
    };
    while (!interrupted && nanosleep(&remaining, &remaining) == -1 && errno == EINTR) {}
}

static int playAnimatedGIF(NSString *path) {
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSBitmapImageRep *bitmap = data == nil ? nil : [NSBitmapImageRep imageRepWithData:data];
    const NSInteger frameCount = [[bitmap valueForProperty:NSImageFrameCount] integerValue];
    if (bitmap == nil || frameCount < 2) return -1;

    // Piped output gets one useful frame instead of an endless animation.
    if (!isatty(STDOUT_FILENO)) {
        [bitmap setProperty:NSImageCurrentFrame withValue:@0];
        return writeFrame(bitmap.CGImage, NO) ? 0 : 1;
    }

    signal(SIGINT, handleSignal);
    signal(SIGTERM, handleSignal);
    signal(SIGHUP, handleSignal);
    atexit(restoreTerminal);
    alternateScreenActive = YES;
    fputs("\033[?1049h\033[?25l\033[2J", stdout);
    fflush(stdout);

    while (!interrupted) {
        for (NSInteger frame = 0; frame < frameCount && !interrupted; frame += 1) {
            [bitmap setProperty:NSImageCurrentFrame withValue:@(frame)];
            if (!writeFrame(bitmap.CGImage, YES)) {
                restoreTerminal();
                return 1;
            }
            NSNumber *duration = [bitmap valueForProperty:NSImageCurrentFrameDuration];
            waitForFrame(duration != nil ? duration.doubleValue : 0.1);
        }
    }

    restoreTerminal();
    return 130;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) {
            printUsage();
            return 2;
        }

        neofetchOutput = getenv("VEIL_IMAGE_NEOFETCH") != NULL;
        plainOutput = neofetchOutput || getenv("VEIL_IMAGE_PLAIN") != NULL;
        NSString *path = [[NSString stringWithUTF8String:argv[1]] stringByStandardizingPath];
        if ([[path.pathExtension lowercaseString] isEqualToString:@"gif"]) {
            const int animationResult = playAnimatedGIF(path);
            if (animationResult >= 0) return animationResult;
        }

        NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
        if (image == nil) {
            fprintf(stderr, "veil: cannot read image: %s\n", argv[1]);
            return 1;
        }

        CGImageRef source = [image CGImageForProposedRect:NULL context:nil hints:nil];
        if (!writeFrame(source, NO)) {
            fprintf(stderr, "veil: unsupported or empty image: %s\n", argv[1]);
            return 1;
        }
        return 0;
    }
}
