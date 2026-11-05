"use client";

import React from "react";
import { PageHeader } from "@/components/ui/kit";
import { SkeletonRows } from "@/components/ui/states";

/**
 * The destination page's frame, shown by the shell from the moment a section is clicked until the
 * page itself renders. It needs nothing from the server, so it appears at once even while the
 * server is still preparing the page (in `next dev` that includes compiling it), and the previous
 * page is never presented as the destination. The previous page stays mounted but hidden, so an
 * abandoned navigation shows it again unchanged.
 */
export function NavSkeleton({ href, title }: { href: string; title: string }) {
  const path = href.split("?")[0];
  const shape = path === "/dashboard" ? "tiles" : ["/settings", "/account"].includes(path) ? "cards" : "list";
  return (
    <div data-nav-skeleton role="status" aria-live="polite" aria-label={`Opening ${title}`} className="space-y-5 min-w-0">
      <PageHeader title={title} />
      {shape === "tiles" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rn-card p-5 min-h-[156px] space-y-3">
              <span className="rn-skel block h-3 w-1/3 rounded" />
              <span className="rn-skel block h-7 w-1/2 rounded" />
              <span className="rn-skel block h-2.5 w-2/3 rounded" />
            </div>
          ))}
        </div>
      )}
      {shape === "list" && (
        <>
          <div className="rn-card p-4 sm:p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <span className="rn-skel block h-2.5 w-1/2 rounded" />
                <span className="rn-skel block h-6 w-2/3 rounded" />
              </div>
            ))}
          </div>
          <div className="rn-card">
            <div className="p-4 sm:p-5 border-b border-[var(--rn-line)] flex gap-2.5">
              <span className="rn-skel block h-10 flex-1 rounded-full" />
              <span className="rn-skel block h-10 w-28 rounded-full" />
            </div>
            <SkeletonRows rows={6} />
          </div>
        </>
      )}
      {shape === "cards" && (
        <div className="grid gap-5 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rn-card p-5 sm:p-6 space-y-4">
              <span className="rn-skel block h-4 w-1/3 rounded" />
              {Array.from({ length: 4 }).map((__, j) => (
                <span key={j} className="rn-skel block h-10 w-full rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
