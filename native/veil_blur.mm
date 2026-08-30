#include <napi.h>

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

#include <algorithm>
#include <cstdint>
#include <dlfcn.h>

namespace {

using CGSConnectionID = int32_t;
using MainConnectionFn = CGSConnectionID (*)(void);
using SetWindowBlurFn = CGError (*)(CGSConnectionID, CGWindowID, int);

bool SetBackgroundBlur(NSView* view, int radius) {
  if (view == nil || view.window == nil) return false;

  static void* skyLight = dlopen(
    "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
    RTLD_LAZY | RTLD_LOCAL
  );
  if (skyLight == nullptr) return false;

  static auto mainConnection = reinterpret_cast<MainConnectionFn>(
    dlsym(skyLight, "CGSMainConnectionID")
  );
  static auto setWindowBlur = reinterpret_cast<SetWindowBlurFn>(
    dlsym(skyLight, "CGSSetWindowBackgroundBlurRadius")
  );
  if (mainConnection == nullptr || setWindowBlur == nullptr) return false;

  NSWindow* window = view.window;
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;

  const int safeRadius = std::clamp(radius, 0, 100);
  return setWindowBlur(
    mainConnection(),
    static_cast<CGWindowID>(window.windowNumber),
    safeRadius
  ) == kCGErrorSuccess;
}

Napi::Value ApplyBlur(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected a native window handle and blur radius")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() < sizeof(NSView*)) return Napi::Boolean::New(env, false);

  NSView* view = *reinterpret_cast<NSView**>(handle.Data());
  const int radius = info[1].As<Napi::Number>().Int32Value();
  return Napi::Boolean::New(env, SetBackgroundBlur(view, radius));
}

Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  void* skyLight = dlopen(
    "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
    RTLD_LAZY | RTLD_LOCAL
  );
  const bool available = skyLight != nullptr &&
    dlsym(skyLight, "CGSMainConnectionID") != nullptr &&
    dlsym(skyLight, "CGSSetWindowBackgroundBlurRadius") != nullptr;
  return Napi::Boolean::New(env, available);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("apply", Napi::Function::New(env, ApplyBlur));
  exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
  return exports;
}

}  // namespace

NODE_API_MODULE(veil_blur, Init)
