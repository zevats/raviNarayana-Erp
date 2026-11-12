"use client";

import { useSyncExternalStore } from "react";

/**
 * "Something the person asked for is on its way": new data for a filter, tab, date or page, or a
 * save. While any is running the thin bar at the top of the screen shows, so no button ever looks
 * dead while the server answers. Background refreshes and live polling are not counted.
 */
let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Marks work as started; call the returned function once when it ends (extra calls are ignored). */
export function beginBusy(): () => void {
  active++;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active = Math.max(0, active - 1);
    emit();
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBusy(): boolean {
  return useSyncExternalStore(subscribe, () => active > 0, () => false);
}

/**
 * Lists still showing the previous filter's rows while the new ones load (see useErpQuery
 * isSwitching). The page dims its lists meanwhile, so a tap on a filter shows at once.
 */
let switching = 0;
const switchListeners = new Set<() => void>();
export function beginSwitching(): () => void {
  switching++;
  switchListeners.forEach((l) => l());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    switching = Math.max(0, switching - 1);
    switchListeners.forEach((l) => l());
  };
}
const subscribeSwitch = (l: () => void) => {
  switchListeners.add(l);
  return () => switchListeners.delete(l);
};
export function useSwitching(): boolean {
  return useSyncExternalStore(subscribeSwitch, () => switching > 0, () => false);
}
