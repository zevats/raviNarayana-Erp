"use client";

import { startTransition, useEffect, useRef, useState } from "react";

/** Runs `fn` once the screen has been drawn (the tapped state is visible), even in a hidden tab. */
function afterPaint(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  window.requestAnimationFrame(() => window.setTimeout(run, 0));
  window.setTimeout(run, 250);
}

/**
 * A choice control (chips, segments, tabs) that answers on the same frame as the tap: the tapped
 * option shows as chosen at once, and the page's own update (a filtered list, a new section, new
 * data) starts after that frame is on screen, as a background render that never holds up the tap.
 */
export function useInstantChoice<T>(value: T, onChange: (v: T) => void): [T, (v: T) => void] {
  const [pending, setPending] = useState<{ v: T } | null>(null);
  const latest = useRef(0);
  // The page caught up (or chose something else): show its value again.
  useEffect(() => setPending(null), [value]);
  const choose = (v: T) => {
    if (v === value) {
      // Back to what the page already shows: drop any choice still on its way.
      latest.current += 1;
      setPending(null);
      return onChange(v);
    }
    setPending({ v });
    // Only the last of several quick taps is applied.
    const mine = ++latest.current;
    afterPaint(() => {
      if (latest.current === mine) startTransition(() => onChange(v));
    });
  };
  return [pending ? pending.v : value, choose];
}
