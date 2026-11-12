/**
 * One page-scroll lock shared by every pop-up. Each pop-up used to save and restore the page
 * overflow itself; two open at once could restore in the wrong order and leave the page unable to
 * scroll. Here the page is locked while at least one pop-up holds a lock and freed when the last
 * one lets go, in whatever order they close.
 */
let holders = 0;

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  holders += 1;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.style.overflow = "";
  };
}

/** After a page change nothing may keep the page locked (a pop-up closed by navigation). */
export function resetScrollLock(): void {
  if (typeof document === "undefined") return;
  if (shown("[aria-modal='true'], .m-sheet-root")) return;
  holders = 0;
  document.body.style.overflow = "";
}

const OVERLAY = '.rn-sheet, [aria-modal="true"], .fixed.inset-0.z-50';

/** Whether a pop-up matching the selector is open (a hidden warm-up drawing does not count). */
function shown(selector: string): boolean {
  const first = document.querySelector(selector);
  if (!first) return false;
  if (!first.closest("[data-rn-prewarm]")) return true;
  return Array.from(document.querySelectorAll(selector)).some((el) => !el.closest("[data-rn-prewarm]"));
}

/**
 * Locks page scrolling while any sheet, dialog or full-screen overlay is on screen (including the
 * older pop-ups that do not call lockScroll). Checks once per frame after the page changes.
 */
export function installOverlayScrollLock(): () => void {
  if (typeof document === "undefined") return () => {};
  let frame = 0;
  const check = () => {
    frame = 0;
    // An attribute, not a class: a class change on the page root restyles the whole page here
    // (the app has rules that match parts of class names).
    document.documentElement.toggleAttribute("data-rn-overlay", shown(OVERLAY));
  };
  const queue = () => {
    if (!frame) frame = window.requestAnimationFrame(check);
  };
  const observer = new MutationObserver(queue);
  observer.observe(document.body, { childList: true, subtree: true });
  check();
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    document.documentElement.removeAttribute("data-rn-overlay");
  };
}
