// Objective-C exception bridge for Swift. AVFoundation's AVAudioNode.installTap
// (and a few other AVAudioEngine calls) RAISE an NSException — not a Swift
// `throws` error — when a precondition fails, e.g. the tap format not matching
// the input device's format mid-transition (AirPods connecting). Swift's
// do/try/catch CANNOT catch an NSException, so it propagates to the runtime and
// aborts the whole app. Run the risky call inside `ainTry` to turn that
// NSException into a value Swift can handle (retry later) instead of a crash.
//
// Compiled as the Swift bridging header (swiftc -import-objc-header), so this
// static inline function is callable directly from Swift.

#import <Foundation/Foundation.h>

static inline NSException * _Nullable ainTry(void (^ _Nonnull block)(void)) {
    @try {
        block();
        return nil;
    } @catch (NSException *e) {
        return e;
    }
}
