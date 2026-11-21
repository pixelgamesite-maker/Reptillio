import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Side drawer with a handle tab on the screen edge. Tap the handle to
 * toggle, or drag it to pull the panel open/closed — it follows the finger
 * and snaps when released.
 */
export function Drawer({ side, open, onOpenChange, label, icon, children, badge }: {
  side: "left" | "right";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; width: number; moved: boolean; startOpen: boolean } | null>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null); // 0 = fully open, width = fully closed

  const sign = side === "left" ? -1 : 1;

  function onPointerDown(e: React.PointerEvent) {
    const width = panelRef.current?.offsetWidth ?? 320;
    drag.current = { startX: e.clientX, width, moved: false, startOpen: open };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 6) d.moved = true;
    if (!d.moved) return;
    const base = d.startOpen ? 0 : d.width;
    // dragging outward (toward screen edge) closes; inward opens
    const next = Math.max(0, Math.min(d.width, base + sign * dx));
    setDragOffset(next);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onOpenChange(!open);
    } else if (dragOffset !== null) {
      onOpenChange(dragOffset < d.width / 2);
    }
    setDragOffset(null);
  }

  // Esc closes on small screens
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const style =
    dragOffset !== null
      ? { transform: `translateX(${sign * dragOffset}px)`, transition: "none" }
      : undefined;

  return (
    <aside
      ref={panelRef}
      className={`drawer drawer-${side} ${open ? "is-open" : ""}`}
      style={style}
      aria-label={label}
    >
      <button
        className="drawer-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragOffset(null);
        }}
        aria-expanded={open}
        aria-label={`${open ? "Close" : "Open"} ${label}`}
      >
        <span className="drawer-handle-icon">{icon}</span>
        <span className="drawer-handle-label">{label}</span>
        {badge && <span className="drawer-handle-badge">{badge}</span>}
        <span className="drawer-handle-grip" aria-hidden="true" />
      </button>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
