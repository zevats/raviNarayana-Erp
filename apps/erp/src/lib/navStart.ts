/**
 * Tells the app shell a page change is starting (for navigations made in code, such as opening a
 * notification), so it shows the destination's frame and the progress bar at once.
 */
export function announceNavigation(href: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("erp:nav-start", { detail: href }));
}
