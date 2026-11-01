// Adapted from PowerCad_NextGen (see THIRD_PARTY_NOTICES.md).
import React from 'react';
import { Circuit, ComponentDef, Element, Prim, Pt, Rotation, Wire } from '../model/types';
import { getDevice } from '../library/devices';
import { Box, dist, isPointOnSegment, localToWorld } from '../utils/geometry';

type Press = React.PointerEvent;

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  selectionBox: Box | null;
  onElementDown: (elem: Element, e: Press) => void;
  onWireDown: (wire: Wire, e: Press) => void;
  onWireHandleDown: (wire: Wire, pointIndex: number, e: Press) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
  wireDraft: Pt[];
  ghost: { def: ComponentDef; x: number; y: number; rot: Rotation } | null;
  hoveredTerminal: { x: number; y: number; label?: string } | null;
  /** Drawn above the wires and below the components. */
  overlay?: React.ReactNode;
}

const toPath = (pts: Pt[]) => pts.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');

export const Renderer: React.FC<Props> = ({
  circuit,
  selectedIds,
  selectionBox,
  onElementDown,
  onWireDown,
  onWireHandleDown,
  onTerminalDown,
  onTerminalUp,
  wireDraft,
  ghost,
  hoveredTerminal,
  overlay,
}) => (
  <g className="schematic-root">
    <defs>
      <pattern id="grid" width={10} height={10} patternUnits="userSpaceOnUse">
        <circle cx={0} cy={0} r={0.7} fill="#94a3b8" />
      </pattern>
    </defs>
    <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid)" pointerEvents="none" />

    <g className="wires-layer">
      {circuit.wires.map((wire) => {
        const isSelected = selectedIds.has(wire.id);
        const d = toPath(wire.pts);
        return (
          <g key={wire.id}>
            {isSelected && <path d={d} fill="none" stroke="#3b82f6" strokeWidth={6} strokeOpacity={0.35} strokeLinecap="round" />}
            <path d={d} fill="none" stroke={isSelected ? '#2563eb' : '#334155'} strokeWidth={isSelected ? 3 : 1.8} strokeLinecap="round" />
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
              wire.pts.map((p, idx) => (
                <circle
                  key={idx}
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill="#ffffff"
                  stroke="#2563eb"
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
      {wireDraft.length > 0 && <path d={toPath(wireDraft)} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="4 4" />}
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
          onTerminalDown={onTerminalDown}
          onTerminalUp={onTerminalUp}
        />
      ))}
      {ghost && (
        <g transform={`translate(${ghost.x}, ${ghost.y}) rotate(${ghost.rot})`} opacity={0.6} pointerEvents="none">
          {ghost.def.symbol.map((prim, idx) => (
            <PrimitiveItem key={idx} prim={prim} />
          ))}
        </g>
      )}
    </g>

    {hoveredTerminal && (
      <g transform={`translate(${hoveredTerminal.x}, ${hoveredTerminal.y})`} pointerEvents="none">
        <circle r={7} fill="rgba(37, 99, 235, 0.14)" stroke="#2563eb" strokeWidth={1.8} />
        {hoveredTerminal.label && (
          <text y={-11} fontSize={9} fontWeight={700} fill="#0f172a" textAnchor="middle">
            {hoveredTerminal.label}
          </text>
        )}
      </g>
    )}

    {selectionBox && (
      <rect
        x={Math.min(selectionBox.x1, selectionBox.x2)}
        y={Math.min(selectionBox.y1, selectionBox.y2)}
        width={Math.abs(selectionBox.x2 - selectionBox.x1)}
        height={Math.abs(selectionBox.y2 - selectionBox.y1)}
        fill="rgba(37, 99, 235, 0.12)"
        stroke="#2563eb"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
    )}
  </g>
);

function getBounds(def: ComponentDef) {
  const xs = def.terminals.map((t) => t.x);
  const minX = Math.min(-20, ...xs);
  const maxX = Math.max(20, ...xs);
  return def.spice.kind === 'ground'
    ? { x: -14, y: -2, w: 28, h: 26 }
    : { x: minX, y: -20, w: maxX - minX, h: 40 };
}

const ElementItem: React.FC<{
  elem: Element;
  isSelected: boolean;
  onDown: (e: Press) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
}> = ({ elem, isSelected, onDown, onTerminalDown, onTerminalUp }) => {
  const def = getDevice(elem.def);
  if (!def) return null;
  const bounds = getBounds(def);
  const isVertical = elem.rot === 90 || elem.rot === 270;
  const value = def.props[0] ? String(elem.props[def.props[0].key] ?? '') : '';
  const labelProps = isVertical
    ? { x: 24, textAnchor: 'start' as const }
    : { x: 0, textAnchor: 'middle' as const };

  return (
    <g
      transform={`translate(${elem.x}, ${elem.y}) rotate(${elem.rot})`}
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
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          rx={4}
          pointerEvents="none"
        />
      )}
      {def.symbol.map((prim, idx) => (
        <PrimitiveItem key={idx} prim={prim} />
      ))}

      {/* Labels are counter-rotated so they stay upright and keep their world position */}
      {def.tagPrefix && (
        <g transform={`rotate(${-elem.rot})`} pointerEvents="none" fontSize={11}>
          <text y={isVertical ? -4 : -24} fontWeight={700} fill="#0f172a" {...labelProps}>
            {elem.tag}
          </text>
          <text y={isVertical ? 10 : 34} fill="#475569" {...labelProps}>
            {value}
          </text>
        </g>
      )}

      {def.terminals.map((term) => {
        const worldPos = localToWorld(elem.x, elem.y, term, elem.rot);
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
            <circle r={3} fill="#ffffff" stroke="#0f172a" strokeWidth={1.2} />
          </g>
        );
      })}
    </g>
  );
};

const PrimitiveItem: React.FC<{ prim: Prim }> = ({ prim }) => {
  const stroke = prim.stroke || '#0f172a';
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
        <circle key={key} cx={pt.x} cy={pt.y} r={3.5} fill="#0f172a" />
      ))}
    </g>
  );
};
