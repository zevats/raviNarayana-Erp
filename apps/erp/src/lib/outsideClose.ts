/**
 * Tapping outside a pop-up closes it, for every pop-up in the app (sheets, dialogs, forms, full
 * screen views), the same way: the tap on the dimmed area presses that pop-up's own close button
 * (×, Close, Cancel or Later). So each pop-up closes exactly as its close button does (a form that
 * asks before discarding still asks; one that is saving keeps its disabled button and stays open).
 *
 * A tap counts only when it starts and ends on the dimmed area itself: a drag that starts inside
 * the pop-up (selecting text, scrolling) and ends outside never closes it.
 */
const ROOTS = '.fixed.inset-0, [aria-modal="true"], .m-sheet-root, [role="dialog"]';
const LAYERS = '.fixed.inset-0, .m-sheet-root, [aria-modal="true"]';
/** Full-screen pop-up containers: a button belongs to the nearest one (a dialog panel inside it is not a layer). */
const SCREENS = ".fixed.inset-0, .m-sheet-root";

function alphaOf(color: string): number {
  if (!color || color === "transparent") return 0;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

/** The dimmed area of an open pop-up (not its panel, and never an ordinary page element). */
function isBackdrop(el: Element): boolean {
  if (!el.isConnected || el.closest("[data-rn-prewarm]")) return false;
  if (!el.closest(ROOTS)) return false;
  const r = el.getBoundingClientRect();
  // It covers the screen...
  if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.9) return false;
  // ...and you can see through it (a panel that fills a phone screen is solid, and keeps its taps).
  const style = getComputedStyle(el);
  if (style.backgroundImage && style.backgroundImage !== "none") return false;
  return alphaOf(style.backgroundColor) < 0.95;
}

function visible(b: HTMLElement): boolean {
  return !b.hasAttribute("disabled") && b.getAttribute("aria-disabled") !== "true" && b.getClientRects().length > 0;
}

/** The pop-up's own close button, in the layer that was tapped (not one in a pop-up beneath it). */
function closeControl(backdrop: Element): HTMLElement | null {
  const layer = backdrop.closest(SCREENS) || backdrop.closest(LAYERS) || backdrop.closest(ROOTS);
  if (!layer) return null;
  // Its own buttons only, not those of another pop-up opened inside it.
  const buttons = Array.from(layer.querySelectorAll<HTMLElement>("button, [role=button]")).filter(
    (b) => visible(b) && (b.closest(SCREENS) || layer) === layer
  );
  const label = (b: HTMLElement) => `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`.trim();
  const text = (b: HTMLElement) => (b.innerText || "").replace(/\s+/g, " ").trim();
  return (
    buttons.find((b) => /^close\b/i.test(label(b))) ||
    buttons.find((b) => !text(b) && b.querySelector("svg.lucide-x")) ||
    buttons.find((b) => /^(cancel|dismiss)\b/i.test(label(b))) ||
    buttons.find((b) => /^(close|cancel|not now|later|×|✕)$/i.test(text(b))) ||
    null
  );
}

export function installOutsideTapClose(): () => void {
  if (typeof window === "undefined") return () => {};
  let downOn: EventTarget | null = null;
  const onDown = (e: PointerEvent) => {
    downOn = e.isPrimary ? e.target : null;
  };
  const onClick = (e: MouseEvent) => {
    const t = e.target;
    const started = downOn;
    downOn = null;
    if (!(t instanceof Element) || t !== started || e.button !== 0) return;
    if (!isBackdrop(t)) return;
    const close = closeControl(t);
    if (!close || close === t) {
      // The dimmed area is itself the close button (sheets): let it do its job.
      return;
    }
    // Only the pop-up's close button acts (a backdrop handler of its own would close it twice).
    e.preventDefault();
    e.stopImmediatePropagation();
    close.click();
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("click", onClick, true);
  };
}
