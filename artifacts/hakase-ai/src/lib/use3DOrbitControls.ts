import { useRef, useState, useCallback, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";

export interface OrbitControlOpts {
  rx: number;
  ry: number;
  zoom: number;
  setRx: (v: number) => void;
  setRy: (v: number) => void;
  setZoom: (v: number | ((prev: number) => number)) => void;
  onInteractStart?: () => void;
  onInteractEnd?: () => void;
  rotateSpeed?: number;
  zoomMin?: number;
  zoomMax?: number;
  zoomStep?: number;
  ryRef?: { current: number };
}

export function use3DOrbitControls(opts: OrbitControlOpts) {
  const {
    rx, ry, setRx, setRy, setZoom,
    onInteractStart,
    onInteractEnd,
    rotateSpeed = 0.01,
    zoomMin = 0.3,
    zoomMax = 2.5,
    zoomStep = 0.08,
    ryRef,
  } = opts;

  const dragRef = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    onInteractStart?.();
    dragRef.current = { x: e.clientX, y: e.clientY, rx, ry };
    setDragging(true);
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch {}
  }, [rx, ry, onInteractStart]);

  const onPointerMove = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    const newRy = dragRef.current.ry + dx * rotateSpeed;
    const newRx = dragRef.current.rx + dy * rotateSpeed;
    setRy(newRy);
    setRx(newRx);
    if (ryRef) ryRef.current = newRy;
  }, [rotateSpeed, setRx, setRy, ryRef]);

  const onPointerUp = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    setDragging(false);
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    if (wasDragging) onInteractEnd?.();
  }, [onInteractEnd]);

  const onWheel = useCallback((e: RWheelEvent<HTMLDivElement>) => {
    onInteractStart?.();
    const factor = e.deltaY > 0 ? (1 - zoomStep) : (1 + zoomStep);
    setZoom(prev => Math.max(zoomMin, Math.min(zoomMax, prev * factor)));
  }, [setZoom, zoomMin, zoomMax, zoomStep, onInteractStart]);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onWheel,
      style: { touchAction: "none" as const },
    },
    isDragging: dragging,
  };
}
