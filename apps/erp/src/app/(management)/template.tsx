/**
 * Re-mounts on every navigation inside the manager ERP, so each page enters with the shared
 * fade-and-rise (styles/glass.css .rn-page; off under prefers-reduced-motion).
 */
export default function ManagementTemplate({ children }: { children: React.ReactNode }) {
  return <div className="rn-page">{children}</div>;
}
