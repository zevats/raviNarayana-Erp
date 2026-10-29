"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { WifiOff, RefreshCw, Truck, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { getOfflineQueue, processOfflineQueue } from "@/modules/delivery/offlineQueue";

export default function OfflineFallbackPage() {
  const [isRetrying, setIsRetrying] = useState(false);
  const [offlineCount, setOfflineCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : false);
      const queue = getOfflineQueue();
      setOfflineCount(queue.filter((i) => i.status === "PENDING" || i.status === "FAILED").length);
    };

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const handleRetry = () => {
    setIsRetrying(true);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const handleSyncNow = async () => {
    setSyncStatus("Connecting and synchronizing...");
    try {
      const res = await processOfflineQueue();
      if (res.authFailed) {
        setSyncStatus("Session expired or unauthorized. Please re-authenticate to synchronize pending actions.");
      } else {
        setSyncStatus(`Synchronized ${res.syncedCount} action(s). ${res.errorCount > 0 ? `${res.errorCount} pending retry.` : ""}`);
      }
      const queue = getOfflineQueue();
      setOfflineCount(queue.filter((i) => i.status === "PENDING" || i.status === "FAILED").length);
    } catch (err: any) {
      setSyncStatus("Sync failed: " + (err.message || "Still offline"));
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1A2E20] flex flex-col justify-between p-4 sm:p-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      {/* Top Branding */}
      <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-4">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Ravi Narayana"
            width={36}
            height={36}
            className="rounded-lg object-contain"
            priority
          />
          <div>
            <h1 className="font-serif text-sm font-semibold tracking-tight text-[#1A2E20]">
              Ravi Narayana ERP
            </h1>
            <p className="text-[10px] text-[#5D7656] uppercase tracking-wider font-mono">
              Mobile App Console
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-amber-500/10 text-amber-900 border border-amber-500/25">
          <WifiOff className="w-3 h-3 text-amber-700" />
          <span>Offline Mode</span>
        </div>
      </div>

      {/* Center Content */}
      <div className="max-w-md w-full mx-auto text-center space-y-6 py-12">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto shadow-sm">
          <WifiOff className="w-8 h-8 text-amber-700" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-serif font-medium text-[#1A2E20]">
            Connection Unavailable
          </h2>
          <p className="text-xs text-[#5D7656] leading-relaxed max-w-sm mx-auto">
            Your device is currently disconnected from the mobile network or Wi-Fi.
          </p>
        </div>

        {/* Offline Queue Notice for Drivers */}
        <div className="p-4 bg-white rounded-2xl border border-[#8E9F89]/30 text-left space-y-2.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-serif font-medium text-[#1A2E20]">
            <Truck className="w-4 h-4 text-[#B58A57]" />
            <span>Delivery Driver Offline Protection</span>
          </div>
          <p className="text-[11px] text-[#5D7656] leading-relaxed">
            If you have already loaded your stops today, any deliveries completed or collections recorded offline are safely queued in local device storage.
          </p>

          <div className="pt-2 border-t border-[#8E9F89]/15 flex items-center justify-between">
            <span className="text-[11px] font-mono text-[#1A2E20]">
              Pending Queued Actions: <strong>{offlineCount}</strong>
            </span>
            {isOnline && offlineCount > 0 && (
              <button
                onClick={handleSyncNow}
                className="px-3 py-1 bg-[#1A2E20] text-white text-[11px] font-serif rounded-lg hover:bg-[#263B2D] transition"
              >
                Sync Now
              </button>
            )}
          </div>

          {syncStatus && (
            <p className="text-[10px] text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200 font-mono">
              {syncStatus}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="w-full min-h-[48px] px-6 py-3 bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-serif font-medium rounded-xl transition shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-[#C89F6B] ${isRetrying ? "animate-spin" : ""}`} />
            <span>{isRetrying ? "Reconnecting..." : "Retry Connection"}</span>
          </button>

          <Link
            href="/delivery"
            className="w-full min-h-[48px] px-6 py-3 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs font-serif font-medium rounded-xl border border-[#8E9F89]/30 transition shadow-2xs flex items-center justify-center gap-2"
          >
            <Truck className="w-4 h-4 text-[#B58A57]" />
            <span>Return to Driver Stops</span>
          </Link>
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="text-center text-[11px] text-[#8E9F89] border-t border-[#8E9F89]/20 pt-4">
        <p>&copy; {new Date().getFullYear()} Ravinarayan PG Guesthouse &bull; Offline PWA Shell</p>
      </div>
    </div>
  );
}
