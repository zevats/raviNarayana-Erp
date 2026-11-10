"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { friendlyError } from "@/lib/friendlyError";

/** How long a message stays on screen: confirmations and info 6 s, errors 12 s (time to read them). */
export const MESSAGE_MS = 6000;
export const ERROR_MESSAGE_MS = 12000;

function isError(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.tone === "error" || o.ok === false || o.type === "error";
}

/**
 * State for a message shown on the page (success, status, information or error). It works like
 * useState, but the message clears itself after a time limit, so nothing stays on screen after it
 * stopped being true. A new message restarts the timer.
 */
/** Messages are shown in plain language: technical text is translated, internal ids removed. */
function plain<T>(v: T): T {
  if (typeof v === "string") return friendlyError(v, v) as unknown as T;
  if (v && typeof v === "object") {
    const o = { ...(v as Record<string, unknown>) };
    for (const k of ["text", "message"]) if (typeof o[k] === "string") o[k] = friendlyError(o[k], o[k] as string);
    return o as T;
  }
  return v;
}

export function useTimedMessage<T>(initial: T | null = null): [T | null, Dispatch<SetStateAction<T | null>>] {
  const [raw, setRaw] = useState<T | null>(initial);
  const value = raw === null || raw === undefined ? raw : plain(raw);
  const setValue = setRaw;
  useEffect(() => {
    if (raw === null || raw === undefined || (raw as unknown) === "") return;
    const t = setTimeout(() => setRaw(null), isError(raw) ? ERROR_MESSAGE_MS : MESSAGE_MS);
    return () => clearTimeout(t);
  }, [raw]);
  return [value, setValue];
}
