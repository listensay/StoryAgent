#import <AppKit/AppKit.h>
#import <objc/runtime.h>

// Keep Tao's NSWindow delegate intact. Observers and constraints apply only to the
// main window, never to the file picker or other system dialogs.
@interface StoryAgentWindowLayout : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic) BOOL transitioning;
@property(nonatomic) BOOL fitting;
@end

@implementation StoryAgentWindowLayout
- (void)unlockSize {
    self.window.contentMinSize = NSZeroSize;
    self.window.contentMaxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
}
- (void)fit {
    NSWindow *window = self.window;
    NSScreen *screen = window.screen ?: NSScreen.mainScreen;
    if (!window || !screen || self.fitting || self.transitioning || (window.styleMask & NSWindowStyleMaskFullScreen)) return;
    self.fitting = YES;
    NSRect frame = screen.visibleFrame;
    NSSize content = [window contentRectForFrameRect:frame].size;
    [self unlockSize];
    [window setFrame:frame display:NO];
    window.contentMinSize = content;
    window.contentMaxSize = content;
    [window standardWindowButton:NSWindowZoomButton].enabled = YES;
    self.fitting = NO;
}
- (void)entering:(NSNotification *)note { self.transitioning = YES; [self unlockSize]; }
- (void)entered:(NSNotification *)note { self.transitioning = NO; }
- (void)leaving:(NSNotification *)note { self.transitioning = YES; }
- (void)left:(NSNotification *)note { self.transitioning = NO; [self fit]; }
- (void)screenChanged:(NSNotification *)note { [self fit]; }
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
@end

void storyagent_fit_mac_window(void *handle) {
    NSWindow *window = (__bridge NSWindow *)handle;
    StoryAgentWindowLayout *layout = [StoryAgentWindowLayout new];
    layout.window = window;
    static char layoutKey;
    objc_setAssociatedObject(window, &layoutKey, layout, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:layout selector:@selector(entering:) name:NSWindowWillEnterFullScreenNotification object:window];
    [center addObserver:layout selector:@selector(entered:) name:NSWindowDidEnterFullScreenNotification object:window];
    [center addObserver:layout selector:@selector(leaving:) name:NSWindowWillExitFullScreenNotification object:window];
    [center addObserver:layout selector:@selector(left:) name:NSWindowDidExitFullScreenNotification object:window];
    [center addObserver:layout selector:@selector(screenChanged:) name:NSWindowDidChangeScreenNotification object:window];
    [center addObserver:layout selector:@selector(screenChanged:) name:NSApplicationDidChangeScreenParametersNotification object:nil];
    window.collectionBehavior = (window.collectionBehavior & ~(NSWindowCollectionBehaviorFullScreenNone | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorFullScreenAllowsTiling)) | NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenDisallowsTiling;
    [layout fit];
}
