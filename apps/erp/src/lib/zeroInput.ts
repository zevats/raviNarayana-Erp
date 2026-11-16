/**
 * Amount and quantity boxes that show 0: typing a number replaces the 0 instead of being added
 * after it ("05", "0250"). One rule for every such box on the site: when the box holds only a
 * zero and a digit is typed, the zero is selected first, so the digit takes its place.
 */
const NUMERIC = 'input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]';
const ONLY_ZERO = /^0+(\.0*)?$/;

export function installZeroInput(): () => void {
  if (typeof document === "undefined") return () => {};
  const onBeforeInput = (e: Event) => {
    const ev = e as InputEvent;
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || !el.matches(NUMERIC) || el.readOnly || el.disabled) return;
    if (ev.inputType !== "insertText" || !ev.data || !/^[0-9]$/.test(ev.data)) return;
    if (!ONLY_ZERO.test(el.value)) return;
    try {
      el.select();
    } catch {
      // The box keeps its normal behaviour.
    }
  };
  document.addEventListener("beforeinput", onBeforeInput, true);
  return () => document.removeEventListener("beforeinput", onBeforeInput, true);
}
