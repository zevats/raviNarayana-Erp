"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { phoneProblem } from "@/lib/phone";

/**
 * Inline check for a phone field, shown right under it (like production apps): quiet while the
 * person is still typing the first time, checked when they leave the field, then live as they fix
 * it. The input gets a red outline and aria-invalid; on submit the form is stopped and the cursor
 * goes back to the field, so a wrong number never reaches the server.
 *
 * Place it right after the input, inside the same field wrapper. `inputId` points at the input
 * when the wrapper holds more than one field.
 */
export function PhoneError({ value, required = true, inputId, rule = "mobile" }: { value: string; required?: boolean; inputId?: string; rule?: "mobile" | "resident" }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [touched, setTouched] = useState(false);
  const problem = phoneProblem(value, required, rule);
  const shown = touched ? problem : null;
  const latest = useRef(problem);
  latest.current = problem;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const input =
      (inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null) ||
      (host.parentElement?.querySelector('input[type="tel"], input[inputmode="tel"]') as HTMLInputElement | null);
    if (!input) return;
    const onBlur = () => setTouched(true);
    input.addEventListener("blur", onBlur);
    // Stop the save while the number is wrong (runs before React's own submit handler).
    const form = input.form;
    const onSubmit = (e: Event) => {
      if (!latest.current || !input.isConnected || input.offsetParent === null) return;
      e.preventDefault();
      e.stopPropagation();
      setTouched(true);
      input.focus();
    };
    form?.addEventListener("submit", onSubmit);
    return () => {
      input.removeEventListener("blur", onBlur);
      form?.removeEventListener("submit", onSubmit);
    };
  }, [inputId]);

  useEffect(() => {
    const host = ref.current;
    const input =
      (inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null) ||
      (host?.parentElement?.querySelector('input[type="tel"], input[inputmode="tel"]') as HTMLInputElement | null);
    if (!input) return;
    if (shown) {
      input.setAttribute("aria-invalid", "true");
      if (host?.id) input.setAttribute("aria-describedby", host.id);
    } else {
      input.removeAttribute("aria-invalid");
    }
  }, [shown, inputId]);

  const id = inputId ? `${inputId}-error` : undefined;
  return (
    <p ref={ref} id={id} role={shown ? "alert" : undefined} aria-live="polite" className={shown ? "rn-field-error" : "sr-only"}>
      {shown && <AlertCircle aria-hidden="true" />}
      {shown || ""}
    </p>
  );
}
