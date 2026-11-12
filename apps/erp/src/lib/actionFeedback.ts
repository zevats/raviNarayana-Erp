import { toast } from "@/components/ui/toast";
import { beginBusy } from "@/lib/busy";

/**
 * A message for every action. Screens that confirm or explain an action themselves keep doing so;
 * this covers the ones that do not: whenever something is saved, changed or removed through the
 * API and the screen shows nothing within a moment, a message appears ("Saved." or the reason the
 * server refused). Background work (sign-in, alerts, live updates, list top-ups) is left out, and
 * a request can opt out with the header X-RN-Quiet.
 */
const QUIET = [/^\/api\/auth\//, /^\/api\/push\//, /^\/api\/notifications/, /^\/api\/events/, /^\/api\/health/, /^\/api\/delivery\/manifest/, /^\/api\/delivery\/sync/, /^\/api\/account\/session/, /^\/api\/dev\//];
/** What an on-screen message looks like, so a screen that already answered is left alone. */
const MESSAGE =
  "[role=status], [role=alert], .m-notice, .rn-toast, [class*=bg-emerald-50], [class*=bg-rose-50], [class*=bg-red-50], [class*=bg-green-50], [class*=E4F2E0], [class*=FDECE8], [class*=E6F1E3], [class*=FBF0D9]";

function messageShownSince(nodes: Node[]): boolean {
  return nodes.some((n) => {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    if (!el || !document.contains(el)) return false;
    const hit = el.matches?.(MESSAGE) ? el : el.closest?.(MESSAGE) || el.querySelector?.(MESSAGE);
    return Boolean(hit && (hit.textContent || "").trim().length > 3);
  });
}

function watchable(input: RequestInfo | URL, init?: RequestInit): { method: string } | null {
  try {
    const method = String(init?.method || (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    if (method === "GET" || method === "HEAD") return null;
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return null;
    if (QUIET.some((r) => r.test(url.pathname))) return null;
    const headers = new Headers(init?.headers || (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined));
    if (headers.get("X-RN-Quiet")) return null;
    return { method };
  } catch {
    return null;
  }
}

/** Saves and other changes the person started (not background sync or live updates): the top bar runs. */
const BACKGROUND = [/^\/api\/events/, /^\/api\/push\//, /^\/api\/health/, /^\/api\/delivery\/sync/, /^\/api\/account\/session/, /^\/api\/notifications\/(read|seen)/, /^\/api\/dev\//];
function busyable(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const method = String(init?.method || (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    if (method === "GET" || method === "HEAD") return false;
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/") && !BACKGROUND.some((r) => r.test(url.pathname));
  } catch {
    return false;
  }
}

export function installActionFeedback(): () => void {
  if (typeof window === "undefined" || (window as any).__rnFeedback) return () => {};
  (window as any).__rnFeedback = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const endBusy = busyable(input, init) ? beginBusy() : null;
    try {
      return await feedbackFetch(input, init);
    } finally {
      endBusy?.();
    }
  };
  const feedbackFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const watched = watchable(input, init);
    if (!watched) return original(input, init);
    const startedAt = Date.now();
    const added: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") added.push(r.target);
        r.addedNodes.forEach((n) => added.push(n));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const settle = (text: string, tone: "ok" | "error") => {
      window.setTimeout(() => {
        observer.disconnect();
        if (toast.lastAt() >= startedAt || messageShownSince(added)) return;
        if (tone === "ok") toast.ok(text);
        else toast.error(text);
      }, 650);
    };
    try {
      const res = await original(input, init);
      res
        .clone()
        .json()
        .catch(() => ({}))
        .then((data: any) => {
          if (res.ok) settle(typeof data?.message === "string" && data.message.length < 140 ? data.message : watched.method === "DELETE" ? "Removed." : watched.method === "POST" ? "Saved." : "Changes saved.", "ok");
          else settle(typeof data?.error === "string" ? data.error : res.status === 403 ? "You do not have access to do this." : "That did not work. Please try again.", "error");
        });
      return res;
    } catch (e) {
      settle("No connection. Check the internet and try again.", "error");
      throw e;
    }
  };
  return () => {
    window.fetch = original;
    (window as any).__rnFeedback = false;
  };
}
