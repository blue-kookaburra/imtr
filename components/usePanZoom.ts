"use client";

import { useCallback, useRef, useState } from "react";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

// Pointer-based pan/zoom (drag, wheel, pinch) for an SVG viewport.
export function usePanZoom(initial: Transform, kMin = 0.15, kMax = 6) {
  const [t, setT] = useState<Transform>(initial);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; k: number } | null>(null);
  const moved = useRef(false);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      setT((prev) => {
        const k = Math.min(kMax, Math.max(kMin, prev.k * factor));
        const scale = k / prev.k;
        return { k, x: cx - (cx - prev.x) * scale, y: cy - (cy - prev.y) * scale };
      });
    },
    [kMin, kMax]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: 0 };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.current.set(e.pointerId, cur);

      if (pointers.current.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
        setT((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      } else if (pointers.current.size === 2 && pinchStart.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        // zoomAt expects container-relative coords (t.x/t.y translate the
        // SVG group relative to the container's origin).
        const rect = e.currentTarget.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - rect.x, y: (a.y + b.y) / 2 - rect.y };
        const factor = dist / pinchStart.current.dist;
        pinchStart.current.dist = dist;
        moved.current = true;
        zoomAt(mid.x, mid.y, factor);
      }
    },
    [zoomAt]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      zoomAt(e.clientX - rect.x, e.clientY - rect.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    [zoomAt]
  );

  // True if the last gesture was a drag (suppress click-through selection).
  const wasDrag = useCallback(() => moved.current, []);

  return { t, setT, zoomAt, wasDrag, handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel } };
}
