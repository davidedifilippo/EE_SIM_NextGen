import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Pt } from '../model/types';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;

/**
 * Moving and zooming a drawing in a box of the page: the wheel zooms around the pointer, two fingers pinch,
 * and the canvas calls startPan for a drag on nothing. Fits a box of the drawing once the page has a size.
 */
/** A box of the drawing, by its corner and size. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function usePanZoom(containerRef: React.RefObject<HTMLElement>, fitBox: Area) {
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } as Pt });
  // Several wheel notches can come before the page draws again: each must start from where the last left it
  const current = useRef(view);
  const setBoth = useCallback((zoom: number, pan: Pt) => {
    current.current = { zoom, pan };
    setView(current.current);
  }, []);
  const { zoom, pan } = view;
  const panStart = useRef<Pt | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ distance: number; center: Pt } | null>(null);
  const hasFitted = useRef(false);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return false;
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (el.clientWidth - 24) / fitBox.w, (el.clientHeight - 24) / fitBox.h));
    setBoth(scale, { x: (el.clientWidth - fitBox.w * scale) / 2 - fitBox.x * scale, y: (el.clientHeight - fitBox.h * scale) / 2 - fitBox.y * scale });
    return true;
  }, [containerRef, fitBox, setBoth]);

  // A page loaded in a hidden tab may have no size yet: the first fit then waits until it gets one
  useLayoutEffect(() => {
    if (fit()) {
      hasFitted.current = true;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!hasFitted.current && fit()) hasFitted.current = true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, containerRef]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = containerRef.current!.getBoundingClientRect();
      const { zoom: scale, pan: offset } = current.current;
      return { x: (clientX - rect.left - offset.x) / scale, y: (clientY - rect.top - offset.y) / scale };
    },
    [containerRef],
  );

  const zoomAround = (clientX: number, clientY: number, factor: number) => {
    const { zoom: was, pan: from } = current.current;
    const rect = containerRef.current!.getBoundingClientRect();
    const [x, y] = [clientX - rect.left, clientY - rect.top];
    const clamped = Math.min(Math.max(was * factor, MIN_ZOOM), MAX_ZOOM);
    setBoth(clamped, { x: x - (x - from.x) * (clamped / was), y: y - (y - from.y) * (clamped / was) });
  };

  const onWheel = (e: React.WheelEvent) => zoomAround(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 0.87);

  /** Every pointer goes through here first; true while two fingers pinch, when nothing else should happen. */
  const trackDown = (e: React.PointerEvent): boolean => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      panStart.current = null;
      return true;
    }
    return false;
  };

  const trackMove = (e: React.PointerEvent): boolean => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = containerRef.current!.getBoundingClientRect();
      const { zoom: was, pan: from } = current.current;
      const next = Math.min(Math.max((was * distance) / pinch.current.distance, MIN_ZOOM), MAX_ZOOM);
      const [px, py] = [pinch.current.center.x - rect.left, pinch.current.center.y - rect.top];
      const [nx, ny] = [center.x - rect.left, center.y - rect.top];
      setBoth(next, { x: nx - (px - from.x) * (next / was), y: ny - (py - from.y) * (next / was) });
      pinch.current = { distance, center };
      return true;
    }
    if (panStart.current) {
      setBoth(current.current.zoom, { x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return true;
    }
    return false;
  };

  const trackUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    panStart.current = null;
  };

  const startPan = (e: React.PointerEvent) => {
    panStart.current = { x: e.clientX - current.current.pan.x, y: e.clientY - current.current.pan.y };
  };

  return { zoom, pan, toWorld, onWheel, trackDown, trackMove, trackUp, startPan, isPinching: () => pinch.current !== null, fit };
}
