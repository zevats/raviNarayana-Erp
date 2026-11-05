"use client";

/**
 * Loads code-split modules (dialogs, secondary tabs) once the page has finished its own work, so
 * the first click on "New order" or "Record payment" opens at once instead of waiting for a
 * download. The page itself still loads without them. Returns a cancel function for effects.
 */
export function preloadWhenIdle(loaders: Array<() => Promise<unknown>>): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    // One module at a time keeps the main thread free between them.
    loaders.reduce<Promise<unknown>>((prev, load) => prev.then(() => (cancelled ? undefined : load().catch(() => undefined))), Promise.resolve());
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 2500 });
    return () => {
      cancelled = true;
      w.cancelIdleCallback?.(id);
    };
  }
  const t = setTimeout(run, 1200);
  return () => {
    cancelled = true;
    clearTimeout(t);
  };
}
