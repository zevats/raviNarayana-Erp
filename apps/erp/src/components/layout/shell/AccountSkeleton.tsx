/** My account while it loads (Owner and Manager): the page's own cards, drawn in place. */
export function AccountSkeleton() {
  return (
    <div className="space-y-5 min-w-0" role="status" aria-live="polite" aria-label="Opening My account">
      <section className="rn-card p-5 sm:p-6 flex items-center gap-4">
        <span className="rn-skel block w-14 h-14 rounded-full shrink-0" />
        <span className="flex-1 space-y-2">
          <span className="rn-skel block h-4 w-1/2 rounded" />
          <span className="rn-skel block h-3 w-1/3 rounded" />
        </span>
      </section>
      {[0, 1].map((i) => (
        <section key={i} className="rn-card p-5 sm:p-6 space-y-4">
          <span className="rn-skel block h-4 w-1/3 rounded" />
          {[0, 1].map((j) => (
            <span key={j} className="flex items-center gap-3">
              <span className="flex-1 space-y-2">
                <span className="rn-skel block h-3 w-1/4 rounded" />
                <span className="rn-skel block h-3.5 w-2/3 rounded" />
              </span>
              <span className="rn-skel block h-10 w-32 rounded-full" />
            </span>
          ))}
        </section>
      ))}
    </div>
  );
}
