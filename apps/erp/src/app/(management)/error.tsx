"use client";

import React, { useEffect } from "react";
import { StatusPage } from "@/components/feedback/StatusPage";

/** A page inside the app failed to render: say so plainly, keep the navigation, offer a retry. */
export default function ManagementError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page error", error?.digest || error?.message);
  }, [error]);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <StatusPage
      code={offline ? "No internet" : "Something went wrong"}
      title={offline ? "You are offline" : "This page could not open"}
      message={offline ? "Check your internet connection, then try again. Nothing you saved is lost." : "We could not load this page. Try again; if it keeps happening, tell your manager and share the reference below."}
      onRetry={reset}
      reference={error?.digest}
    />
  );
}
