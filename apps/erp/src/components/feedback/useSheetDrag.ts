import React from "react";

/**
 * Pull-down to close for a bottom sheet (phones): when the sheet is scrolled to the top, dragging
 * down moves it with the finger and shrinks it slightly; past 90 px it closes, else it springs back.
 */
export function useSheetDrag(onClose: () => void, active: boolean) {
  const [dy, setDy] = React.useState(0);
  const start = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!active) setDy(0);
  }, [active]);
  const bind = {
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => {
      start.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null;
    },
    onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => {
      if (start.current === null) return;
      const d = e.touches[0].clientY - start.current;
      setDy(d > 0 ? d : 0);
    },
    onTouchEnd: () => {
      if (start.current !== null && dy > 90) onClose();
      start.current = null;
      setDy(0);
    },
  };
  const style: React.CSSProperties | undefined = dy ? { transform: `translateY(${dy}px) scale(${1 - Math.min(dy, 240) / 3000})`, transition: "none", transformOrigin: "50% 0%" } : undefined;
  return { bind, style };
}
