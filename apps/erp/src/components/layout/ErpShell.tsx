"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BedDouble,
  CreditCard,
  UtensilsCrossed,
  Truck,
  LogOut,
  Menu,
  X,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { AuthenticatedUser, ROLE_LABELS, ROLE_BADGE_STYLES } from "@/types";
import { NotificationBell } from "@/components/notifications/NotificationBell";

interface ErpShellProps {
  user: AuthenticatedUser;
  children: React.ReactNode;
  isDemo?: boolean;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Rooms & Inventory",
    href: "/rooms",
    icon: BedDouble,
  },
  {
    name: "Residents & Stays",
    href: "/residents",
    icon: Users,
  },
  {
    name: "Finance & Cashbook",
    href: "/finance",
    icon: CreditCard,
  },
  {
    name: "Kitchen & Meals",
    href: "/kitchen",
    icon: UtensilsCrossed,
  },
  {
    name: "Tiffin Delivery",
    href: "/delivery",
    icon: Truck,
  },
];

export function ErpShell({ user, children, isDemo = false }: ErpShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const roleStyle = ROLE_BADGE_STYLES[user.role] || {
    bg: "bg-[#1A2E20]/10",
    text: "text-[#1A2E20]",
    border: "border-[#1A2E20]/25",
  };

  const currentDateStr = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Logout error:", err);
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex flex-col lg:flex-row font-sans">
      
      {/* ============================================================== */}
      {/* DESKTOP SIDEBAR (Botanical Deep Evergreen Luxury)              */}
      {/* ============================================================== */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 xl:w-72 bg-[#1A2E20] text-white border-r border-[#263B2D] fixed inset-y-0 left-0 z-30 overflow-hidden select-none">
        
        {/* Brand Area */}
        <div className="p-5 border-b border-white/10 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-white p-1.5 flex items-center justify-center shrink-0 shadow-sm">
            <Image
              src="/logo.png"
              alt="Ravinarayan Logo"
              width={30}
              height={30}
              className="object-contain"
            />
          </div>
          <div className="overflow-hidden">
            <h1 className="text-sm font-semibold tracking-wide text-white leading-tight">
              Ravinarayan
            </h1>
            <p className="text-[11px] font-medium text-[#C89F6B] tracking-wide mt-0.5">
              Management ERP
            </p>
          </div>
        </div>

        {/* Navigation Group: OPERATIONS */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-hidden" aria-label="Operations Navigation">
          <div className="px-3 mb-2 text-[11px] uppercase tracking-wider text-[#A8B9A1] font-semibold">
            OPERATIONS
          </div>

          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#263B2D] text-white shadow-xs border-l-4 border-[#B58A57] pl-3"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? "text-[#C89F6B]" : "text-white/60"
                    }`}
                  />
                  <span className="truncate">{item.name}</span>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C89F6B] shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Account Area */}
        <div className="p-4 border-t border-white/10 bg-[#16221A]">
          <div className="flex items-center gap-3 mb-3 overflow-hidden">
            <div className="w-9 h-9 rounded-full bg-[#263B2D] border border-[#8E9F89]/30 text-[#C89F6B] font-semibold text-xs flex items-center justify-center shrink-0">
              {user.fullName.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {user.fullName}
              </p>
              <p className="text-[11px] text-[#A8B9A1] font-medium truncate mt-0.5">
                {roleLabel}
              </p>
            </div>
          </div>

          <div className="pt-2.5 border-t border-white/10 flex items-center justify-between">
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white transition-colors"
              title="Open public website"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Public Site</span>
            </a>

            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#C89F6B] hover:text-white transition-colors font-medium"
            >
              <LogOut className="w-3 h-3" />
              <span>{isLoggingOut ? "Signing Out..." : "Sign Out"}</span>
            </button>
          </div>
        </div>

      </aside>

      {/* ============================================================== */}
      {/* MOBILE TOP BAR                                                 */}
      {/* ============================================================== */}
      <header className="lg:hidden bg-[#1A2E20] text-white border-b border-[#263B2D] p-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white p-1 flex items-center justify-center shrink-0 shadow-xs">
            <Image
              src="/logo.png"
              alt="Ravinarayan Logo"
              width={26}
              height={26}
              className="object-contain"
            />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white leading-none">
              Ravinarayan
            </h1>
            <span className="text-[10px] text-[#C89F6B] font-medium">
              Management ERP
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle navigation menu"
          className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-[#1A2E20] text-white border-t border-[#263B2D] p-6 max-h-[85vh] overflow-y-auto rounded-t-3xl shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#263B2D] border border-[#8E9F89]/30 text-[#C89F6B] font-semibold text-sm flex items-center justify-center">
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{user.fullName}</h3>
                  <p className="text-xs text-[#A8B9A1]">{roleLabel}</p>
                </div>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-medium ${
                      isActive
                        ? "bg-[#263B2D] text-white border-l-4 border-[#B58A57] pl-3"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${isActive ? "text-[#C89F6B]" : "text-white/60"}`} />
                      <span>{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/70 hover:text-white flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Public Site</span>
              </a>

              <button
                onClick={handleLogout}
                className="text-xs text-[#C89F6B] hover:text-white flex items-center gap-1.5 font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MAIN CONTENT AREA                                              */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 xl:pl-72">
        
        {/* Desktop Top Header Bar */}
        <header className="hidden lg:flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3.5 bg-white border-b border-[#8E9F89]/20 sticky top-0 z-20 shadow-2xs min-w-0 flex-wrap gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1A2E20] truncate">
              Ravinarayan Management
            </h2>
          </div>

          <div className="flex items-center gap-3 sm:gap-5 flex-wrap min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#5A6C5E] whitespace-nowrap">
              <Calendar className="w-3.5 h-3.5 text-[#B58A57] shrink-0" />
              <span>{currentDateStr}</span>
            </div>

            <div className="h-4 w-[1px] bg-[#8E9F89]/25 shrink-0" />

            <NotificationBell />

            <div className="h-4 w-[1px] bg-[#8E9F89]/25 shrink-0" />

            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border shrink-0 ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
              >
                {roleLabel}
              </span>
              <span className="text-xs text-[#1A2E20] font-medium truncate">
                {user.fullName}
              </span>
            </div>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">
          {children}
        </main>

        {/* Footer */}
        <footer className="px-6 py-4 bg-white border-t border-[#8E9F89]/20 text-xs text-[#5A6C5E] flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            &copy; {new Date().getFullYear()} Ravinarayan PG Guesthouse. Internal Management ERP.
          </p>
          <p className="text-[11px] text-[#8E9F89]">
            Operational Management Portal
          </p>
        </footer>

      </div>
    </div>
  );
}
