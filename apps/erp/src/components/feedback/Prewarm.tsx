"use client";

import React, { startTransition, useEffect, useState } from "react";

const HIDDEN: React.CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  width: "100vw",
  height: "100dvh",
  overflow: "hidden",
  // Off screen and invisible: never seen, never tapped, its links are never prefetched.
  transform: "translateX(-300vw)",
  visibility: "hidden",
  pointerEvents: "none",
  zIndex: -1,
};

/*
 * One drawing at a time, each in its own fully idle moment (nothing to draw, no input waiting):
 * the warm-ups never pile up into one long task, and never run while someone is using the page.
 */
const queue: Array<() => void> = [];
let scheduled = false;

function idle(cb: (fullyIdle: boolean) => void) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback((d) => cb(!d.didTimeout && d.timeRemaining() >= 40));
  else window.setTimeout(() => cb(true), 200);
}

function pump() {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  idle((fullyIdle) => {
    scheduled = false;
    if (fullyIdle) queue.shift()?.();
    // The drawing itself takes the next frames; the next one waits for a later idle moment.
    if (queue.length) window.setTimeout(pump, 300);
  });
}

function enqueue(run: () => void): () => void {
  queue.push(run);
  pump();
  return () => {
    const i = queue.indexOf(run);
    if (i >= 0) queue.splice(i, 1);
  };
}

/**
 * Draws a pop-up once, hidden and off screen, while the phone is idle after the page settles, and
 * removes it two frames later. The first-time work (code, styles, layout) is done ahead, so the
 * first real opening answers as quickly as every later one.
 */
export function Prewarm({ when, delayMs = 2500, children }: { when: boolean; delayMs?: number; children: () => React.ReactNode }) {
  const [phase, setPhase] = useState<"wait" | "draw" | "done">("wait");

  useEffect(() => {
    if (!when || phase !== "wait") return;
    let dequeue = () => {};
    const timer = window.setTimeout(() => {
      dequeue = enqueue(() => startTransition(() => setPhase("draw")));
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      dequeue();
    };
  }, [when, phase, delayMs]);

  useEffect(() => {
    if (phase !== "draw") return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setPhase("done"));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [phase]);

  if (phase !== "draw") return null;
  return (
    <div data-rn-prewarm="" aria-hidden="true" style={HIDDEN}>
      {children()}
    </div>
  );
}
