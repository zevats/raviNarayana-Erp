"use client";

import React, { useState, useEffect } from "react";
import { Download, X, CheckCircle2, Wifi, WifiOff } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaRegistrar() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [showOnlineToast, setShowOnlineToast] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).Capacitor?.isNativePlatform?.()) return; // the Android app needs neither

    // 1. Detect if running in standalone PWA window
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(isStandaloneMode);

    // 2. Register Service Worker with strict error isolation
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((reg) => {
            // Periodic update check every 60 minutes
            setInterval(() => {
              reg.update();
            }, 60 * 60 * 1000);
          })
          .catch((err) => {
            console.warn("[PWA] Service worker registration notice:", err);
          });
      });
    }

    // 3. Listen for browser PWA installation offer
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Do not show banner if dismissed within the last 24 hours
      const lastDismissed = localStorage.getItem("erp_pwa_dismiss_install");
      if (lastDismissed && Date.now() - parseInt(lastDismissed, 10) < 24 * 60 * 60 * 1000) {
        return;
      }

      // The install pop-up is not shown (owner decision 2026-11-10): no banner on sign-in or in the portal.
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // 4. Confirmation upon install completion
    const handleAppInstalled = () => {
      setShowInstallBanner(false);
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("appinstalled", handleAppInstalled);

    // 5. Connectivity state monitoring
    const handleOnline = () => {
      setIsOnline(true);
      setShowOnlineToast(true);
      setTimeout(() => setShowOnlineToast(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setShowInstallBanner(false);
      }
      setDeferredPrompt(null);
    } catch (e) {
      console.warn("PWA installation prompt canceled or failed:", e);
    }
  };

  const handleDismissInstall = () => {
    setShowInstallBanner(false);
    localStorage.setItem("erp_pwa_dismiss_install", Date.now().toString());
  };

  return (
    <>
      {/* PWA Home Screen Install Banner */}
      {showInstallBanner && !isStandalone && (
        <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-4 left-2 right-2 sm:left-auto sm:right-4 sm:max-w-sm z-50 p-3 bg-[#1A2E20] text-white rounded-2xl shadow-xl border border-[#B58A57]/30 flex items-center justify-between gap-3 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-[#263B2D] border border-[#B58A57]/30 flex items-center justify-center shrink-0">
              <Download className="w-4 h-4 text-[#C89F6B]" />
            </div>
            <div className="min-w-0">
              <p className="font-serif text-xs font-semibold truncate text-[#FAF8F5]">
                Install Mobile App
              </p>
              <p className="text-[10px] text-[#A8B9A1] truncate">
                Add to home screen for faster offline access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleInstallClick}
              className="px-3 py-1.5 bg-[#B58A57] hover:bg-[#C89F6B] text-[#1A2E20] text-xs font-serif font-semibold rounded-xl transition shadow-xs"
            >
              Install
            </button>
            <button
              onClick={handleDismissInstall}
              className="p-1.5 text-[#A8B9A1] hover:text-white rounded-lg transition"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Online Reconnection Notification Toast */}
      {showOnlineToast && (
        <div className="fixed bottom-16 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-800 text-white rounded-full text-xs font-serif shadow-lg border border-emerald-600 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Wifi className="w-3.5 h-3.5 text-emerald-300" />
          <span>Connection restored &bull; Online</span>
        </div>
      )}
    </>
  );
}
