/**
 * Bridge to the Android app (Capacitor). In a normal browser every function here does nothing.
 * The native plugins are provided by the app shell; the web code only calls them by name, so the
 * web build has no native dependencies.
 */
const TOKEN_KEY = "rn-push-token";

type Plugins = Record<string, any>;

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());
}

export function nativePlugins(): Plugins {
  return (typeof window !== "undefined" && (window as any).Capacitor?.Plugins) || {};
}

export function storedPushToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function rememberPushToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Sign-out on this phone: stop its alerts for the person signing out (best effort, quick). */
export async function forgetPushToken(): Promise<void> {
  const token = storedPushToken();
  if (!token) return;
  try {
    await Promise.race([
      fetch("/api/push/token/remove", { method: "POST", headers: { "Content-Type": "application/json", "X-RN-CSRF": "1" }, body: JSON.stringify({ token }) }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {}
  rememberPushToken(null);
  // A fresh token is issued for the next person who signs in on this phone.
  try {
    await nativePlugins().PushNotifications?.unregister?.();
  } catch {}
}
