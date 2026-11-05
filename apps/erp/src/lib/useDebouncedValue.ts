"use client";

import { useEffect, useState } from "react";

/**
 * The value after it has stopped changing for `ms`. For text that drives a server request
 * (paged search), so typing a word sends one request instead of one per keystroke.
 */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
