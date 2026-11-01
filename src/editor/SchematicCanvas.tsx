// Adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Circuit, ComponentDef, Element, Pt, Rotation, Wire } from '../model/types';
import { createElement, getDevice } from '../library/devices';
import { Box, dist, isElementInBox, isPointOnSegment, isWireInBox, localToWorld, snap, snapPt } from '../utils/geometry';
import { Renderer } from './Renderer';
import { followMove, WireFollower, wireFollowers } from './wireRouting';

interface Props {
  circuit: Circuit;
  onChange: (next: Circuit, recordHistory?: boolean) => void;
  selectedIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  activeDefToPlace: ComponentDef | null;
  onPlacedDef: () => void;
  onDeleteSelected: () => void;
  onRotateSelected: () => void;
  overlay?: React.ReactNode;
  labels?: React.ReactNode;
}

type ConnectedEnd = { wireId: string; pointIndex: number; origPt: Pt };

type DragState =
  | {
      type: 'element';
      id: string;
      startScreen: Pt;
      origElemPos: Pt;
      followers: WireFollower[];
      wasSelectedAtStart: boolean;
      isDragging: boolean;
      hasRecordedHistory: boolean;
    }
  | {
      type: 'wire';
      id: string;
      startScreen: Pt;
      origPts: Pt[];
      slideMode: 'horizontal-slide' | 'vertical-slide' | 'free';
      connectedEnds: ConnectedEnd[];
      wasSelectedAtStart: boolean;
      isDragging: boolean;
      hasRecordedHistory: boolean;
    }
  | {
      type: 'wire-handle';
      wireId: string;
      pointIndex: number;
      startScreen: Pt;
      origPts: Pt[];
      isDragging: boolean;
      hasRecordedHistory: boolean;
    }
  | {
      type: 'selection-move';
      startScreen: Pt;
      origElemPositions: Map<string, Pt>;
      origWirePts: Map<string, Pt[]>;
      isDragging: boolean;
      hasRecordedHistory: boolean;
    }
  | { type: 'box-select'; startWorld: Pt };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

const hitRadius = (e: React.PointerEvent) => (e.pointerType === 'touch' ? 20 : 12);

const moveEnds = (pts: Pt[], ends: ConnectedEnd[], dx: number, dy: number) =>
  pts.map((p, idx) => {
    const end = ends.find((c) => c.pointIndex === idx);
    return end ? { x: end.origPt.x + dx, y: end.origPt.y + dy } : p;
  });

export const SchematicCanvas: React.FC<Props> = ({
  circuit,
  onChange,
  selectedIds,
  onSelectIds,
  activeDefToPlace,
  onPlacedDef,
  onDeleteSelected,
  onRotateSelected,
  overlay,
  labels,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Pt>({ x: 0, y: 0 });
  const [selectionBox, setSelectionBox] = useState<Box | null>(null);
  const [placementRot, setPlacementRot] = useState<Rotation>(0);
  const [wireDraft, setWireDraft] = useState<Pt[]>([]);
  const [wireStartAxis, setWireStartAxis] = useState<'vertical' | 'horizontal' | null>(null);
  const [mouseWorld, setMouseWorld] = useState<Pt | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointersRef = useRef(new Map<number, Pt>());
  const pinchRef = useRef<{ distance: number; center: Pt } | null>(null);

  useEffect(() => setPlacementRot(0), [activeDefToPlace]);

  // Start with the whole circuit in view, then keep the same point centered when the canvas
  // resizes, e.g. when the results panel opens. A page loaded in a hidden tab may have no size
  // yet: the first fit then waits until it gets one.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let [width, height] = [0, 0];

    const fitCircuit = () => {
      const pts = [...circuit.elements, ...circuit.wires.flatMap((w) => w.pts)];
      if (pts.length === 0) return;
      // Wide enough for the values written beside a component at the edge of the circuit
      const margin = 90;
      const [minX, maxX] = [Math.min(...pts.map((p) => p.x)) - margin, Math.max(...pts.map((p) => p.x)) + margin];
      const [minY, maxY] = [Math.min(...pts.map((p) => p.y)) - margin, Math.max(...pts.map((p) => p.y)) + margin];
      const fit = Math.max(MIN_ZOOM, Math.min(1, el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)));
      setZoom(fit);
      setPan({
        x: (el.clientWidth - (maxX - minX) * fit) / 2 - minX * fit,
        y: (el.clientHeight - (maxY - minY) * fit) / 2 - minY * fit,
      });
    };

    const onResize = () => {
      const [newWidth, newHeight] = [el.clientWidth, el.clientHeight];
      if (newWidth === 0 || newHeight === 0) return;
      if (width === 0) fitCircuit();
      else if (newWidth !== width || newHeight !== height) {
        const [dx, dy] = [newWidth - width, newHeight - height];
        setPan((p) => ({ x: p.x + dx / 2, y: p.y + dy / 2 }));
      }
      [width, height] = [newWidth, newHeight];
    };

    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screenToWorld = (screenX: number, screenY: number): Pt => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (screenX - rect.left - pan.x) / zoom, y: (screenY - rect.top - pan.y) / zoom };
  };

  const zoomAround = (screen: Pt, newZoom: number) => {
    const clamped = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const [x, y] = [screen.x - rect.left, screen.y - rect.top];
    setPan({ x: x - (x - pan.x) * (clamped / zoom), y: y - (y - pan.y) * (clamped / zoom) });
    setZoom(clamped);
  };

  // Nearest terminal or wire tip within the magnetic snap radius
  const findNearestTerminal = (worldPt: Pt, maxDist = 12): { label?: string; worldPos: Pt } | null => {
    let best: { label?: string; worldPos: Pt; d: number } | null = null;
    for (const elem of circuit.elements) {
      for (const term of getDevice(elem.def)?.terminals ?? []) {
        const tWorld = localToWorld(elem.x, elem.y, term, elem.rot);
        const d = dist(worldPt, tWorld);
        if (d <= maxDist && (!best || d < best.d)) {
          best = { label: elem.tag ? `${elem.tag}.${term.id}` : term.id, worldPos: snapPt(tWorld), d };
        }
      }
    }
    for (const wire of circuit.wires) {
      // When not drafting, skip selected wires so their resize handles work
      if (wireDraft.length === 0 && selectedIds.has(wire.id)) continue;
      for (const ep of [wire.pts[0], wire.pts[wire.pts.length - 1]]) {
        const d = dist(worldPt, ep);
        // A tighter radius when not drafting, so clicking short segments selects them
        const allowed = wireDraft.length === 0 ? Math.min(maxDist, 7) : maxDist;
        if (d <= allowed && (!best || d < best.d)) best = { worldPos: snapPt(ep), d };
      }
    }
    return best;
  };

  const computeOrthogonalCorner = (start: Pt, target: Pt): Pt => {
    const axis = wireStartAxis ?? (Math.abs(target.y - start.y) >= Math.abs(target.x - start.x) ? 'vertical' : 'horizontal');
    return axis === 'vertical' ? { x: start.x, y: target.y } : { x: target.x, y: start.y };
  };

  const resetDraft = () => {
    setWireDraft([]);
    setWireStartAxis(null);
  };

  const startWire = (p: Pt) => {
    setWireDraft([p]);
    setWireStartAxis(null);
  };

  const completeWire = (rawTarget: Pt) => {
    if (wireDraft.length === 0) return;
    const start = wireDraft[wireDraft.length - 1];
    const target = snapPt(rawTarget);
    resetDraft();
    if (dist(start, target) < 2) return;
    const corner = computeOrthogonalCorner(start, target);
    const hasCorner = dist(start, corner) > 2 && dist(corner, target) > 2;
    const ts = Date.now();
    const newWires: Wire[] = hasCorner
      ? [
          { id: `wire_${ts}_a`, pts: [start, corner] },
          { id: `wire_${ts}_b`, pts: [corner, target] },
        ]
      : [{ id: `wire_${ts}`, pts: [start, target] }];
    onChange({ ...circuit, wires: [...circuit.wires, ...newWires] });
  };

  const hoveredTerminal = (() => {
    if (!mouseWorld || activeDefToPlace || isPanning) return null;
    const near = findNearestTerminal(mouseWorld);
    return near ? { x: near.worldPos.x, y: near.worldPos.y, label: near.label } : null;
  })();

  const displayDraft = (() => {
    if (wireDraft.length === 0 || !mouseWorld) return wireDraft;
    const start = wireDraft[wireDraft.length - 1];
    const snapped = findNearestTerminal(mouseWorld)?.worldPos ?? snapPt(mouseWorld);
    const corner = computeOrthogonalCorner(start, snapped);
    return dist(start, corner) > 2 && dist(corner, snapped) > 2 ? [start, corner, snapped] : [start, snapped];
  })();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        onDeleteSelected();
      } else if (e.key === 'r' || e.key === 'R') {
        if (e.ctrlKey || e.metaKey) return;
        if (activeDefToPlace) setPlacementRot((prev) => ((prev + 90) % 360) as Rotation);
        else if (selectedIds.size > 0) onRotateSelected();
      } else if (e.key === 'Escape') {
        resetDraft();
        setSelectionBox(null);
        onPlacedDef();
        onSelectIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Global safeguard so dragging never gets stuck to the pointer
  useEffect(() => {
    const release = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      pinchRef.current = null;
      setIsPanning(false);
      setSelectionBox(null);
      dragRef.current = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  // React registers wheel listeners as passive, and preventDefault needs a non-passive one
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAround({ x: e.clientX, y: e.clientY }, zoom * (e.deltaY < 0 ? 1.15 : 0.87));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const measurePinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    return { distance: Math.max(dist(a, b), 1), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  // Runs before any child handler, so a second finger always means pinch
  const handlePointerDownCapture = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      e.stopPropagation();
      dragRef.current = null;
      setIsPanning(false);
      setSelectionBox(null);
      resetDraft();
      pinchRef.current = measurePinch();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.altKey || e.shiftKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);
    const snapped = snapPt(world);

    if (activeDefToPlace) {
      const newElem = createElement(activeDefToPlace, snapped, placementRot, circuit, `elem_${Date.now()}`);
      onChange({ ...circuit, elements: [...circuit.elements, newElem] });
      onSelectIds(new Set([newElem.id]));
      onPlacedDef();
      return;
    }

    const nearTerm = findNearestTerminal(world, hitRadius(e));
    if (wireDraft.length > 0) {
      completeWire(nearTerm ? nearTerm.worldPos : snapped);
      return;
    }
    if (nearTerm) {
      startWire(nearTerm.worldPos);
      return;
    }

    // Empty canvas: one finger pans, the mouse draws a selection box
    if (e.pointerType === 'touch') {
      onSelectIds(new Set());
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    dragRef.current = { type: 'box-select', startWorld: world };
    setSelectionBox({ x1: world.x, y1: world.y, x2: world.x, y2: world.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const prev = pinchRef.current;
      const next = measurePinch();
      pinchRef.current = next;
      const newZoom = Math.min(Math.max((zoom * next.distance) / prev.distance, MIN_ZOOM), MAX_ZOOM);
      const rect = containerRef.current!.getBoundingClientRect();
      const [px, py] = [prev.center.x - rect.left, prev.center.y - rect.top];
      const [nx, ny] = [next.center.x - rect.left, next.center.y - rect.top];
      setPan({ x: nx - (px - pan.x) * (newZoom / zoom), y: ny - (py - pan.y) * (newZoom / zoom) });
      setZoom(newZoom);
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    setMouseWorld(world);

    // Lock the initial pull axis when drawing a wire
    if (wireDraft.length > 0) {
      const start = wireDraft[wireDraft.length - 1];
      const s = snapPt(world);
      const [dx, dy] = [Math.abs(s.x - start.x), Math.abs(s.y - start.y)];
      if (dx < 10 && dy < 10) {
        if (wireStartAxis !== null) setWireStartAxis(null);
      } else if (dy === 0) {
        if (wireStartAxis !== 'horizontal') setWireStartAxis('horizontal');
      } else if (dx === 0) {
        if (wireStartAxis !== 'vertical') setWireStartAxis('vertical');
      } else if (wireStartAxis === null) {
        setWireStartAxis(dx > dy ? 'horizontal' : 'vertical');
      }
    }

    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === 'box-select') {
      const box: Box = { x1: drag.startWorld.x, y1: drag.startWorld.y, x2: world.x, y2: world.y };
      setSelectionBox(box);
      const selected = new Set<string>();
      for (const el of circuit.elements) if (isElementInBox(el, box)) selected.add(el.id);
      for (const w of circuit.wires) if (isWireInBox(w.pts, box)) selected.add(w.id);
      onSelectIds(selected);
      return;
    }

    // A wire moves only if it was already selected before the press
    if (drag.type === 'wire' && !drag.wasSelectedAtStart) return;

    if (!drag.isDragging && Math.hypot(e.clientX - drag.startScreen.x, e.clientY - drag.startScreen.y) > 4) {
      drag.isDragging = true;
    }
    if (!drag.isDragging) return;

    const dx = (e.clientX - drag.startScreen.x) / zoom;
    const dy = (e.clientY - drag.startScreen.y) / zoom;
    const [snapDx, snapDy] = [snap(dx), snap(dy)];
    const record = !drag.hasRecordedHistory;
    drag.hasRecordedHistory = true;

    if (drag.type === 'selection-move') {
      onChange(
        {
          ...circuit,
          elements: circuit.elements.map((el) => {
            const orig = drag.origElemPositions.get(el.id);
            return orig ? { ...el, x: orig.x + snapDx, y: orig.y + snapDy } : el;
          }),
          wires: circuit.wires.map((w) => {
            const orig = drag.origWirePts.get(w.id);
            return orig ? { ...w, pts: orig.map((p) => ({ x: p.x + snapDx, y: p.y + snapDy })) } : w;
          }),
        },
        record,
      );
    } else if (drag.type === 'element') {
      const [newX, newY] = [snap(drag.origElemPos.x + dx), snap(drag.origElemPos.y + dy)];
      const [moveX, moveY] = [newX - drag.origElemPos.x, newY - drag.origElemPos.y];
      onChange(
        {
          ...circuit,
          elements: circuit.elements.map((el) => (el.id === drag.id ? { ...el, x: newX, y: newY } : el)),
          // Wires stay attached to the terminals of the moved element
          wires: circuit.wires.map((w) => {
            const follower = drag.followers.find((f) => f.wireId === w.id);
            return follower ? { ...w, pts: followMove(follower, moveX, moveY) } : w;
          }),
        },
        record,
      );
    } else if (drag.type === 'wire') {
      const effDx = drag.slideMode === 'vertical-slide' ? 0 : snapDx;
      const effDy = drag.slideMode === 'horizontal-slide' ? 0 : snapDy;
      onChange(
        {
          ...circuit,
          wires: circuit.wires.map((w) => {
            if (w.id === drag.id) return { ...w, pts: drag.origPts.map((p) => ({ x: p.x + effDx, y: p.y + effDy })) };
            const ends = drag.connectedEnds.filter((c) => c.wireId === w.id);
            return ends.length ? { ...w, pts: moveEnds(w.pts, ends, effDx, effDy) } : w;
          }),
        },
        record,
      );
    } else if (drag.type === 'wire-handle') {
      const snapped = snapPt(world);
      onChange(
        {
          ...circuit,
          wires: circuit.wires.map((w) =>
            w.id === drag.wireId
              ? { ...w, pts: drag.origPts.map((p, idx) => (idx === drag.pointIndex ? { x: snapped.x, y: snapped.y } : p)) }
              : w,
          ),
        },
        record,
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsPanning(false);

    // Drag-to-wire: releasing away from the start completes the wire
    if (wireDraft.length > 0 && e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY);
      const target = findNearestTerminal(world, hitRadius(e))?.worldPos ?? snapPt(world);
      if (dist(target, wireDraft[0]) >= 10) {
        completeWire(target);
        dragRef.current = null;
        return;
      }
    }

    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'box-select') {
      if (selectionBox && Math.abs(selectionBox.x2 - selectionBox.x1) < 5 && Math.abs(selectionBox.y2 - selectionBox.y1) < 5) {
        onSelectIds(new Set());
      }
      setSelectionBox(null);
    } else if (!drag.isDragging && (drag.type === 'element' || drag.type === 'wire')) {
      onSelectIds(drag.wasSelectedAtStart && selectedIds.size === 1 ? new Set() : new Set([drag.id]));
    }
    dragRef.current = null;
  };

  const startSelectionMove = (e: React.PointerEvent) => {
    const origElemPositions = new Map<string, Pt>();
    for (const el of circuit.elements) if (selectedIds.has(el.id)) origElemPositions.set(el.id, { x: el.x, y: el.y });
    const origWirePts = new Map<string, Pt[]>();
    for (const w of circuit.wires) if (selectedIds.has(w.id)) origWirePts.set(w.id, w.pts.map((p) => ({ ...p })));
    dragRef.current = {
      type: 'selection-move',
      startScreen: { x: e.clientX, y: e.clientY },
      origElemPositions,
      origWirePts,
      isDragging: false,
      hasRecordedHistory: false,
    };
  };

  const handleElementDown = (elem: Element, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);
    if (activeDefToPlace) {
      handlePointerDown(e);
      return;
    }
    const nearTerm = findNearestTerminal(world, e.pointerType === 'touch' ? 14 : 10);
    if (nearTerm) {
      if (wireDraft.length === 0) startWire(nearTerm.worldPos);
      else completeWire(nearTerm.worldPos);
      return;
    }
    if (wireDraft.length > 0) return;

    const isAlreadySelected = selectedIds.has(elem.id);
    if (isAlreadySelected && selectedIds.size > 1) {
      startSelectionMove(e);
      return;
    }
    if (!isAlreadySelected) onSelectIds(new Set([elem.id]));

    const terminalsOf = (el: Element) => (getDevice(el.def)?.terminals ?? []).map((t) => localToWorld(el.x, el.y, t, el.rot));
    const otherTerminals = circuit.elements.filter((el) => el.id !== elem.id).flatMap(terminalsOf);
    dragRef.current = {
      type: 'element',
      id: elem.id,
      startScreen: { x: e.clientX, y: e.clientY },
      origElemPos: { x: elem.x, y: elem.y },
      followers: wireFollowers(circuit.wires, terminalsOf(elem), otherTerminals),
      wasSelectedAtStart: isAlreadySelected,
      isDragging: false,
      hasRecordedHistory: false,
    };
  };

  const handleWireDown = (wire: Wire, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);
    if (activeDefToPlace) {
      handlePointerDown(e);
      return;
    }
    if (wireDraft.length > 0) {
      completeWire(findNearestTerminal(world, hitRadius(e))?.worldPos ?? snapPt(world));
      return;
    }

    const isAlreadySelected = selectedIds.has(wire.id);
    // Pressing near the tip of an unselected wire starts a new wire from that tip
    if (!isAlreadySelected) {
      const nearTerm = findNearestTerminal(world, hitRadius(e));
      if (nearTerm) {
        startWire(nearTerm.worldPos);
        return;
      }
    }
    if (isAlreadySelected && selectedIds.size > 1) {
      startSelectionMove(e);
      return;
    }

    // Perpendicular wires ending on this segment follow it as it slides
    const connectedEnds: ConnectedEnd[] = [];
    let slideMode: 'horizontal-slide' | 'vertical-slide' | 'free' = 'free';
    if (wire.pts.length === 2) {
      const [p0, p1] = wire.pts;
      const isVertical = Math.abs(p0.x - p1.x) < 1 && Math.abs(p0.y - p1.y) >= 1;
      const isHorizontal = Math.abs(p0.y - p1.y) < 1 && Math.abs(p0.x - p1.x) >= 1;
      for (const other of circuit.wires) {
        if (other.id === wire.id || other.pts.length < 2) continue;
        for (const idx of [0, other.pts.length - 1]) {
          const ep = other.pts[idx];
          const adj = idx === 0 ? other.pts[1] : other.pts[other.pts.length - 2];
          if (!isPointOnSegment(ep, p0, p1, 2)) continue;
          if ((isVertical && Math.abs(ep.y - adj.y) < 1) || (isHorizontal && Math.abs(ep.x - adj.x) < 1)) {
            connectedEnds.push({ wireId: other.id, pointIndex: idx, origPt: { ...ep } });
          }
        }
      }
      if (isVertical && connectedEnds.length > 0) slideMode = 'horizontal-slide';
      else if (isHorizontal && connectedEnds.length > 0) slideMode = 'vertical-slide';
    }

    dragRef.current = {
      type: 'wire',
      id: wire.id,
      startScreen: { x: e.clientX, y: e.clientY },
      origPts: wire.pts.map((p) => ({ ...p })),
      slideMode,
      connectedEnds,
      wasSelectedAtStart: isAlreadySelected,
      isDragging: false,
      hasRecordedHistory: false,
    };
  };

  const handleWireHandleDown = (wire: Wire, pointIndex: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      type: 'wire-handle',
      wireId: wire.id,
      pointIndex,
      startScreen: { x: e.clientX, y: e.clientY },
      origPts: wire.pts.map((p) => ({ ...p })),
      isDragging: false,
      hasRecordedHistory: false,
    };
  };

  const handleTerminalDown = (worldPos: Pt, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (activeDefToPlace) {
      handlePointerDown(e);
      return;
    }
    if (wireDraft.length === 0) startWire(snapPt(worldPos));
    else completeWire(worldPos);
  };

  const handleTerminalUp = (worldPos: Pt, e: React.PointerEvent) => {
    if (wireDraft.length === 0) return;
    if (dist(snapPt(worldPos), wireDraft[0]) >= 5) {
      e.stopPropagation();
      completeWire(worldPos);
    }
  };

  const ghost =
    activeDefToPlace && mouseWorld ? { def: activeDefToPlace, ...snapPt(mouseWorld), rot: placementRot } : null;

  return (
    <div
      ref={containerRef}
      className="schematic-canvas"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setMouseWorld(null)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        cursor: isPanning ? 'grabbing' : activeDefToPlace ? 'copy' : wireDraft.length > 0 || hoveredTerminal ? 'crosshair' : 'default',
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <Renderer
            circuit={circuit}
            selectedIds={selectedIds}
            selectionBox={selectionBox}
            onElementDown={handleElementDown}
            onWireDown={handleWireDown}
            onWireHandleDown={handleWireHandleDown}
            onTerminalDown={handleTerminalDown}
            onTerminalUp={handleTerminalUp}
            wireDraft={displayDraft}
            ghost={ghost}
            hoveredTerminal={hoveredTerminal}
            overlay={overlay}
            labels={labels}
          />
        </g>
      </svg>
    </div>
  );
};
