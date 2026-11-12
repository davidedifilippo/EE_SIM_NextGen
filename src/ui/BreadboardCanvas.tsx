import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_BOX, COLUMNS, GROOVE_Y, HOLES, holeAt, PITCH, RAILS, ROW_LABELS, snapToPitch } from '../breadboard/board';
import { compareWithSchematic, comparisonSummary, isMounted } from '../breadboard/compare';
import { holdOnBoard, pressOnBoard, addJumper, changeJumper, jumpersOf, movedPlace, placeAt, updateElements } from '../breadboard/edit';
import { footprintOf, pinPoints } from '../breadboard/footprints';
import { BenchSupplyDefs, glowSpot, PartArt, SUPPLY_LAMP, supplyAmps, supplyVolts } from '../breadboard/art/PartArt';
import { usePanZoom } from '../editor/usePanZoom';
import { createElement, getDevice } from '../library/devices';
import { Circuit, ComponentDef, Pt } from '../model/types';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { lampBrightness, lampRating } from '../realtime/lamp';
import { snapPt } from '../utils/geometry';
import { ledBrightness } from './LogicView';

interface Props {
  circuit: Circuit;
  onChange: (next: Circuit, record?: boolean) => void;
  selectedIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  activeDefToPlace: ComponentDef | null;
  onPlacedDef: () => void;
  onRotateSelected: () => void;
  onDeleteSelected: () => void;
  layout: LiveLayout | null;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

type Drag = { kind: 'part'; id: string; start: Pt; moved: boolean } | { kind: 'leg'; id: string; leg: 0 | 1 } | { kind: 'jumperEnd'; id: string; end: 'a' | 'b' } | { kind: 'newJumper'; from: Pt } | { kind: 'press'; id: string } | { kind: 'pan' };

/** How long the line stays once everything is joined as in the schematic. */
const OK_SHOWN_MS = 4000;
const REFRESH_MS = 100;
/** How near a hole a press must be to start a jumper from it, in units of the breadboard. */
const HOLE_REACH = 4;
const BOARD_FIT = {
  x: BOARD_BOX.x - 10,
  y: BOARD_BOX.y - 30,
  w: BOARD_BOX.w + 20,
  h: BOARD_BOX.h + 60,
};

/** Where a new part goes in the schematic when it is added from the breadboard: to the right of the rest. */
function freeSpot(circuit: Circuit): Pt {
  if (circuit.elements.length === 0) return { x: 0, y: 0 };
  const xs = circuit.elements.map((el) => el.x);
  const ys = circuit.elements.map((el) => el.y);
  return snapPt({ x: Math.max(...xs) + 120, y: Math.min(...ys) });
}

/**
 * The breadboard view: the same parts as the schematic, mounted in the holes, with jumpers between them. What
 * differs from the schematic is shown: dashed lines for what is missing, red for what is joined and should not be.
 */
export const BreadboardCanvas: React.FC<Props> = ({ circuit, onChange, selectedIds, onSelectIds, activeDefToPlace, onPlacedDef, onRotateSelected, onDeleteSelected, layout, frameRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const view = usePanZoom(containerRef, BOARD_FIT);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The circuit as the drag leaves it so far, drawn in place of the real one until the pointer lifts. */
  const [draft, setDraft] = useState<Circuit | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const downAt = useRef<Pt | null>(null);
  const shown = draft ?? circuit;

  const comparison = useMemo(() => compareWithSchematic(shown), [shown]);
  const mounted = useMemo(() => shown.elements.filter(isMounted), [shown]);
  const tray = useMemo(() => circuit.elements.filter((el) => !el.bb && footprintOf(el) !== null), [circuit]);
  const pinsOf = useMemo(() => new Map(mounted.map((el) => [el.id, pinPoints(el)])), [mounted]);

  // The lights: LEDs and lamps, from the same frames as the animation
  const glowRefs = useRef<(SVGCircleElement | null)[]>([]);
  const glows = useMemo(() => {
    if (!layout) return [];
    const index = new Map(layout.devices.map((d, k) => [d.elementId, k]));
    return mounted.flatMap((el) => {
      const footprint = footprintOf(el)!;
      const spot = glowSpot(el, footprint, pinsOf.get(el.id)!);
      const device = index.get(el.id);
      if (!spot || device === undefined) return [];
      const spice = getDevice(el.def)?.spice;
      const rated = spice?.kind === 'lamp' ? (lampRating(el, spice)?.power ?? null) : null;
      return [{ ...spot, device, rated }];
    });
  }, [mounted, pinsOf, layout]);
  // The displays of the bench supplies: what they give now, and whether the animation is running
  const supplies = useMemo(() => {
    if (!layout) return [];
    const index = new Map(layout.devices.map((d, k) => [d.elementId, k]));
    return mounted.flatMap((el) => {
      const device = index.get(el.id);
      return footprintOf(el)?.art === 'benchsupply' && device !== undefined ? [{ id: el.id, device }] : [];
    });
  }, [mounted, layout]);
  const lastTime = useRef(NaN);
  useEffect(() => {
    const refresh = () => {
      const frame = frameRef.current;
      // A part just added is in the layout before any frame knows it: that frame is of another circuit
      if (!frame || frame.deviceVoltage.length !== layout?.devices.length) return;
      const root = containerRef.current;
      const isRunning = frame.time !== lastTime.current;
      lastTime.current = frame.time;
      supplies.forEach(({ id, device }) => {
        const [volts, amps, lamp] = ['volts', 'amps', 'lamp'].map((what) => root?.querySelector(`[data-supply-${what}="${id}"]`));
        if (volts) volts.textContent = supplyVolts(frame.deviceVoltage[device]);
        // Positive when it gives current to the circuit, as the display of a real one
        if (amps) amps.textContent = supplyAmps(-frame.deviceCurrent[device] + 0);
        lamp?.setAttribute('fill', isRunning ? SUPPLY_LAMP.on : SUPPLY_LAMP.off);
      });
      glows.forEach(({ device, rated }, k) => {
        const mean = frame.glowMean[device];
        // A lamp by its filament, as on the schematic
        const level = rated !== null ? lampBrightness(frame.lampLight[device] ?? 0) : ledBrightness(Number.isNaN(mean) ? frame.deviceCurrent[device] : mean);
        glowRefs.current[k]?.setAttribute('opacity', String(0.85 * level));
      });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [glows, supplies, frameRef, layout]);

  // R turns, Delete takes out of the breadboard, as in the schematic
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'r' || e.key === 'R') onRotateSelected();
      if (e.key === 'Delete' || e.key === 'Backspace') onDeleteSelected();
      if (e.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRotateSelected, onDeleteSelected]);

  const handleDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (view.trackDown(e)) {
      setDrag(null);
      setDraft(null);
      return;
    }
    const world = view.toWorld(e.clientX, e.clientY);
    const at = snapToPitch(world);
    downAt.current = { x: e.clientX, y: e.clientY };
    const target = (e.target as SVGElement).closest<SVGElement>('[data-leg],[data-jumper-end],[data-part],[data-jumper]');

    // A part from the tray, or a new one from the library, goes where the press is
    if (picked || activeDefToPlace) {
      if (picked) {
        onChange(
          updateElements(circuit, new Set([picked]), (el) => ({
            ...el,
            bb: placeAt(el, at),
          })),
        );
        onSelectIds(new Set([picked]));
        setPicked(null);
      } else if (activeDefToPlace) {
        const id = `elem_${Date.now()}`;
        const el = createElement(activeDefToPlace, freeSpot(circuit), 0, circuit, id);
        const placed = footprintOf(el) ? { ...el, bb: placeAt(el, at) } : el;
        onChange({ ...circuit, elements: [...circuit.elements, placed] });
        onSelectIds(new Set([id]));
        onPlacedDef();
      }
      return;
    }

    const data = target?.dataset ?? {};
    // The socket of an instrument: a jumper starts from the pin under it
    const socketPins = (e.target as SVGElement).closest('[data-socket]') && data.part ? pinsOf.get(data.part) : undefined;
    if ((e.target as SVGElement).closest('[data-press]') && data.part) {
      // The cap of a push button: held while the finger is down, and never in Annulla
      onSelectIds(new Set([data.part]));
      onChange(holdOnBoard(circuit, data.part, true), false);
      setDrag({ kind: 'press', id: data.part });
    } else if (socketPins?.length) {
      const nearest = socketPins.reduce((best, p) => (Math.hypot(p.at.x - world.x, p.at.y - world.y) < Math.hypot(best.at.x - world.x, best.at.y - world.y) ? p : best));
      setDrag({ kind: 'newJumper', from: nearest.at });
    } else if (data.leg) {
      const [id, leg] = data.leg.split('|');
      setDrag({ kind: 'leg', id, leg: Number(leg) as 0 | 1 });
    } else if (data.jumperEnd) {
      const [id, end] = data.jumperEnd.split('|');
      onSelectIds(new Set([id]));
      setDrag({ kind: 'jumperEnd', id, end: end as 'a' | 'b' });
    } else if (data.part) {
      if (!selectedIds.has(data.part)) onSelectIds(new Set([data.part]));
      setDrag({ kind: 'part', id: data.part, start: at, moved: false });
    } else if (data.jumper) {
      onSelectIds(new Set([data.jumper]));
    } else if (Math.hypot(world.x - at.x, world.y - at.y) <= HOLE_REACH && (holeAt(at) || [...pinsOf.values()].flat().some((p) => p.at.x === at.x && p.at.y === at.y))) {
      setDrag({ kind: 'newJumper', from: at });
    } else {
      onSelectIds(new Set());
      view.startPan(e);
      setDrag({ kind: 'pan' });
    }
  };

  const handleMove = (e: React.PointerEvent) => {
    const world = view.toWorld(e.clientX, e.clientY);
    const at = snapToPitch(world);
    setPointer(at);
    if (view.trackMove(e) || !drag) return;
    if (drag.kind === 'part') {
      const by = { x: at.x - drag.start.x, y: at.y - drag.start.y };
      const ids = selectedIds.has(drag.id) ? selectedIds : new Set([drag.id]);
      setDraft(updateElements(circuit, ids, (el) => (el.bb ? { ...el, bb: movedPlace(el.bb, by) } : el)));
      if (by.x !== 0 || by.y !== 0) setDrag({ ...drag, moved: true });
    } else if (drag.kind === 'leg') {
      setDraft(
        updateElements(circuit, new Set([drag.id]), (el) => {
          if (!el.bb?.legs) return el;
          const legs: [Pt, Pt] = [...el.bb.legs] as [Pt, Pt];
          legs[drag.leg] = at;
          return { ...el, bb: { ...el.bb, legs } };
        }),
      );
    } else if (drag.kind === 'jumperEnd') {
      setDraft(changeJumper(circuit, drag.id, { [drag.end]: at }));
    }
  };

  const handleUp = (e: React.PointerEvent) => {
    view.trackUp(e);
    if (drag?.kind === 'press') {
      onChange(holdOnBoard(circuit, drag.id, false), false);
    } else if (drag?.kind === 'newJumper' && pointer && (pointer.x !== drag.from.x || pointer.y !== drag.from.y)) {
      const id = `jumper_${Date.now()}`;
      onChange(addJumper(circuit, drag.from, pointer, id));
      onSelectIds(new Set([id]));
    } else if (drag?.kind === 'part' && !drag.moved && pressOnBoard(circuit, drag.id)) {
      // A press without a drag on a switch moves its lever, here and in the schematic
      onChange(pressOnBoard(circuit, drag.id)!);
    } else if (draft && drag && drag.kind !== 'pan' && drag.kind !== 'newJumper') {
      onChange(draft);
    }
    setDrag(null);
    setDraft(null);
  };

  // Once everything is joined the line says so, then leaves the breadboard clear; it comes back with anything amiss
  const [isOkGone, setIsOkGone] = useState(false);
  useEffect(() => {
    setIsOkGone(false);
    if (!comparison.isComplete) return;
    const timer = setTimeout(() => setIsOkGone(true), OK_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [comparison.isComplete]);

  const jumpers = jumpersOf(shown);
  const selectedLeads = mounted.filter((el) => selectedIds.has(el.id) && el.bb?.legs);
  const pickedEl = picked ? circuit.elements.find((el) => el.id === picked) : null;

  return (
    <div className="breadboard-area">
      {tray.length > 0 && (
        <aside className="breadboard-tray" aria-label="Componenti da montare">
          <h3>Da montare</h3>
          {tray.map((el) => (
            <button key={el.id} className={picked === el.id ? 'active' : ''} aria-pressed={picked === el.id} onClick={() => setPicked(picked === el.id ? null : el.id)}>
              <strong>{el.tag || getDevice(el.def)?.name}</strong> {getDevice(el.def)?.name}
            </button>
          ))}
          <p className="hint">{pickedEl ? `Tocca un foro per montare ${pickedEl.tag}` : 'Tocca un componente, poi un foro della breadboard'}</p>
        </aside>
      )}
      <div className="breadboard-stage">
        {!(comparison.isComplete && isOkGone) && (
        <div className={`breadboard-summary${comparison.isComplete ? ' ok' : ''}`}>
          <button className="link" onClick={() => setShowDetails((s) => !s)} aria-expanded={showDetails}>
            {comparisonSummary(comparison)}
          </button>
          {showDetails && !comparison.isComplete && (
            <ul>
              {comparison.missing.map((m, k) => (
                <li key={`m${k}`}>
                  Manca: {m.names[0]} con {m.names[1]}
                </li>
              ))}
              {comparison.shorts.map((s, k) => (
                <li key={`s${k}`} className="short">
                  In più: {s.names.join(', ')} sono uniti, nello schema no
                </li>
              ))}
              {comparison.unmounted.length > 0 && <li>Da montare: {comparison.unmounted.map((id) => circuit.elements.find((el) => el.id === id)?.tag).join(', ')}</li>}
            </ul>
          )}
        </div>
        )}
        <div
          ref={containerRef}
          className="breadboard-canvas"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          onPointerLeave={() => setPointer(null)}
          onWheel={view.onWheel}
          style={{
            cursor: picked || activeDefToPlace ? 'crosshair' : drag?.kind === 'pan' ? 'grabbing' : 'default',
          }}
        >
          <svg width="100%" height="100%" aria-label="Breadboard">
            <g transform={`translate(${view.pan.x}, ${view.pan.y}) scale(${view.zoom})`}>
              <BenchSupplyDefs />
              <Board />
              {mounted.map((el) => (
                <PartArt key={el.id} el={el} footprint={footprintOf(el)!} pins={pinsOf.get(el.id)!} isSelected={selectedIds.has(el.id)} />
              ))}
              {/* The pins, where they go into the holes */}
              {[...pinsOf.entries()].flatMap(([id, pins]) =>
                pins.map((p, k) => (
                  <circle key={`${id}${k}`} cx={p.at.x} cy={p.at.y} r={1.3} fill={holeAt(p.at) ? '#d6d3d1' : '#f97316'} pointerEvents="none">
                    <title>{`${circuit.elements.find((el) => el.id === id)?.tag}.${p.label}`}</title>
                  </circle>
                )),
              )}
              {jumpers.map((w) => (
                <g key={w.id}>
                  <line
                    data-jumper={w.id}
                    x1={w.a.x}
                    y1={w.a.y}
                    x2={w.b.x}
                    y2={w.b.y}
                    stroke={w.color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    style={selectedIds.has(w.id) ? { filter: 'drop-shadow(0 0 2px var(--accent))' } : undefined}
                  />
                  {(['a', 'b'] as const).map((end) => (
                    <circle key={end} data-jumper-end={`${w.id}|${end}`} cx={w[end].x} cy={w[end].y} r={selectedIds.has(w.id) ? 2.6 : 1.6} fill={w.color} stroke="#475569" strokeWidth={0.4} />
                  ))}
                </g>
              ))}
              {selectedLeads.flatMap((el) => el.bb!.legs!.map((p, k) => <circle key={`${el.id}leg${k}`} data-leg={`${el.id}|${k}`} cx={p.x} cy={p.y} r={2.8} fill="var(--accent)" opacity={0.7} />))}
              {comparison.missing.map((m, k) => (
                <line key={`miss${k}`} x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y} stroke="#f59e0b" strokeWidth={0.9} strokeDasharray="2 1.6" pointerEvents="none" />
              ))}
              {comparison.shorts.flatMap((s, k) => s.at.map((p, j) => <circle key={`short${k}-${j}`} cx={p.x} cy={p.y} r={3.2} fill="none" stroke="#ef4444" strokeWidth={0.9} pointerEvents="none" />))}
              {glows.map((g, k) => (
                <circle
                  key={`glow${k}`}
                  ref={(node) => (glowRefs.current[k] = node)}
                  cx={g.at.x}
                  cy={g.at.y}
                  r={g.r}
                  fill={g.color}
                  opacity={0}
                  pointerEvents="none"
                  style={{ filter: `drop-shadow(0 0 4px ${g.color})` }}
                />
              ))}
              {drag?.kind === 'newJumper' && pointer && <line x1={drag.from.x} y1={drag.from.y} x2={pointer.x} y2={pointer.y} stroke="#64748b" strokeWidth={2} strokeLinecap="round" opacity={0.7} pointerEvents="none" />}
              {pointer && (picked || activeDefToPlace || drag?.kind === 'newJumper' || drag?.kind === 'leg' || drag?.kind === 'jumperEnd') && (
                <circle cx={pointer.x} cy={pointer.y} r={3} fill="none" stroke="var(--accent)" strokeWidth={0.8} pointerEvents="none" />
              )}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
};

/** The board itself: the plastic, the rails with their red and blue lines, the holes, the letters and numbers. */
const Board: React.FC = React.memo(() => (
  <g pointerEvents="none">
    <rect x={BOARD_BOX.x} y={BOARD_BOX.y} width={BOARD_BOX.w} height={BOARD_BOX.h} rx={3} fill="#f5f5f4" stroke="#d6d3d1" strokeWidth={0.6} />
    <rect x={BOARD_BOX.x} y={GROOVE_Y - 2} width={BOARD_BOX.w} height={4} fill="#e7e5e4" />
    {(
      [
        [RAILS.topMinus - 5, '#2563eb'],
        [RAILS.topPlus + 5, '#dc2626'],
        [RAILS.bottomPlus - 5, '#dc2626'],
        [RAILS.bottomMinus + 5, '#2563eb'],
      ] as const
    ).map(([y, color], k) => (
      <line key={k} x1={BOARD_BOX.x + 6} y1={y} x2={BOARD_BOX.x + BOARD_BOX.w - 6} y2={y} stroke={color} strokeWidth={0.6} />
    ))}
    {HOLES.map((h) => (
      <rect key={h.label + h.at.x + ',' + h.at.y} x={h.at.x - 1.1} y={h.at.y - 1.1} width={2.2} height={2.2} rx={0.4} fill="#44403c" />
    ))}
    {ROW_LABELS.map(({ row, y }) => (
      <text key={row} x={-PITCH - 2} y={y + 1.2} fontSize={3.4} fill="#78716c" textAnchor="middle">
        {row}
      </text>
    ))}
    {Array.from({ length: COLUMNS }, (_, k) => k)
      .filter((k) => k === 0 || (k + 1) % 5 === 0)
      .map((k) => (
        <text key={k} x={k * PITCH} y={-PITCH + 2.5} fontSize={3.2} fill="#78716c" textAnchor="middle">
          {k + 1}
        </text>
      ))}
  </g>
));
