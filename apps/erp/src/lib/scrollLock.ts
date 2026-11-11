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
  if (document.querySelector("[aria-modal='true'], .m-sheet-root")) return;
  holders = 0;
  document.body.style.overflow = "";
}
