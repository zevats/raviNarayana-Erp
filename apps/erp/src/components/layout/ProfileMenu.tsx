"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, KeyRound, LogOut, Mail, UserRound } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { UserAvatar } from "@/components/brand/BrandMark";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { useSheetDrag } from "@/components/feedback/useSheetDrag";

/**
 * The delivery partner's profile menu: a bottom sheet on phones, a small card under the avatar
 * on wider screens. The phone sheet is rendered at the end of <body>: inside the header, whose
 * frosted (backdrop-filter) style makes it the box for fixed elements, it would be clipped.
 * Opening a sheet of the account page while that page is already open sends
 * "erp:account-sheet" instead of navigating (a same-URL push would do nothing).
 */
export function ProfileMenu({ user, open, onClose, onLogout, isLoggingOut }: { user: AuthenticatedUser; open: boolean; onClose: () => void; onLogout: () => void; isLoggingOut: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const drag = useSheetDrag(onClose, open);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;

  const go = (sheet: "password" | "email" | null) => {
    onClose();
    if (pathname === "/account") {
      if (sheet) window.dispatchEvent(new CustomEvent("erp:account-sheet", { detail: sheet }));
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push(sheet ? `/account?sheet=${sheet}` : "/account");
  };
  const onProfile = pathname === "/account";
  const items = [
    ...(onProfile ? [] : [{ label: "My profile", Icon: UserRound, run: () => go(null) }]),
    { label: "Change password", Icon: KeyRound, run: () => go("password") },
    { label: "Change email", Icon: Mail, run: () => go("email") },
  ];

  const body = (
    <>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3.5">
        <UserAvatar size={44} tone="orange" />
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-[#1F2320] truncate">{user.fullName}</p>
          <p className="text-[12px] text-[#6E7F70] truncate">{user.email}</p>
        </div>
      </div>
      <div className="px-2 pb-2">
        <div className="rounded-2xl bg-[#F7F3EC] p-1">
          {items.map(({ label, Icon, run }) => (
            <button key={label} type="button" role="menuitem" onClick={run} className="rn-press w-full flex items-center gap-3 px-3 h-12 rounded-xl text-left hover:bg-white active:bg-white focus-visible:bg-white outline-none">
              <span className="w-8 h-8 rounded-lg bg-white text-[#C9501C] flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(31,35,32,0.06)]">
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0 text-[14px] font-semibold text-[#1F2320]">{label}</span>
              <ChevronRight className="w-4 h-4 text-[#B7AE9F] shrink-0" />
            </button>
          ))}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={onLogout}
          disabled={isLoggingOut}
          className="rn-press mt-2 w-full flex items-center justify-center gap-2 h-12 rounded-full bg-[#FBE3DD] text-[14px] font-bold text-[#9A3423] hover:bg-[#F7D3CA] active:bg-[#F2C4B8] disabled:opacity-70 outline-none focus-visible:ring-4 focus-visible:ring-[#9A3423]/20"
        >
          {isLoggingOut ? (
            <>
              Signing out…
            </>
          ) : (
            <>
              <LogOut className="w-4 h-4" /> Sign out
            </>
          )}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Phone: bottom sheet, outside the header */}
      {mounted &&
        createPortal(
          <div data-profile-menu className="md:hidden fixed inset-0 z-[60] flex items-end font-sans">
            <div className="rn-scrim absolute inset-0 bg-[#16221A]/40" onClick={onClose} aria-hidden="true" />
            <div role="menu" aria-label="Profile" {...drag.bind} style={drag.style} className="rn-sheet relative w-full bg-white rounded-t-[28px] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl">
              <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#DAD3C6]" aria-hidden="true" />
              {body}
            </div>
          </div>,
          document.body
        )}
      {/* Wider screens: card under the avatar */}
      <div data-profile-menu role="menu" aria-label="Profile" className="hidden md:block rn-enter absolute right-0 top-full mt-3 w-[300px] rounded-[22px] bg-white border border-[#ECE6DB] shadow-[0_18px_44px_rgba(31,35,32,0.16)] overflow-hidden">
        {body}
      </div>
    </>
  );
}
