// Adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import React from 'react';
import { Circuit, ComponentDef, Element, Prim, Pt, Rotation, Wire } from '../model/types';
import { canRotate, elementSymbol, getDevice } from '../library/devices';
import { sourceLabel } from '../netlist/source';
import { METER_MODES } from '../realtime/meterModes';
import { parseSpiceValue } from '../netlist/values';
import { formatEngineering } from '../ui/chartMath';
import { Box, dist, isPointOnSegment, localToWorld } from '../utils/geometry';

type Press = React.PointerEvent;

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  selectionBox: Box | null;
  /** The area around a selection of several things. */
  groupBounds: Box | null;
  onElementDown: (elem: Element, e: Press) => void;
  /** A mark around the dial of a multimeter was pressed. */
  onMeterMode: (elem: Element, mode: string) => void;
  onWireDown: (wire: Wire, e: Press) => void;
  onWireHandleDown: (wire: Wire, pointIndex: number, e: Press) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
  wireDraft: Pt[];
  ghost: { def: ComponentDef; x: number; y: number; rot: Rotation } | null;
  hoveredTerminal: { x: number; y: number; label?: string } | null;
  /** Drawn above the wires and below the components. */
  overlay?: React.ReactNode;
  /** Drawn above the components. */
  labels?: React.ReactNode;
}

const toPath = (pts: Pt[]) => pts.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');

export const Renderer: React.FC<Props> = ({
  circuit,
  selectedIds,
  selectionBox,
  groupBounds,
  onElementDown,
  onMeterMode,
  onWireDown,
  onWireHandleDown,
  onTerminalDown,
  onTerminalUp,
  wireDraft,
  ghost,
  hoveredTerminal,
  overlay,
  labels,
}) => (
  <g className="schematic-root">
    <defs>
      <pattern id="grid" width={10} height={10} patternUnits="userSpaceOnUse">
        <circle cx={0} cy={0} r={0.7} fill="var(--sch-grid)" />
      </pattern>
    </defs>
    <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid)" pointerEvents="none" />

    <g className="wires-layer">
      {circuit.wires.map((wire) => {
        const isSelected = selectedIds.has(wire.id);
        const d = toPath(wire.pts);
        return (
          <g key={wire.id}>
            {isSelected && <path d={d} fill="none" stroke="var(--sch-select-glow)" strokeWidth={6} strokeOpacity={0.35} strokeLinecap="round" />}
            <path d={d} fill="none" stroke={isSelected ? 'var(--sch-select)' : 'var(--sch-wire)'} strokeWidth={isSelected ? 3 : 1.8} strokeLinecap="round" />
            {/* Invisible wide hit-box for effortless wire selection and dragging */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              pointerEvents="stroke"
              style={{ cursor: isSelected ? 'move' : 'pointer' }}
              onPointerDown={(e) => onWireDown(wire, e)}
            />
            {isSelected &&
              !groupBounds &&
              wire.pts.map((p, idx) => (
                <circle
                  key={idx}
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill="var(--sch-part)"
                  stroke="var(--sch-select)"
                  strokeWidth={2}
                  style={{ cursor: 'crosshair' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onWireHandleDown(wire, idx, e);
                  }}
                />
              ))}
          </g>
        );
      })}
      {wireDraft.length > 0 && <path d={toPath(wireDraft)} fill="none" stroke="var(--sch-select)" strokeWidth={2} strokeDasharray="4 4" />}
    </g>

    {overlay}

    <WireJunctions wires={circuit.wires} />

    <g className="elements-layer">
      {circuit.elements.map((elem) => (
        <ElementItem
          key={elem.id}
          elem={elem}
          isSelected={selectedIds.has(elem.id)}
          onDown={(e) => onElementDown(elem, e)}
          onMeterMode={(mode) => onMeterMode(elem, mode)}
          onTerminalDown={onTerminalDown}
          onTerminalUp={onTerminalUp}
        />
      ))}
      {ghost && (
        <g transform={`translate(${ghost.x}, ${ghost.y}) rotate(${canRotate(ghost.def) ? ghost.rot : 0})`} opacity={0.6} pointerEvents="none">
          {ghost.def.symbol.map((prim, idx) => (
            <PrimitiveItem key={idx} prim={prim} />
          ))}
        </g>
      )}
    </g>

    {labels}

    {hoveredTerminal && (
      <g transform={`translate(${hoveredTerminal.x}, ${hoveredTerminal.y})`} pointerEvents="none">
        <circle r={7} fill="rgba(37, 99, 235, 0.14)" stroke="var(--sch-select)" strokeWidth={1.8} />
        {hoveredTerminal.label && (
          <text y={-11} fontSize={9} fontWeight={700} fill="var(--sch-ink)" textAnchor="middle">
            {hoveredTerminal.label}
          </text>
        )}
      </g>
    )}

    {groupBounds && (
      <rect
        data-testid="selection-area"
        x={groupBounds.x1}
        y={groupBounds.y1}
        width={groupBounds.x2 - groupBounds.x1}
        height={groupBounds.y2 - groupBounds.y1}
        fill="rgba(37, 99, 235, 0.1)"
        stroke="var(--sch-select)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        rx={6}
        pointerEvents="none"
      />
    )}

    {/* A marker under the finger, until the area has a size of its own */}
    {selectionBox && selectionBox.x1 === selectionBox.x2 && selectionBox.y1 === selectionBox.y2 && (
      <circle cx={selectionBox.x1} cy={selectionBox.y1} r={14} fill="rgba(37, 99, 235, 0.2)" stroke="var(--sch-select)" strokeWidth={1.5} pointerEvents="none" />
    )}

    {selectionBox && (
      <rect
        x={Math.min(selectionBox.x1, selectionBox.x2)}
        y={Math.min(selectionBox.y1, selectionBox.y2)}
        width={Math.abs(selectionBox.x2 - selectionBox.x1)}
        height={Math.abs(selectionBox.y2 - selectionBox.y1)}
        fill="rgba(37, 99, 235, 0.12)"
        stroke="var(--sch-select)"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
    )}
  </g>
);

export function getBounds(def: ComponentDef) {
  const xs = def.terminals.map((t) => t.x);
  const ys = def.terminals.map((t) => t.y);
  const minX = Math.min(-20, ...xs);
  const maxX = Math.max(20, ...xs);
  const minY = Math.min(-20, ...ys);
  const maxY = Math.max(20, ...ys);
  if (def.spice.kind === 'opamp') return { x: minX, y: -30, w: maxX - minX, h: 60 };
  if (def.id === 'multimeter') return { x: -50, y: -80, w: 100, h: 146 };
  return def.spice.kind === 'ground'
    ? { x: -14, y: -2, w: 28, h: 26 }
    : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const currentLabel = (value: unknown) => {
  const current = parseSpiceValue(String(value ?? ''));
  return current === null ? '?' : formatEngineering(current, 'A');
};

const ElementItem: React.FC<{
  elem: Element;
  isSelected: boolean;
  onDown: (e: Press) => void;
  onMeterMode: (mode: string) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
}> = ({ elem, isSelected, onDown, onMeterMode, onTerminalDown, onTerminalUp }) => {
  const def = getDevice(elem.def);
  if (!def) return null;
  const bounds = getBounds(def);
  // A transistor has leads above and below too: its labels always go beside it
  const isTransistor = def.spice.kind === 'bjt' || def.spice.kind === 'mos';
  const isBesideLabel = elem.rot === 90 || elem.rot === 270 || isTransistor;
  const isBlock = def.spice.kind === 'block';
  const isRegulator = def.spice.kind === 'regulator';
  // The box is as tall as its pins: its labels go beyond it
  const blockReach = Math.max(...def.terminals.map((t) => Math.abs(t.y))) + 16;
  const blockPinNames = isBlock ? String(elem.props.pinNames ?? '').split(' ') : [];
  const value = def.spice.kind === 'vsource' ? sourceLabel(elem.props) : def.spice.kind === 'isource' ? currentLabel(elem.props.value) : def.spice.kind === 'opamp' || def.spice.kind === 'meter' || isRegulator ? '' : def.spice.kind === 'transformer' ? `${elem.props.ratio}:1` : def.props[0] ? String(elem.props[def.props[0].key] ?? '') : '';
  const labelProps = isRegulator && elem.rot === 180
    ? { x: 8, textAnchor: 'start' as const } // Clear of the lead that now goes up
    : def.spice.kind === 'opamp' && !isBesideLabel
    ? { x: 8, textAnchor: 'start' as const } // Clear of the sloping side of the triangle
    : !isBesideLabel
    ? { x: 0, textAnchor: 'middle' as const }
    : isTransistor && elem.rot === 180
      ? { x: -28, textAnchor: 'end' as const }
      : { x: isTransistor ? 28 : def.spice.kind === 'meter' ? 32 : isBlock ? blockReach + 6 : isRegulator ? 26 : 24, textAnchor: 'start' as const };

  return (
    <g
      transform={`translate(${elem.x}, ${elem.y}) rotate(${elem.rot})${elem.flip ? ' scale(1, -1)' : ''}`}
      onPointerDown={onDown}
      style={{ cursor: 'move' }}
      data-tag={elem.tag}
    >
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="transparent" pointerEvents="all" />
      {isSelected && (
        <rect
          x={bounds.x - 2}
          y={bounds.y - 2}
          width={bounds.w + 4}
          height={bounds.h + 4}
          fill="rgba(59, 130, 246, 0.08)"
          stroke="var(--sch-select-glow)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          rx={4}
          pointerEvents="none"
        />
      )}
      {elementSymbol(def, elem).map((prim, idx) => (
        <PrimitiveItem key={idx} prim={prim} />
      ))}

      {/* The marks around the dial: a press chooses, and does not start moving the instrument */}
      {def.id === 'multimeter' &&
        METER_MODES.map(({ value, label, symbol, dial }) => (
          <g key={value} role="button" aria-label={label} style={{ cursor: 'pointer' }} onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) onMeterMode(value);
          }}>
            <rect x={dial.x - 15} y={dial.y - 10} width={30} height={20} fill="transparent" pointerEvents="all" />
            <text x={dial.x} y={dial.y + 4} textAnchor="middle" fontSize={11} fontWeight={elem.props.mode === value ? 700 : 400} fill={elem.props.mode === value ? 'var(--sch-ink)' : 'var(--sch-muted)'} pointerEvents="none">
              {symbol}
            </text>
          </g>
        ))}

      {/* Its name and pins on the box, upright whatever the rotation */}
      {isRegulator && (
        <g transform={`rotate(${-elem.rot})`} pointerEvents="none" textAnchor="middle" fill="var(--sch-ink)">
          {/* Standing, the box is narrow: the name makes room for the pin on its side */}
          <text x={elem.rot === 90 ? 4 : elem.rot === 270 ? -4 : 0} y={4} fontSize={isBesideLabel ? 10 : 11} fontWeight={700}>
            {def.name}
          </text>
        </g>
      )}
      {isRegulator &&
        def.terminals.map((t) => {
          const [x, y] = t.id === 'in' ? [-21, -11] : t.id === 'out' ? [20, -11] : [0, 13];
          return (
            <text key={t.id} transform={`translate(${x} ${y})${t.id === 'ref' && isBesideLabel ? '' : ` rotate(${-elem.rot})`}`} y={3} textAnchor="middle" fontSize={8} fill="var(--sch-muted)" pointerEvents="none">
              {t.id === 'ref' ? (def.name.startsWith('LM') ? 'ADJ' : 'GND') : t.id.toUpperCase()}
            </text>
          );
        })}

      {/* The name of each pin, next to it inside the box: upright, whatever the rotation */}
      {isBlock &&
        def.terminals.map((t, k) => {
          const isOnStart = (t.x < 0) === (elem.rot === 0);
          const anchor = elem.rot === 90 || elem.rot === 270 ? 'middle' : isOnStart ? 'start' : 'end';
          return (
            <text key={t.id} transform={`translate(${Math.sign(t.x) * 31} ${t.y}) rotate(${-elem.rot})`} y={3} textAnchor={anchor} fontSize={9} fill="var(--sch-muted)" pointerEvents="none">
              {blockPinNames[k]?.slice(0, 7)}
            </text>
          );
        })}

      {/* Labels are counter-rotated so they stay upright and keep their world position */}
      {def.tagPrefix && (
        <g transform={`${elem.flip ? 'scale(1, -1) ' : ''}rotate(${-elem.rot})`} pointerEvents="none" fontSize={11}>
          <text y={isBesideLabel ? -4 : def.id === 'multimeter' ? -85 : def.spice.kind === 'meter' ? -33 : isBlock ? -blockReach - 4 : isRegulator ? -25 : -24} fontWeight={700} fill="var(--sch-ink)" {...labelProps}>
            {elem.tag}
          </text>
          <text y={isBesideLabel ? 10 : isBlock ? blockReach + 13 : 34} fill="var(--sch-muted)" {...labelProps}>
            {value}
          </text>
        </g>
      )}

      {def.terminals.map((term) => {
        const worldPos = localToWorld(elem.x, elem.y, term, elem.rot, elem.flip);
        return (
          <g
            key={term.id}
            transform={`translate(${term.x}, ${term.y})`}
            style={{ cursor: 'crosshair' }}
            data-terminal={`${elem.tag}.${term.id}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onTerminalDown(worldPos, e);
            }}
            onPointerUp={(e) => onTerminalUp(worldPos, e)}
          >
            <circle r={10} fill="transparent" pointerEvents="all" />
            <circle r={3} fill="var(--sch-part)" stroke="var(--sch-ink)" strokeWidth={1.2} />
          </g>
        );
      })}
    </g>
  );
};

export const PrimitiveItem: React.FC<{ prim: Prim }> = ({ prim }) => {
  const stroke = prim.stroke || 'var(--sch-ink)';
  switch (prim.t) {
    case 'line':
      return (
        <line x1={prim.x1} y1={prim.y1} x2={prim.x2} y2={prim.y2} stroke={stroke} strokeWidth={prim.w || 1.5} strokeLinecap="round" />
      );
    case 'rect':
      return <rect x={prim.x} y={prim.y} width={prim.w} height={prim.h} fill={prim.fill || 'none'} stroke={stroke} strokeWidth={1.5} />;
    case 'circle':
      return <circle cx={prim.cx} cy={prim.cy} r={prim.r} fill={prim.fill || 'none'} stroke={stroke} strokeWidth={1.5} />;
    case 'path':
      return <path d={prim.d} fill={prim.fill || 'none'} stroke={stroke} strokeWidth={1.5} />;
  }
};

/** Dots where 3+ wire branches meet, including T-junctions on a segment */
const WireJunctions: React.FC<{ wires: Wire[] }> = ({ wires }) => {
  const counts = new Map<string, { pt: Pt; count: number }>();
  for (const wire of wires) {
    wire.pts.forEach((p, i) => {
      const key = `${p.x},${p.y}`;
      const entry = counts.get(key) || { pt: p, count: 0 };
      entry.count += i === 0 || i === wire.pts.length - 1 ? 1 : 2;
      counts.set(key, entry);
    });
  }

  const junctions = new Map<string, Pt>();
  for (const [key, v] of counts) {
    if (v.count >= 3) junctions.set(key, v.pt);
  }
  for (const wA of wires) {
    for (const ep of [wA.pts[0], wA.pts[wA.pts.length - 1]]) {
      for (const wB of wires) {
        if (wA === wB) continue;
        for (let k = 0; k + 1 < wB.pts.length; k++) {
          const [p1, p2] = [wB.pts[k], wB.pts[k + 1]];
          if (dist(ep, p1) > 1 && dist(ep, p2) > 1 && isPointOnSegment(ep, p1, p2, 2)) {
            junctions.set(`${ep.x},${ep.y}`, ep);
          }
        }
      }
    }
  }

  return (
    <g pointerEvents="none">
      {[...junctions.entries()].map(([key, pt]) => (
        <circle key={key} cx={pt.x} cy={pt.y} r={3.5} fill="var(--sch-ink)" />
      ))}
    </g>
  );
};
