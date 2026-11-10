"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNativeApp, nativePlugins, rememberPushToken } from "@/lib/native";
import { storedBrand } from "@/lib/brand";

/**
 * Android app behaviour (renders nothing; does nothing in a browser):
 *  - hides the native splash once the first screen has drawn;
 *  - status bar colour per screen and edition;
 *  - hardware back button: closes an open sheet, else goes back, else minimises the app;
 *  - delivery alerts: asks for notification permission (Android 13+), registers this phone's
 *    Firebase token with the server (again whenever Firebase refreshes it), shows alerts that
 *    arrive while the app is open on the same alert channel (once per alert), and opens the stop
 *    a tapped notification points to.
 */
export function NativeBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const pushSetUp = useRef(false);
  const seen = useRef<Set<string>>(new Set());

  // Splash, status bar, back button — once.
  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.classList.add("rn-native");
    const P = nativePlugins();
    requestAnimationFrame(() => {
      P.SplashScreen?.hide?.({ fadeOutDuration: 280 }).catch?.(() => {});
      // The app's opening animation (house / rider) ends once the page is ready.
      P.RnApp?.ready?.().catch?.(() => {});
    });
    let sub: any;
    P.App?.addListener?.("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
      const sheet = document.querySelector("[role=dialog], [data-profile-menu] [role=menu]");
      if (sheet) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        (document.querySelector(".rn-scrim") as HTMLElement | null)?.click();
        return;
      }
      const root = ["/login", "/delivery", "/dashboard", "/orders"].includes(window.location.pathname) && !window.location.search;
      if (canGoBack && !root) window.history.back();
      else P.App?.minimizeApp?.();
    })?.then?.((h: any) => (sub = h));
    return () => sub?.remove?.();
  }, []);

  // Status bar follows the screen: brand colour on sign-in, light bar in the delivery app, dark
  // green in the management portal.
  useEffect(() => {
    if (!isNativeApp()) return;
    const SB = nativePlugins().StatusBar;
    if (!SB) return;
    const delivery = storedBrand() === "delivery";
    const login = pathname?.startsWith("/login") || pathname?.startsWith("/forgot") || pathname?.startsWith("/reset");
    const color = login ? (delivery ? "#C9501C" : "#173A29") : delivery ? "#FBF9F3" : "#1A2E20";
    SB.setOverlaysWebView?.({ overlay: false })?.catch?.(() => {});
    SB.setBackgroundColor?.({ color })?.catch?.(() => {});
    SB.setStyle?.({ style: !login && delivery ? "LIGHT" : "DARK" })?.catch?.(() => {});
  }, [pathname]);

  // Delivery alerts, once signed in.
  useEffect(() => {
    if (!isNativeApp() || pushSetUp.current) return;
    if (!pathname || pathname.startsWith("/login") || pathname.startsWith("/reset") || pathname.startsWith("/forgot")) return;
    const P = nativePlugins();
    const PN = P.PushNotifications;
    if (!PN || !P.RnApp?.pushReady) return;
    pushSetUp.current = true;
    (async () => {
      const { ready } = await P.RnApp.pushReady().catch(() => ({ ready: false }));
      if (!ready) return; // this build has no Firebase configuration yet
      await PN.addListener("registration", async ({ value }: { value: string }) => {
        rememberPushToken(value);
        await fetch("/api/push/token", { method: "POST", headers: { "Content-Type": "application/json", "X-RN-CSRF": "1" }, body: JSON.stringify({ token: value, platform: "android" }) }).catch(() => {});
      });
      await PN.addListener("registrationError", (e: any) => console.warn("Alert registration failed", e?.error || e));
      // App open: Android does not show the notification itself, so show it on the alert channel.
      await PN.addListener("pushNotificationReceived", (n: any) => {
        const tag = n?.data?.tag || n?.id || "";
        if (tag && seen.current.has(tag)) return;
        if (tag) seen.current.add(tag);
        window.dispatchEvent(new CustomEvent("erp:push", { detail: n }));
        P.LocalNotifications?.schedule?.({
          notifications: [
            {
              id: Math.floor(Math.random() * 2_000_000_000),
              title: n?.title || "Ravinarayan",
              body: n?.body || "",
              channelId: n?.data?.kind === "new_stop" ? "delivery_alerts" : "delivery_updates",
              smallIcon: "ic_stat_rn",
              extra: { url: n?.data?.url || "/delivery" },
            },
          ],
        })?.catch?.(() => {});
      });
      const open = (url?: string) => {
        if (url && url.startsWith("/")) router.push(url);
      };
      await PN.addListener("pushNotificationActionPerformed", (a: any) => open(a?.notification?.data?.url));
      await P.LocalNotifications?.addListener?.("localNotificationActionPerformed", (a: any) => open(a?.notification?.extra?.url));
      let perm = await PN.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PN.requestPermissions();
      if (perm.receive !== "granted") return;
      await PN.register();
    })().catch((e) => console.warn("Alert setup failed", e));
  }, [pathname, router]);

  return null;
}
