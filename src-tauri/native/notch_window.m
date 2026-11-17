#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <stdbool.h>

typedef void (*NotchExpandCallback)(bool expanded);

static NSWindow *g_notchWindow = nil;
static id g_globalMouseMonitor = nil;
static id g_localMouseMonitor = nil;
static NotchExpandCallback g_expandCallback = NULL;
static BOOL g_isExpanded = NO;
static BOOL g_isPinned = NO;
static CGFloat g_notchWidth = 185.0;
static CGFloat g_notchHeight = 32.0;
static NSRect g_triggerRect = {{0, 0}, {0, 0}};
static NSRect g_keepAliveRect = {{0, 0}, {0, 0}};
static int g_outsideHoverTicks = 0;
static CGFloat g_liveWing = 0.0; // extra width per side while the collapsed live activity is visible
static NSScreen *g_lastScreen = nil;
static dispatch_source_t g_hoverPollTimer = NULL;
static dispatch_queue_t g_hoverQueue = NULL;
static id g_activityToken = nil;
static IMP g_originalHitTest = NULL;

static const CGFloat kWindowWidth = 640.0;
static const CGFloat kWindowHeight = 240.0;
static const CGFloat kCardWidth = 580.0;
static const CGFloat kCardHeight = 200.0;

static WKWebView *findWKWebView(NSView *view) {
    if (!view) return nil;
    if ([view isKindOfClass:NSClassFromString(@"WKWebView")]) {
        return (WKWebView *)view;
    }
    for (NSView *sub in view.subviews) {
        WKWebView *found = findWKWebView(sub);
        if (found) return found;
    }
    return nil;
}

static BOOL devhub_acceptsFirstMouse(id self, SEL _cmd, NSEvent *event) {
    (void)self;
    (void)_cmd;
    (void)event;
    return YES;
}

static BOOL devhub_canBecomeMainWindow(id self, SEL _cmd) {
    (void)_cmd;
    if (self == g_notchWindow) {
        return NO;
    }
    return YES;
}

static NSView *devhub_hitTest(id self, SEL _cmd, NSPoint point) {
    NSView *view = (NSView *)self;
    // For any window other than the notch window, behave completely normally
    if (!g_notchWindow || view.window != g_notchWindow) {
        if (g_originalHitTest) {
            return ((NSView *(*)(id, SEL, NSPoint))g_originalHitTest)(self, _cmd, point);
        }
        return nil;
    }

    if (!g_isExpanded) {
        return nil; // When collapsed, clicks pass through completely on notch window
    }

    NSRect b = view.bounds;
    CGFloat cardX = (b.size.width - kCardWidth) / 2.0;
    CGFloat cardY = b.size.height - kCardHeight;
    NSRect cardRect = NSMakeRect(cardX, cardY, kCardWidth, kCardHeight);
    if (!NSPointInRect(point, cardRect)) {
        return nil; // Clicks outside expanded card pass through
    }

    if (g_originalHitTest) {
        return ((NSView *(*)(id, SEL, NSPoint))g_originalHitTest)(self, _cmd, point);
    }
    return nil;
}

static void makeViewAndSubviewsTransparent(NSView *view) {
    if (!view) return;
    view.wantsLayer = YES;
    if (view.layer) {
        view.layer.opaque = NO;
        view.layer.backgroundColor = [NSColor clearColor].CGColor;
    }

    if ([view respondsToSelector:@selector(setDrawsBackground:)]) {
        @try {
            [(id)view setDrawsBackground:NO];
        } @catch (id ex) {}
    }
    if ([view respondsToSelector:NSSelectorFromString(@"_setDrawsBackground:")]) {
        @try {
            IMP imp = [view methodForSelector:NSSelectorFromString(@"_setDrawsBackground:")];
            if (imp) {
                void (*func)(id, SEL, BOOL) = (void *)imp;
                func(view, NSSelectorFromString(@"_setDrawsBackground:"), NO);
            }
        } @catch (id ex) {}
    }
    if ([view respondsToSelector:NSSelectorFromString(@"setUnderPageBackgroundColor:")]) {
        @try {
            IMP imp = [view methodForSelector:NSSelectorFromString(@"setUnderPageBackgroundColor:")];
            if (imp) {
                void (*func)(id, SEL, id) = (void *)imp;
                func(view, NSSelectorFromString(@"setUnderPageBackgroundColor:"), [NSColor clearColor]);
            }
        } @catch (id ex) {}
    }
    if ([view respondsToSelector:NSSelectorFromString(@"_setBackgroundColor:")]) {
        @try {
            IMP imp = [view methodForSelector:NSSelectorFromString(@"_setBackgroundColor:")];
            if (imp) {
                void (*func)(id, SEL, id) = (void *)imp;
                func(view, NSSelectorFromString(@"_setBackgroundColor:"), [NSColor clearColor]);
            }
        } @catch (id ex) {}
    }
    @try {
        [view setValue:@NO forKey:@"drawsBackground"];
    } @catch (id ex) {}

    for (NSView *sub in view.subviews) {
        makeViewAndSubviewsTransparent(sub);
    }
}

static NSRect getPhysicalNotchRect(NSScreen *screen) {
    if (!screen) screen = [NSScreen mainScreen];
    NSRect screenFrame = screen ? screen.frame : NSMakeRect(0, 0, 1512, 982);

    SEL selLeft = NSSelectorFromString(@"auxiliaryTopLeftArea");
    SEL selRight = NSSelectorFromString(@"auxiliaryTopRightArea");
    if (screen && [screen respondsToSelector:selLeft] && [screen respondsToSelector:selRight]) {
        NSValue *valLeft = [screen valueForKey:@"auxiliaryTopLeftArea"];
        NSValue *valRight = [screen valueForKey:@"auxiliaryTopRightArea"];
        if (valLeft && valRight) {
            NSRect left = [valLeft rectValue];
            NSRect right = [valRight rectValue];
            if (left.size.width > 0 && right.origin.x > left.size.width) {
                CGFloat notchX = NSMaxX(left);
                CGFloat notchW = NSMinX(right) - notchX;
                CGFloat notchY = NSMinY(left);
                CGFloat notchH = NSHeight(left);
                if (notchW > 10.0 && notchH > 10.0) {
                    return NSMakeRect(notchX, notchY, notchW, notchH);
                }
            }
        }
    }

    CGFloat w = 185.0;
    CGFloat h = 32.0;
    return NSMakeRect(
        screenFrame.origin.x + (screenFrame.size.width - w) / 2.0,
        screenFrame.origin.y + screenFrame.size.height - h,
        w,
        h
    );
}

static NSRect getNotchWindowFrame(NSScreen *screen) {
    if (!screen) screen = [NSScreen mainScreen];
    NSRect screenFrame = screen ? screen.frame : NSMakeRect(0, 0, 1512, 982);
    NSRect notchRect = getPhysicalNotchRect(screen);
    CGFloat notchCenterX = notchRect.origin.x + notchRect.size.width / 2.0;

    return NSMakeRect(
        notchCenterX - kWindowWidth / 2.0,
        screenFrame.origin.y + screenFrame.size.height - kWindowHeight,
        kWindowWidth,
        kWindowHeight
    );
}

static void updateGeometry(NSScreen *screen) {
    if (!screen) screen = [NSScreen mainScreen];
    NSRect screenFrame = screen ? screen.frame : NSMakeRect(0, 0, 1512, 982);
    NSRect notchRect = getPhysicalNotchRect(screen);
    g_notchWidth = notchRect.size.width;
    g_notchHeight = notchRect.size.height;

    // Trigger zone: covers the notch plus any live-activity wings, with slack
    // on each side and 25px below the notch.
    CGFloat side = MAX(35.0, g_liveWing + 12.0);
    g_lastScreen = screen;
    g_triggerRect = NSMakeRect(
        notchRect.origin.x - side,
        notchRect.origin.y - 25.0,
        notchRect.size.width + side * 2.0,
        notchRect.size.height + 35.0
    );

    // Keep-alive zone around the expanded card
    CGFloat notchCenterX = notchRect.origin.x + notchRect.size.width / 2.0;
    CGFloat expX = notchCenterX - kCardWidth / 2.0;
    CGFloat expY = screenFrame.origin.y + screenFrame.size.height - kCardHeight;
    g_keepAliveRect = NSMakeRect(
        expX - 30.0,
        expY - 30.0,
        kCardWidth + 60.0,
        kCardHeight + 40.0
    );
}

static void collapseNotchNative(void) {
    if (!g_notchWindow || !g_isExpanded) return;
    g_isExpanded = NO;
    g_outsideHoverTicks = 0;

    // Completely ignore mouse events when collapsed - clicks pass through to windows beneath
    [g_notchWindow setIgnoresMouseEvents:YES];

    WKWebView *wk = findWKWebView(g_notchWindow.contentView);
    if (wk) {
        [wk evaluateJavaScript:@"window.__DEVHUB_NOTCH_EXPAND && window.__DEVHUB_NOTCH_EXPAND(false)" completionHandler:nil];
    }

    if (g_expandCallback) {
        g_expandCallback(false);
    }
}

static void expandNotchNative(void) {
    if (!g_notchWindow || g_isExpanded) return;
    g_isExpanded = YES;
    g_outsideHoverTicks = 0;

    // Receive mouse events when expanded
    [g_notchWindow setIgnoresMouseEvents:NO];
    [g_notchWindow orderFrontRegardless];
    makeViewAndSubviewsTransparent(g_notchWindow.contentView);

    WKWebView *wk = findWKWebView(g_notchWindow.contentView);
    if (wk) {
        [wk evaluateJavaScript:@"window.__DEVHUB_NOTCH_EXPAND && window.__DEVHUB_NOTCH_EXPAND(true)" completionHandler:nil];
    }

    if (g_expandCallback) {
        g_expandCallback(true);
    }
}

static void checkMouseHover(void) {
    if (!g_notchWindow || g_triggerRect.size.width <= 0) return;

    NSPoint mouseLoc = [NSEvent mouseLocation];
    BOOL inTrigger = NSPointInRect(mouseLoc, g_triggerRect);
    BOOL inKeepAlive = NSPointInRect(mouseLoc, g_keepAliveRect);

    if (!g_isExpanded) {
        g_outsideHoverTicks = 0;
        if (inTrigger) {
            dispatch_async(dispatch_get_main_queue(), ^{
                expandNotchNative();
            });
        }
    } else {
        if (inKeepAlive) {
            g_outsideHoverTicks = 0;
        } else if (!g_isPinned) {
            g_outsideHoverTicks++;
            // 30ms * 6 = ~180ms grace period when leaving the card
            if (g_outsideHoverTicks >= 6) {
                g_outsideHoverTicks = 0;
                dispatch_async(dispatch_get_main_queue(), ^{
                    collapseNotchNative();
                });
            }
        }
    }
}

static void handlePointerEvent(NSEvent *event) {
    if (!g_notchWindow) return;

    NSPoint mouseLoc = [NSEvent mouseLocation];

    // Dismiss immediately on click outside
    if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown) {
        if (g_isExpanded && !g_isPinned && !NSPointInRect(mouseLoc, g_keepAliveRect)) {
            collapseNotchNative();
            return;
        }
    }

    checkMouseHover();
}

void setup_notch_nswindow(void *nswindow_ptr, double width, double height) {
    if (!nswindow_ptr) return;
    (void)width;
    (void)height;
    NSWindow *window = (__bridge NSWindow *)nswindow_ptr;

    void (^setupBlock)(void) = ^{
        g_notchWindow = window;

        window.styleMask = NSWindowStyleMaskBorderless;
        window.level = (NSWindowLevel)25; // kCGStatusWindowLevel

        window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                    NSWindowCollectionBehaviorStationary |
                                    NSWindowCollectionBehaviorIgnoresCycle |
                                    NSWindowCollectionBehaviorFullScreenAuxiliary;

        window.hasShadow = NO;
        window.opaque = NO;
        window.backgroundColor = [NSColor clearColor];
        window.acceptsMouseMovedEvents = YES;
        // Window starts in collapsed state: ignore mouse events so clicks pass through completely
        [window setIgnoresMouseEvents:YES];

        class_replaceMethod([window class], @selector(canBecomeMainWindow), (IMP)devhub_canBecomeMainWindow, "c@:");

        NSScreen *screen = window.screen ?: [NSScreen mainScreen];
        if (screen) {
            updateGeometry(screen);
            [window setFrame:getNotchWindowFrame(screen) display:NO animate:NO];
        }

        if (window.contentView) {
            window.contentView.wantsLayer = YES;
            if (window.contentView.layer) {
                window.contentView.layer.opaque = NO;
                window.contentView.layer.backgroundColor = [NSColor clearColor].CGColor;
            }
            makeViewAndSubviewsTransparent(window.contentView);
            class_replaceMethod([window.contentView class], @selector(acceptsFirstMouse:), (IMP)devhub_acceptsFirstMouse, "c@:@");

            // Swizzle hitTest: so clicks outside the active area pass through to windows beneath
            Method m = class_getInstanceMethod([window.contentView class], @selector(hitTest:));
            if (m && !g_originalHitTest) {
                g_originalHitTest = method_getImplementation(m);
                class_replaceMethod([window.contentView class], @selector(hitTest:), (IMP)devhub_hitTest, method_getTypeEncoding(m));
            }

            NSTrackingArea *area = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveAlways | NSTrackingInVisibleRect
                owner:window.contentView
                userInfo:nil];
            [window.contentView addTrackingArea:area];
        }
        Class wkClass = NSClassFromString(@"WKWebView");
        if (wkClass) {
            class_replaceMethod(wkClass, @selector(acceptsFirstMouse:), (IMP)devhub_acceptsFirstMouse, "c@:@");
        }
        Class wkContentClass = NSClassFromString(@"WKContentView");
        if (wkContentClass) {
            class_replaceMethod(wkContentClass, @selector(acceptsFirstMouse:), (IMP)devhub_acceptsFirstMouse, "c@:@");
        }

        WKWebView *wk = findWKWebView(window.contentView);
        if (wk) {
            @try {
                [wk.configuration.preferences setValue:@(2) forKey:@"inactiveSchedulingPolicy"];
            } @catch (id ex) {}
        }

        [window orderFrontRegardless];

        // Prevent App Nap from freezing or throttling hover polling when DevHub is in background
        if (!g_activityToken) {
            g_activityToken = [[NSProcessInfo processInfo] beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep | NSActivityLatencyCritical reason:@"DevHub Notch Hover Monitoring"];
        }

        // Dedicated background queue so hover polling executes at 30ms consistently even with other apps in foreground
        if (!g_hoverQueue) {
            g_hoverQueue = dispatch_queue_create("com.devhub.notch.hover", DISPATCH_QUEUE_SERIAL);
        }

        if (g_hoverPollTimer) {
            dispatch_source_cancel(g_hoverPollTimer);
            g_hoverPollTimer = NULL;
        }
        g_hoverPollTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, g_hoverQueue);
        dispatch_source_set_timer(g_hoverPollTimer, dispatch_time(DISPATCH_TIME_NOW, 0), (uint64_t)(30 * NSEC_PER_MSEC), (uint64_t)(5 * NSEC_PER_MSEC));
        dispatch_source_set_event_handler(g_hoverPollTimer, ^{
            checkMouseHover();
        });
        dispatch_resume(g_hoverPollTimer);

        // Pointer event monitors for clicks outside
        if (g_globalMouseMonitor) {
            [NSEvent removeMonitor:g_globalMouseMonitor];
            g_globalMouseMonitor = nil;
        }
        if (g_localMouseMonitor) {
            [NSEvent removeMonitor:g_localMouseMonitor];
            g_localMouseMonitor = nil;
        }

        NSEventMask eventMask = NSEventMaskMouseMoved |
                               NSEventMaskLeftMouseDragged |
                               NSEventMaskRightMouseDragged |
                               NSEventMaskLeftMouseDown |
                               NSEventMaskRightMouseDown;

        g_globalMouseMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:eventMask handler:^(NSEvent *event) {
            dispatch_async(dispatch_get_main_queue(), ^{
                handlePointerEvent(event);
            });
        }];

        g_localMouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:eventMask handler:^NSEvent *(NSEvent *event) {
            handlePointerEvent(event);
            return event;
        }];
    };

    if ([NSThread isMainThread]) {
        setupBlock();
    } else {
        dispatch_async(dispatch_get_main_queue(), setupBlock);
    }
}

void resize_notch_nswindow(void *nswindow_ptr, double width, double height) {
    (void)nswindow_ptr;
    (void)height;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (width > 250.0) {
            expandNotchNative();
        } else {
            collapseNotchNative();
        }
    });
}

void register_notch_expand_callback(NotchExpandCallback callback) {
    g_expandCallback = callback;
}

void set_notch_pinned_native(bool pinned) {
    dispatch_async(dispatch_get_main_queue(), ^{
        g_isPinned = pinned;
        if (!pinned && !g_isExpanded) {
            g_outsideHoverTicks = 0;
        }
    });
}

typedef void (*MRSendCommandFunc)(int, void *);
static MRSendCommandFunc g_mrSendCommand = NULL;

static void initMediaRemote(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        CFBundleRef bundle = CFBundleCreate(kCFAllocatorDefault, (CFURLRef)[NSURL fileURLWithPath:@"/System/Library/PrivateFrameworks/MediaRemote.framework"]);
        if (bundle) {
            g_mrSendCommand = (MRSendCommandFunc)CFBundleGetFunctionPointerForName(bundle, CFSTR("MRMediaRemoteSendCommand"));
        }
    });
}

static void devhub_post_media_key(int key) {
    NSEventModifierFlags downFlags = 0xa00;
    NSEventModifierFlags upFlags = 0xb00;
    NSInteger data1Down = (key << 16) | (0xa << 8);
    NSInteger data1Up = (key << 16) | (0xb << 8);
    NSEvent *downEvent = [NSEvent otherEventWithType:NSEventTypeSystemDefined
                                           location:NSZeroPoint
                                      modifierFlags:downFlags
                                          timestamp:0
                                       windowNumber:0
                                            context:nil
                                            subtype:8
                                              data1:data1Down
                                              data2:-1];
    NSEvent *upEvent = [NSEvent otherEventWithType:NSEventTypeSystemDefined
                                         location:NSZeroPoint
                                    modifierFlags:upFlags
                                        timestamp:0
                                     windowNumber:0
                                          context:nil
                                          subtype:8
                                            data1:data1Up
                                            data2:-1];
    if (downEvent.CGEvent) CGEventPost(kCGHIDEventTap, downEvent.CGEvent);
    if (upEvent.CGEvent) CGEventPost(kCGHIDEventTap, upEvent.CGEvent);
}

void control_music_native(const char *action) {
    if (!action) return;
    initMediaRemote();

    int key = 0;
    int mrCmd = 0;
    if (strcmp(action, "toggle") == 0) {
        key = 16;
        mrCmd = 2;
    } else if (strcmp(action, "next") == 0) {
        key = 17;
        mrCmd = 4;
    } else if (strcmp(action, "previous") == 0) {
        key = 18;
        mrCmd = 5;
    }
    if (mrCmd == 0) return;

    // Exactly one dispatch path. Sending the MediaRemote command *and* a media
    // key (or AppleScript) makes players that receive both toggle twice.
    if (g_mrSendCommand) {
        g_mrSendCommand(mrCmd, NULL);
    } else {
        devhub_post_media_key(key);
    }
}

void set_notch_live_wing(double wing) {
    dispatch_async(dispatch_get_main_queue(), ^{
        CGFloat next = MAX(0.0, (CGFloat)wing);
        if (fabs(next - g_liveWing) < 0.5) return;
        g_liveWing = next;
        updateGeometry(g_lastScreen ?: [NSScreen mainScreen]);
    });
}

// ---------------------------------------------------------------------------
// App context menu (right-click on an app in the notch's Apps tab)
//
// First choice is the app's own menu: its menu bar extra is pressed through
// Accessibility, exactly as if the user had clicked the icon in the menu bar
// (this works even when the icon is hidden behind the notch). If that is not
// possible — no Accessibility permission, or the app has no menu bar extra —
// a native NSMenu with DevHub's own actions pops up at the cursor. Either way
// the menu is a real system menu, so it is never clipped by the popup.

#import <ApplicationServices/ApplicationServices.h>

@interface DevHubMenuTarget : NSObject
@property (nonatomic, assign) NSInteger picked;
- (void)pick:(NSMenuItem *)sender;
@end

@implementation DevHubMenuTarget
- (void)pick:(NSMenuItem *)sender {
    self.picked = sender.tag;
}
@end

static BOOL pressStatusItemOfApp(pid_t pid) {
    if (!AXIsProcessTrusted()) return NO;
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    if (!app) return NO;
    AXUIElementSetMessagingTimeout(app, 1.0);

    BOOL opened = NO;
    CFTypeRef extras = NULL;
    if (AXUIElementCopyAttributeValue(app, CFSTR("AXExtrasMenuBar"), &extras) == kAXErrorSuccess && extras) {
        CFTypeRef children = NULL;
        if (AXUIElementCopyAttributeValue((AXUIElementRef)extras, kAXChildrenAttribute, &children) == kAXErrorSuccess
            && children && CFGetTypeID(children) == CFArrayGetTypeID() && CFArrayGetCount((CFArrayRef)children) > 0) {
            AXUIElementRef item = (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)children, 0);
            // Prefer the explicit "show menu" action; most status items only expose AXPress.
            CFArrayRef actions = NULL;
            BOOL hasShowMenu = NO;
            if (AXUIElementCopyActionNames(item, &actions) == kAXErrorSuccess && actions) {
                hasShowMenu = CFArrayContainsValue(actions, CFRangeMake(0, CFArrayGetCount(actions)), kAXShowMenuAction);
                CFRelease(actions);
            }
            opened = AXUIElementPerformAction(item, hasShowMenu ? kAXShowMenuAction : kAXPressAction) == kAXErrorSuccess;
        }
        if (children) CFRelease(children);
        CFRelease(extras);
    }
    CFRelease(app);
    return opened;
}

/// Must run on the main thread. `labels` is "title\nbringToFront\nshowInFinder\nquit\nforceQuit".
/// Returns "app-menu" when the app's own menu was opened, otherwise the action picked from the
/// fallback menu: "activate", "quit", "force-quit", "reveal" (already performed) or "none".
const char *show_app_context_menu(int pid, const char *labels) {
    if (pressStatusItemOfApp((pid_t)pid)) {
        // Get the popup out of the way so the app's menu is fully visible.
        collapseNotchNative();
        return "app-menu";
    }
    // Ask once for Accessibility so the app's own menu can be used next time.
    static BOOL askedForAccess = NO;
    if (!askedForAccess && !AXIsProcessTrusted()) {
        askedForAccess = YES;
        NSDictionary *opts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
        AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
    }

    NSArray<NSString *> *l = [[NSString stringWithUTF8String:labels ?: ""] componentsSeparatedByString:@"\n"];
    if (l.count < 5) return "none";

    DevHubMenuTarget *target = [DevHubMenuTarget new];
    target.picked = 0;
    NSMenu *menu = [[NSMenu alloc] initWithTitle:l[0]];
    menu.autoenablesItems = NO;

    NSMenuItem *header = [[NSMenuItem alloc] initWithTitle:l[0] action:nil keyEquivalent:@""];
    header.enabled = NO;
    [menu addItem:header];
    [menu addItem:[NSMenuItem separatorItem]];

    NSArray *entries = @[@[l[1], @1], @[l[2], @2], @[@"-", @0], @[l[3], @3], @[l[4], @4]];
    for (NSArray *entry in entries) {
        if ([entry[0] isEqualToString:@"-"]) {
            [menu addItem:[NSMenuItem separatorItem]];
            continue;
        }
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:entry[0] action:@selector(pick:) keyEquivalent:@""];
        item.target = target;
        item.tag = [entry[1] integerValue];
        [menu addItem:item];
    }

    // Keep the popup open while the menu tracks (it runs a modal loop).
    BOOL wasPinned = g_isPinned;
    g_isPinned = YES;
    [menu popUpMenuPositioningItem:nil atLocation:[NSEvent mouseLocation] inView:nil];
    g_isPinned = wasPinned;

    switch (target.picked) {
        case 1: return "activate";
        case 2: {
            NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)pid];
            if (app.bundleURL) [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[app.bundleURL]];
            return "reveal";
        }
        case 3: return "quit";
        case 4: return "force-quit";
        default: return "none";
    }
}
