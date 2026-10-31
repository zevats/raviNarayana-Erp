"use client";

import React from "react";
import "@/styles/globals.css";
import { StatusPage } from "@/components/feedback/StatusPage";

/** Last-resort boundary (the root layout itself failed): a full document with the same page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-[#FAF8F5]">
        <StatusPage code="Something went wrong" title="The app could not start" message="Please try again. If it keeps happening, tell your manager and share the reference below." onRetry={reset} reference={error?.digest} />
      </body>
    </html>
  );
}
