"use client";

import React, { useCallback, useRef, useState } from "react";
import { RefreshCw, SearchX, Inbox, AlertTriangle, Lock, FileQuestion, WifiOff } from "lucide-react";
import { BikeLoader } from "@/components/feedback/BikeLoader";

/**
 * The states every list and page can be in, each with its own wording so people can tell them
 * apart: nothing exists yet, nothing matches the filters, still loading, the request failed,
 * no permission, the record does not exist, offline. One visual structure for all of them:
 * a small icon in a soft circle, a short heading, at most one sentence, an optional action.
 */
type Kind = "empty" | "filtered" | "error" | "forbidden" | "notFound" | "offline";

const ICON: Record<Kind, React.ElementType> = {
  empty: Inbox,
  filtered: SearchX,
  error: AlertTriangle,
  forbidden: Lock,
  notFound: FileQuestion,
  offline: WifiOff,
};

export function StateMessage({
  kind = "empty",
  title,
  children,
  action,
  compact = false,
  className = "",
}: {
  kind?: Kind;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICON[kind];
  const tone = kind === "error" ? "rn-state-bad" : kind === "forbidden" || kind === "offline" ? "rn-state-warn" : "";
  return (
    <div role={kind === "error" ? "alert" : undefined} className={`rn-state ${tone} ${compact ? "py-6" : "py-12"} ${className}`}>
      {kind === "empty" ? (
        <span className="rn-state-icon rn-state-brand" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-home.png" alt="" width={44} height={44} />
        </span>
      ) : (
        <span className="rn-state-icon" aria-hidden><Icon /></span>
      )}
      <p className="rn-t-card mt-3">{title}</p>
      {children && <p className="rn-t-meta mt-1 max-w-[42ch] mx-auto">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Nothing has been recorded yet. */
export const EmptyData = (p: Omit<React.ComponentProps<typeof StateMessage>, "kind">) => <StateMessage kind="empty" {...p} />;
/** Records exist, but none match the search or filters: offer to clear them. */
export function NoMatches({ onClear, title = "No results match these filters", children }: { onClear?: () => void; title?: string; children?: React.ReactNode }) {
  return (
    <StateMessage kind="filtered" title={title} action={onClear ? <button type="button" className="rn-btn rn-btn-sm" onClick={onClear}>Clear filters</button> : undefined}>
      {children}
    </StateMessage>
  );
}
/** The request failed: say so, and offer to try again. */
export function LoadError({ message, onRetry, title = "Could not load this" }: { message?: string | null; onRetry?: () => void; title?: string }) {
  return (
    <StateMessage kind="error" title={title} action={onRetry ? <button type="button" className="rn-btn rn-btn-sm" onClick={onRetry}>Try again</button> : undefined}>
      {message || "Check the connection and try again."}
    </StateMessage>
  );
}
export const NoAccess = ({ children }: { children?: React.ReactNode }) => (
  <StateMessage kind="forbidden" title="You don't have access to this">{children}</StateMessage>
);
export const NotFound = ({ what = "record", action }: { what?: string; action?: React.ReactNode }) => (
  <StateMessage kind="notFound" title={`This ${what} does not exist`} action={action} />
);
export const Offline = () => <StateMessage kind="offline" title="You are offline" />;

/** Loading inside a card or page section (the section's own loader: house or scooter). */
export function Loading({ label = "Loading…", className = "py-12" }: { label?: string; className?: string }) {
  return <BikeLoader label={label} className={className} />;
}

/** Placeholder lines while a list loads, at the height of the real rows (no layout jump). */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="rn-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <span className="rn-skel w-8 h-8 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="rn-skel block h-3 w-1/3 rounded" />
            <span className="rn-skel block h-2.5 w-1/5 rounded" />
          </span>
          <span className="rn-skel h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * Refresh control: spins while the refresh runs, ignores clicks until it finishes, and shows a
 * short note if it failed. `onRefresh` may return a promise; `busy` covers refreshes started
 * elsewhere (e.g. background revalidation).
 */
export function RefreshButton({ onRefresh, busy = false, label = "Refresh" }: { onRefresh: () => unknown | Promise<unknown>; busy?: boolean; label?: string }) {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const spinning = running || busy;
  const run = useCallback(async () => {
    if (lock.current || busy) return;
    lock.current = true;
    setRunning(true);
    setFailed(false);
    try {
      await onRefresh();
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 4000);
    } finally {
      lock.current = false;
      setRunning(false);
    }
  }, [onRefresh, busy]);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={run}
        aria-label={label}
        title={failed ? "Refresh failed — try again" : label}
        aria-busy={spinning}
        className={`rn-btn rn-btn-icon rn-refresh ${spinning ? "is-spinning" : ""} ${failed ? "rn-refresh-failed" : ""}`}
      >
        <RefreshCw />
      </button>
      {failed && <span role="status" className="sr-only">Refresh failed</span>}
    </span>
  );
}
