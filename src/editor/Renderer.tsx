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
  /** A control drawn on a part was pressed: a mark around the dial of a multimeter, the lever of a logic input. */
  onSetProp: (elem: Element, key: string, value: string, record?: boolean) => void;
  onWireDown: (wire: Wire, e: Press) => void;
  onWireHandleDown: (wire: Wire, pointIndex: number, e: Press) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
  wireDraft: Pt[];
  ghost: { def: ComponentDef; x: number; y: number; rot: Rotation } | null;
  /** isPending marks the first terminal of a wire chosen with a finger, waiting for the second one. */
  hoveredTerminal: { x: number; y: number; label?: string; isPending?: boolean } | null;
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
  onSetProp,
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
          onSetProp={(key, value, record) => onSetProp(elem, key, value, record)}
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
      <g transform={`translate(${hoveredTerminal.x}, ${hoveredTerminal.y})`} pointerEvents="none" data-testid={hoveredTerminal.isPending ? 'pending-terminal' : undefined}>
        {hoveredTerminal.isPending && <circle r={12} className="pending-ring" fill="none" stroke="var(--sch-select)" strokeWidth={2} />}
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
  /** record false: a change that must not go into Annulla, such as holding a push button. */
  onSetProp: (key: string, value: string, record?: boolean) => void;
  onTerminalDown: (worldPos: Pt, e: Press) => void;
  onTerminalUp: (worldPos: Pt, e: Press) => void;
}> = ({ elem, isSelected, onDown, onSetProp, onTerminalDown, onTerminalUp }) => {
  const def = getDevice(elem.def);
  if (!def) return null;
  const bounds = getBounds(def);
  // A transistor has leads above and below too: its labels always go beside it
  const isTransistor = def.spice.kind === 'bjt' || def.spice.kind === 'mos';
  const isBesideLabel = elem.rot === 90 || elem.rot === 270 || isTransistor;
  const isBlock = def.spice.kind === 'block';
  // A box with named pins: a subcircuit, a truth table, a decoder, a display
  const isNamedBox = isBlock || def.spice.kind === 'display7' || def.spice.kind === 'mcu' || (def.spice.kind === 'logic' && (def.spice.gate === 'table' || def.spice.gate === 'dff' || def.spice.gate === 'counter' || def.spice.gate === 'tff' || def.spice.gate === 'jkff' || def.spice.gate === 'srff' || def.spice.gate === 'srlatch' || def.spice.gate === 'network'));
  const isRegulator = def.spice.kind === 'regulator';
  const isSensor = def.spice.kind === 'regulator' && !!def.spice.sensor;
  // The box is as tall as its pins: its labels go beyond it
  const blockReach = Math.max(...def.terminals.map((t) => Math.abs(t.y))) + 16;
  const blockPinNames = isBlock ? String(elem.props.pinNames ?? '').split(' ') : isNamedBox ? def.terminals.map((t) => t.id) : [];
  // The pin names sit inside the box, next to the edge: the parts drawn here have it at 24 from the center, a subcircuit at 34
  const pinNameX = isBlock || def.spice.kind === 'mcu' ? 31 : 21;
  const firstProp = def.props[0];
  // A choice shows its name, as the LED its colour; a logic part shows its level on itself already
  const firstValue = !firstProp ? '' : firstProp.type === 'choice' ? (firstProp.options?.find((o) => o.value === String(elem.props[firstProp.key]))?.label ?? '') : String(elem.props[firstProp.key] ?? '');
  const value = def.spice.kind === 'vsource' ? sourceLabel(elem.props) : def.spice.kind === 'isource' ? currentLabel(elem.props.value) : def.spice.kind === 'logic' && def.spice.gate === 'network' ? def.name : def.spice.kind === 'opamp' || def.spice.kind === 'meter' || def.spice.kind === 'logic' || def.spice.kind === 'motor' || isRegulator ? '' : def.spice.kind === 'transformer' ? `${elem.props.ratio}:1` : def.spice.kind === 'ctransformer' ? `${elem.props.primary}/${elem.props.secondary}+${elem.props.secondary} V · ${elem.props.power} VA` : def.spice.kind === 'pot' ? `${firstValue} · ${elem.props.position}%` : firstValue;
  // Parts whose drawing fills the space the labels usually take: name and value go below them, or,
  // beside a bridge on its side, below its lead
  const labelsBelow: [number, number] | null =
    (def.spice.kind === 'ctransformer' || def.spice.kind === 'bridge') && !isBesideLabel ? [56, 69] : def.spice.kind === 'bridge' ? [18, 31] : null;
  const labelProps = isRegulator && elem.rot === 180
    ? { x: 8, textAnchor: 'start' as const } // Clear of the lead that now goes up
    : def.spice.kind === 'opamp' && !isBesideLabel
    ? { x: 8, textAnchor: 'start' as const } // Clear of the sloping side of the triangle
    : !isBesideLabel
    ? { x: 0, textAnchor: 'middle' as const }
    : isTransistor && elem.rot === 180
      ? { x: -28, textAnchor: 'end' as const }
      : { x: isTransistor ? 28 : def.spice.kind === 'meter' ? 32 : isNamedBox ? blockReach + 6 : isRegulator ? 26 : 24, textAnchor: 'start' as const };

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
            if (e.button === 0) onSetProp('mode', value);
          }}>
            <rect x={dial.x - 15} y={dial.y - 10} width={30} height={20} fill="transparent" pointerEvents="all" />
            <text x={dial.x} y={dial.y + 4} textAnchor="middle" fontSize={11} fontWeight={elem.props.mode === value ? 700 : 400} fill={elem.props.mode === value ? 'var(--sch-ink)' : 'var(--sch-muted)'} pointerEvents="none">
              {symbol}
            </text>
          </g>
        ))}

      {/* The level of a logic input, and the press that switches it: the rest of the box moves it */}
      {def.spice.kind === 'logic' && def.spice.gate === 'input' && (
        <g role="switch" aria-checked={elem.props.state === '1'} aria-label={`${elem.tag}: livello ${elem.props.state === '1' ? '1' : '0'}`} style={{ cursor: 'pointer' }} onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) onSetProp('state', elem.props.state === '1' ? '0' : '1');
        }}>
          <rect x={-22} y={-12} width={30} height={24} rx={4} className={elem.props.state === '1' ? 'logic-high' : 'logic-low'} />
          <text transform={`translate(-7 0) rotate(${-elem.rot})`} y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#ffffff" pointerEvents="none">
            {elem.props.state === '1' ? '1' : '0'}
          </text>
        </g>
      )}

      {/* The lever of a toggle or a changeover flips at a press; the rest of the part moves it */}
      {def.spice.kind === 'switch' && (def.spice.switchKind === 'toggle' || def.spice.switchKind === 'spdt') && (
        <rect
          role="switch"
          aria-checked={def.spice.switchKind === 'toggle' ? elem.props.closed === '1' : elem.props.position === '2'}
          aria-label={`${elem.tag}: ${def.spice.switchKind === 'toggle' ? (elem.props.closed === '1' ? 'chiuso' : 'aperto') : `verso ${elem.props.position === '2' ? '2' : '1'}`}`}
          x={-14}
          y={def.spice.switchKind === 'spdt' ? -24 : -20}
          width={30}
          height={def.spice.switchKind === 'spdt' ? 48 : 24}
          fill="transparent"
          pointerEvents="all"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            if (def.spice.kind !== 'switch') return;
            if (def.spice.switchKind === 'toggle') onSetProp('closed', elem.props.closed === '1' ? '0' : '1');
            else onSetProp('position', elem.props.position === '2' ? '1' : '2');
          }}
        />
      )}
      {/* A push button acts only while held: pressed on the way down, released on the way up */}
      {def.spice.kind === 'switch' && (def.spice.switchKind === 'pushno' || def.spice.switchKind === 'pushnc') && (
        <rect
          role="button"
          aria-pressed={elem.props.pressed === '1'}
          aria-label={`${elem.tag}: tieni premuto`}
          x={-20}
          y={-26}
          width={40}
          height={30}
          fill="transparent"
          pointerEvents="all"
          style={{ cursor: 'pointer', touchAction: 'none' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            onSetProp('pressed', '1', false);
            // Held even if the finger slides off the button; a pointer the browser no longer knows cannot be held
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // The release still comes from the window
            }
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            onSetProp('pressed', '0', false);
          }}
          onPointerCancel={() => onSetProp('pressed', '0', false)}
          onLostPointerCapture={() => elem.props.pressed === '1' && onSetProp('pressed', '0', false)}
        />
      )}

      {/* Its name and pins on the box, upright whatever the rotation */}
      {isRegulator && (
        <g transform={`rotate(${-elem.rot})`} pointerEvents="none" textAnchor="middle" fill="var(--sch-ink)">
          {/* Standing, the box is narrow: the name makes room for the pin on its side */}
          <text x={(elem.rot === 90 ? 4 : elem.rot === 270 ? -4 : 0) + (isSensor && elem.rot === 0 ? 5 : 0)} y={4} fontSize={isBesideLabel ? 10 : 11} fontWeight={700}>
            {isSensor ? def.name.replace('Sensore ', '') : def.name}
          </text>
        </g>
      )}
      {isRegulator &&
        def.terminals.map((t) => {
          const role = def.spice.kind === 'regulator' ? (t.id === def.spice.input ? 'in' : t.id === def.spice.output ? 'out' : 'ref') : t.id;
          const [x, y] = role === 'in' ? [-21, -11] : role === 'out' ? [20, -11] : [0, 13];
          return (
            <text key={t.id} transform={`translate(${x} ${y})${role === 'ref' && isBesideLabel ? '' : ` rotate(${-elem.rot})`}`} y={3} textAnchor="middle" fontSize={8} fill="var(--sch-muted)" pointerEvents="none">
              {isSensor ? (role === 'in' ? '+VS' : role.toUpperCase().replace('REF', 'GND')) : t.id === 'ref' ? (def.name.startsWith('LM') ? 'ADJ' : 'GND') : t.id.toUpperCase()}
            </text>
          );
        })}

      {/* The name of each pin, next to it inside the box: upright, whatever the rotation */}
      {isNamedBox &&
        def.terminals.map((t, k) => {
          const isOnStart = (t.x < 0) === (elem.rot === 0);
          const anchor = elem.rot === 90 || elem.rot === 270 ? 'middle' : isOnStart ? 'start' : 'end';
          return (
            <text key={t.id} transform={`translate(${Math.sign(t.x) * pinNameX} ${t.y}) rotate(${-elem.rot})`} y={3} textAnchor={anchor} fontSize={9} fill="var(--sch-muted)" pointerEvents="none">
              {blockPinNames[k] === 'nQ' && !isBlock ? 'Q̄' : blockPinNames[k]?.slice(0, 7)}
            </text>
          );
        })}

      {/* The flag of a pin of an inner schematic carries the name of the pin inside it */}
      {def.spice.kind === 'port' && (
        <text x={def.spice.direction === 'in' ? -21 : 19} y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--sch-ink)" pointerEvents="none">
          {elem.tag}
        </text>
      )}

      {/* Labels are counter-rotated so they stay upright and keep their world position */}
      {def.tagPrefix && (
        <g transform={`${elem.flip ? 'scale(1, -1) ' : ''}rotate(${-elem.rot})`} pointerEvents="none" fontSize={11}>
          <text y={labelsBelow ? labelsBelow[0] : isBesideLabel ? -4 : def.id === 'multimeter' ? -85 : def.spice.kind === 'meter' ? -33 : isNamedBox ? -blockReach - 4 : isRegulator ? -25 : -24} fontWeight={700} fill="var(--sch-ink)" {...labelProps}>
            {elem.tag}
          </text>
          <text y={labelsBelow ? labelsBelow[1] : isBesideLabel ? 10 : isNamedBox ? blockReach + 13 : 34} fill="var(--sch-muted)" {...labelProps}>
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
