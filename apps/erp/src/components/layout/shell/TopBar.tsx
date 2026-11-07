"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, UserRound, ExternalLink, LogOut, Compass } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ROLE_LABELS } from "@/types";
import type { NavLink } from "./nav";

/**
 * Desktop header (reference: floating search pill and round icon buttons, top right).
 * Search jumps to any section the person can open (Ctrl+K or /); it does not search records.
 */
export function TopBar({
  user,
  title,
  trail,
  links,
  websiteUrl,
  onLogout,
  isLoggingOut,
}: {
  user: AuthenticatedUser;
  /** Large heading (dashboard greeting); other pages carry their own heading, so only the trail shows. */
  title: string | null;
  trail: string;
  links: NavLink[];
  websiteUrl: string | null;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date());

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pool = [...links, { key: "account", label: "My account", href: "/account", icon: Search, roles: [] } as NavLink];
    return s ? pool.filter((l) => l.label.toLowerCase().includes(s)) : pool;
  }, [q, links]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "");
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <header className="hidden lg:flex items-start justify-between gap-6 pt-7 pb-5">
      <div className="min-w-0">
        <p className="rn-t-meta">{today}</p>
        {title ? (
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-[var(--rn-ink)] mt-0.5 truncate">{title}</h1>
        ) : (
          <p className="text-[15px] font-medium text-[var(--rn-ink-2)] mt-1 truncate">{trail}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div ref={boxRef} className="relative">
          {/* Page navigation, not a data search: a compass and a shortcut hint, so it does not look
              like the search boxes that filter a page's records. */}
          <div className="rn-glass rounded-full h-12 pl-4 pr-2 flex items-center gap-2.5 w-[340px]">
            <Compass className="w-[18px] h-[18px] shrink-0 text-[var(--rn-ink-3)]" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                if (e.key === "Enter" && results[cursor]) go(results[cursor].href);
              }}
              placeholder="Jump to a page…"
              aria-label="Go to a section"
              role="combobox"
              aria-expanded={open}
              aria-controls="rn-jump-list"
              className="flex-1 min-w-0 bg-transparent text-[13.5px] text-[var(--rn-ink)] placeholder:text-[var(--rn-ink-3)] outline-none border-0 focus:shadow-none"
            />
            <kbd className="shrink-0 h-7 px-2 rounded-lg border border-[var(--rn-line)] bg-white/70 text-[11.5px] font-semibold text-[var(--rn-ink-3)] grid place-items-center font-sans" aria-hidden>
              Ctrl K
            </kbd>
          </div>
          {open && (
            <ul id="rn-jump-list" role="listbox" className="rn-pop rn-rise absolute right-0 mt-2 w-[340px] rounded-3xl p-2 z-50 max-h-[360px] overflow-y-auto">
              {results.length === 0 ? (
                <li className="px-4 py-3 text-[13px] text-[var(--rn-ink-3)]">No section called “{q}”.</li>
              ) : (
                results.map((r, i) => {
                  const Icon = r.icon;
                  return (
                    <li key={r.key} role="option" aria-selected={i === cursor}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => go(r.href)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-left text-[13.5px] ${i === cursor ? "bg-[var(--rn-accent-tint)] text-[var(--rn-ink)]" : "text-[var(--rn-ink-2)]"}`}
                      >
                        <span className="grid place-items-center w-8 h-8 rounded-full bg-white border border-[var(--rn-line)]">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="flex-1">{r.label}</span>
                        {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 text-[var(--rn-ink-3)]" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        <div className="rn-glass rounded-full w-12 h-12 grid place-items-center">
          <NotificationBell />
        </div>
        <ProfileMenu user={user} websiteUrl={websiteUrl} onLogout={onLogout} isLoggingOut={isLoggingOut} />
      </div>
    </header>
  );
}

/** Top-right profile button: who is signed in, My account, the public website, Sign out. */
function ProfileMenu({ user, websiteUrl, onLogout, isLoggingOut }: { user: AuthenticatedUser; websiteUrl: string | null; onLogout: () => void; isLoggingOut: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const initial = (user.fullName.replace(/^(dr|mr|mrs|ms|shri|smt|prof)\.?\s+/i, "").trim()[0] || "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="Profile and account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rn-glass rounded-full w-12 h-12 grid place-items-center rn-hover-lift"
      >
        <span className="grid place-items-center w-[34px] h-[34px] rounded-full bg-[var(--rn-accent)] text-white text-[14px] font-semibold" aria-hidden>{initial}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Profile" className="rn-pop rn-menu absolute right-0 mt-2 w-64 rounded-3xl p-2 z-50">
          <div className="px-3 pt-2 pb-3 border-b border-[var(--rn-line)] mb-1">
            <p className="rn-t-card truncate">{user.fullName}</p>
            <p className="rn-t-meta">{ROLE_LABELS[user.role] || user.role}</p>
          </div>
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="rn-menu-item"><UserRound aria-hidden /> My account</Link>
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setOpen(false)} className="rn-menu-item"><ExternalLink aria-hidden /> Public website</a>
          )}
          <div className="rn-menu-sep" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }} disabled={isLoggingOut} className="rn-menu-item rn-menu-danger">
            <LogOut aria-hidden /> {isLoggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
