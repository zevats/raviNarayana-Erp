"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CookingPot, Banknote, History } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { UserAvatar } from "@/components/brand/BrandMark";
import { RnLogo } from "@/components/brand/RnLogo";
import { ProfileMenu } from "./ProfileMenu";

type View = "stops" | "cash" | "history";
const TABS: Array<{ view: View; label: string; Icon: typeof History }> = [
  { view: "stops", label: "My Stops", Icon: CookingPot },
  { view: "cash", label: "My Cash", Icon: Banknote },
  { view: "history", label: "History", Icon: History },
];

const shortName = (n: string) => {
  const [a, b] = n.split(/\s+/);
  return b ? `${a} ${b[0]}.` : a;
};

/**
 * Delivery partner shell (approved design): wordmark, My Stops / My Cash / History tabs and the
 * partner's name. It keeps the website navbar's behaviour: a full-width bar that becomes a
 * floating frosted pill after scrolling, with a thin progress line.
 * On phones the tabs move to a bottom bar.
 */
export function DeliveryStaffShell({
  user,
  children,
  onLogout,
  isLoggingOut,
  queuedCount,
}: {
  user: AuthenticatedUser;
  children: React.ReactNode;
  onLogout: () => void;
  isLoggingOut: boolean;
  queuedCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState<View>("stops");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 50);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<View>).detail);
    window.addEventListener("erp:delivery-view-changed", on);
    return () => window.removeEventListener("erp:delivery-view-changed", on);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    // Taps inside the menu (also its phone sheet, rendered outside this tree) do not close it.
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (menuRef.current?.contains(t) || t.closest?.("[data-profile-menu]")) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const open = (v: View) => {
    if (pathname === "/delivery") window.dispatchEvent(new CustomEvent("erp:delivery-view", { detail: v }));
    else router.push(v === "stops" ? "/delivery" : `/delivery?view=${v}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const active = (v: View) => pathname === "/delivery" && view === v;

  return (
    <div
      className="min-h-screen bg-[#FAF8F5] font-sans text-[#1A2E20]"
      style={{ "--rn-bike-body": "#C9501C", "--rn-bike-box": "#FCE9DD", "--rn-bike-line": "#C9501C", "--rn-bike-light": "#F2B33D" } as React.CSSProperties}
    >
      <div className="fixed top-0 left-0 right-0 h-[2px] bg-[#C9501C] origin-left z-50 pointer-events-none" style={{ transform: `scaleX(${progress})` }} />

      {scrolled && <div aria-hidden="true" className="fixed top-0 inset-x-0 z-40 h-[env(safe-area-inset-top)] bg-[#FAF8F5]" />}
      <header className={`fixed top-0 left-0 right-0 z-40 flex justify-center pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${scrolled ? "pt-[calc(env(safe-area-inset-top)+0.75rem)] px-3 sm:px-4" : ""}`}>
        <div
          className={`pointer-events-auto w-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            scrolled
              ? "max-w-[1100px] rounded-full bg-[#F3F5F1]/95 backdrop-blur-md border border-[#8E9F89]/25 shadow-[0_6px_24px_rgba(43,51,41,0.12)] px-3 sm:px-5 py-2"
              : "bg-[#FBF9F3]/95 backdrop-blur-sm border-b border-[#ECE6DB] px-4 sm:px-6 lg:px-8 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
          }`}
        >
          <div className="mx-auto max-w-[1180px] flex items-center gap-4">
            <button type="button" onClick={() => open("stops")} className="flex items-center gap-2.5 shrink-0" aria-label="My stops">
              <RnLogo brand="delivery" size={36} title="" className="shadow-[0_2px_8px_rgba(31,35,32,0.12)]" />
              <span className="text-[20px] font-extrabold tracking-[-0.02em] text-[#1F2320]">Ravinarayan</span>
            </button>

            <nav aria-label="Delivery sections" className="hidden md:flex items-center p-1 rounded-full bg-[#EFEAE1]/80 ml-6">
              {TABS.map(({ view: v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => open(v)}
                  aria-current={active(v) ? "page" : undefined}
                  className={`rn-press h-9 px-4 rounded-full text-[13px] font-semibold transition-colors ${active(v) ? "bg-[#C9501C] text-white shadow-sm" : "text-[#3E4E42] hover:text-[#1A2E20]"}`}
                >
                  {label}
                  {v === "stops" && queuedCount > 0 && <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-[#C9501C] text-white text-[10px] items-center justify-center">{queuedCount}</span>}
                </button>
              ))}
            </nav>

            <div className="flex-1" />


            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Account" className="flex items-center gap-3">
                <span className="hidden md:block text-right leading-tight">
                  <span className="block text-[13px] font-bold text-[#1A2E20]">{shortName(user.fullName)}</span>
                  <span className="block text-[11px] text-[#6E7F70]">Delivery Partner</span>
                </span>
                <UserAvatar size={40} tone="orange" className="ring-2 ring-white shadow-sm" />
              </button>
              <ProfileMenu user={user} open={menuOpen} onClose={closeMenu} onLogout={onLogout} isLoggingOut={isLoggingOut} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6 lg:px-8 pt-[calc(84px+env(safe-area-inset-top))] md:pt-[calc(92px+env(safe-area-inset-top))] pb-[calc(5rem+max(0.75rem,env(safe-area-inset-bottom)))] md:pb-12">{children}</main>

      {/* Phone tab bar: always a floating pill, the same style as the top bar once scrolled. */}
      <nav aria-label="Delivery sections" className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div data-bottom-bar className="pointer-events-auto w-full max-w-md grid grid-cols-3 gap-1 p-1 rounded-full bg-[#EEF1ED]/85 backdrop-blur-md border border-[#8E9F89]/25 shadow-[0_4px_24px_rgba(43,51,41,0.12)]">
          {TABS.map(({ view: v, label, Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => open(v)}
              aria-current={active(v) ? "page" : undefined}
              className={`rn-press relative h-10 rounded-full flex items-center justify-center gap-1.5 text-[12px] font-semibold transition-colors ${active(v) ? "bg-[#C9501C] text-white shadow-sm" : "text-[#3E4E42]"}`}
            >
              <span className="relative">
                <Icon className="w-[18px] h-[18px]" strokeWidth={active(v) ? 2.2 : 1.8} />
                {v === "stops" && queuedCount > 0 && <span className={`absolute -top-1 -right-2.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${active(v) ? "bg-white text-[#C9501C]" : "bg-[#C9501C] text-white"}`}>{queuedCount}</span>}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
