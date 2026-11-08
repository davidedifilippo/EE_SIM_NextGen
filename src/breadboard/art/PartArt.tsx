import React from 'react';
import { getDevice } from '../../library/devices';
import { Element, Pt } from '../../model/types';
import { LED_COLORS } from '../../ui/LogicView';
import { resistorBands } from '../colorCode';
import { Footprint } from '../footprints';

/**
 * The parts as they look on the bench, seen from above, in the units of the breadboard (10 is one pitch).
 * A part with two leads draws its body halfway between their ends, along them; the others turn with their
 * footprint around the place of the part.
 */

const LEAD = '#a8a29e';
const INK = '#0f172a';
const LABEL = { fontSize: 3.2, fontFamily: 'system-ui, sans-serif', textAnchor: 'middle' as const, pointerEvents: 'none' as const };

interface Props {
  el: Element;
  footprint: Footprint;
  pins: { terminal: string; label: string; at: Pt }[];
  isSelected: boolean;
}

/** A body along the leads: its own drawing, lying along x, centred at the origin; the leads up to its ends. */
function OnLeads({ pins, half, children }: { pins: Pt[]; half: number; children: React.ReactNode }) {
  const [a, b] = pins;
  const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  // A body longer than the leads stands over them: the leads then go straight down, under it
  const reach = Math.min(half, length / 2);
  const ux = length > 0 ? (b.x - a.x) / length : 1;
  const uy = length > 0 ? (b.y - a.y) / length : 0;
  return (
    <>
      <line x1={a.x} y1={a.y} x2={mx - ux * reach} y2={my - uy * reach} stroke={LEAD} strokeWidth={1.2} strokeLinecap="round" />
      <line x1={b.x} y1={b.y} x2={mx + ux * reach} y2={my + uy * reach} stroke={LEAD} strokeWidth={1.2} strokeLinecap="round" />
      <g transform={`translate(${mx} ${my}) rotate(${length > 0 ? angle : 0})`}>{children}</g>
    </>
  );
}

function Resistor({ value }: { value: string }) {
  const bands = resistorBands(value);
  return (
    <>
      <rect x={-11} y={-3.6} width={22} height={7.2} rx={3.2} fill="#e7c9a0" stroke="#a16207" strokeWidth={0.4} />
      {bands?.colors.map((color, k) => <rect key={k} x={[-7.5, -4.5, -1.5, 5][k]} y={-3.5} width={1.8} height={7} fill={color} />)}
    </>
  );
}

function Diode({ isZener }: { isZener: boolean }) {
  return (
    <>
      <rect x={-7} y={-2.6} width={14} height={5.2} rx={1} fill={isZener ? '#f97316' : '#1f2937'} opacity={isZener ? 0.85 : 1} />
      {/* The band at the cathode */}
      <rect x={4} y={-2.6} width={1.8} height={5.2} fill={isZener ? INK : '#e5e7eb'} />
    </>
  );
}

function Led({ color }: { color: string }) {
  return (
    <>
      <circle r={5.5} fill={color} opacity={0.55} stroke={color} strokeWidth={0.8} />
      {/* The flat side of the rim marks the cathode */}
      <path d="M 4.5 -3.2 A 5.5 5.5 0 0 1 4.5 3.2 Z" fill={color} opacity={0.9} />
      <circle r={3.2} fill="#ffffff" opacity={0.25} />
    </>
  );
}

function Electrolytic() {
  return (
    <>
      <circle r={8} fill="#1e3a8a" stroke="#0f172a" strokeWidth={0.5} />
      {/* The stripe on the side of the − lead */}
      <path d="M 3 -7.4 A 8 8 0 0 1 3 7.4 L 5 6 A 7 7 0 0 0 5 -6 Z" fill="#cbd5e1" />
      <text {...LABEL} x={-1} y={1.2} fill="#e2e8f0">
        +
      </text>
    </>
  );
}

const Ceramic = () => <ellipse rx={6} ry={4} fill="#d97706" stroke="#92400e" strokeWidth={0.5} />;

const Inductor = () => (
  <>
    <rect x={-10} y={-4} width={20} height={8} rx={4} fill="#166534" />
    {[-6, -2, 2, 6].map((x) => (
      <line key={x} x1={x} y1={-4} x2={x} y2={4} stroke="#4ade80" strokeWidth={0.6} />
    ))}
  </>
);

/** A small transistor, flat face towards whoever looks, its pins below. */
function To92({ labels, model }: { labels: string[]; model: string }) {
  return (
    <>
      {labels.map((_, k) => (
        <line key={k} x1={k * 10} y1={0} x2={k * 10} y2={-3} stroke={LEAD} strokeWidth={1.2} />
      ))}
      <path d="M -3 -3 H 23 V -8 A 13 7 0 0 0 -3 -8 Z" fill="#111827" />
      <text {...LABEL} x={10} y={-7} fill="#e5e7eb" fontSize={3}>
        {model}
      </text>
    </>
  );
}

function To220({ labels, model }: { labels: string[]; model: string }) {
  return (
    <>
      {labels.map((_, k) => (
        <line key={k} x1={k * 10} y1={0} x2={k * 10} y2={-4} stroke={LEAD} strokeWidth={1.4} />
      ))}
      <rect x={-5} y={-24} width={30} height={20} rx={1} fill="#111827" />
      <rect x={-5} y={-34} width={30} height={11} rx={1} fill="#9ca3af" />
      <circle cx={10} cy={-28.5} r={3} fill="#4b5563" />
      <text {...LABEL} x={10} y={-12} fill="#e5e7eb" fontSize={3.4}>
        {model}
      </text>
    </>
  );
}

const Trimmer = () => (
  <>
    <rect x={-4} y={-14} width={28} height={18} rx={2} fill="#1d4ed8" />
    <circle cx={10} cy={-5} r={6} fill="#f8fafc" />
    <path d="M 6 -5 H 14 M 10 -9 V -1" stroke="#64748b" strokeWidth={1.4} />
  </>
);

/** A 6 mm push button astride the groove: the pins on each side are one. */
const Tactile = ({ isPressed }: { isPressed: boolean }) => (
  <>
    <rect x={-4} y={-4} width={28} height={38} rx={2} fill="#1f2937" />
    <circle cx={10} cy={15} r={7} fill={isPressed ? '#4b5563' : '#111827'} stroke="#6b7280" strokeWidth={0.8} />
  </>
);

const Toggle = ({ isOn }: { isOn: boolean }) => (
  <>
    <rect x={-4} y={-12} width={28} height={14} rx={2} fill="#334155" />
    <rect x={isOn ? 10 : 2} y={-9} width={8} height={8} rx={1} fill="#f8fafc" />
  </>
);

const Slide = ({ toSecond }: { toSecond: boolean }) => (
  <>
    <rect x={-5} y={-11} width={30} height={12} rx={1.5} fill="#334155" />
    <rect x={toSecond ? 11 : 1} y={-9} width={8} height={8} rx={1} fill="#f8fafc" />
  </>
);

const Lamp = () => (
  <>
    <rect x={-4} y={-8} width={28} height={10} rx={2} fill="#78716c" />
    <circle cx={10} cy={-12} r={9} fill="#fef9c3" opacity={0.75} stroke="#a8a29e" strokeWidth={0.6} />
  </>
);

/** Any other part: a box along its pins, with its name. */
function Generic({ count, name }: { count: number; name: string }) {
  const width = Math.max(1, count - 1) * 10 + 8;
  return (
    <>
      <rect x={-4} y={-14} width={width} height={12} rx={1.5} fill="#475569" />
      <text {...LABEL} x={width / 2 - 4} y={-6.5} fill="#f8fafc">
        {name}
      </text>
    </>
  );
}

/** The body of a part; the pins themselves are drawn by the canvas. */
export const PartArt: React.FC<Props> = ({ el, footprint, pins, isSelected }) => {
  const def = getDevice(el.def)!;
  const model = String(el.props.model ?? '');
  const labels = footprint.pins.map((p) => p.label);
  const at = pins.map((p) => p.at);
  const turned = (child: React.ReactNode) => <g transform={`translate(${el.bb!.x} ${el.bb!.y}) rotate(${el.bb!.rot})`}>{child}</g>;
  let body: React.ReactNode;
  switch (footprint.art) {
    case 'resistor':
      body = (
        <OnLeads pins={at} half={11}>
          <Resistor value={String(el.props.value ?? '')} />
        </OnLeads>
      );
      break;
    case 'diode':
    case 'zener':
      body = (
        <OnLeads pins={at} half={7}>
          <Diode isZener={footprint.art === 'zener'} />
        </OnLeads>
      );
      break;
    case 'led':
      body = (
        <OnLeads pins={at} half={0}>
          <Led color={LED_COLORS[model] ?? LED_COLORS.LED_ROSSO} />
        </OnLeads>
      );
      break;
    case 'electrolytic':
      body = (
        <OnLeads pins={at} half={0}>
          <Electrolytic />
        </OnLeads>
      );
      break;
    case 'ceramic':
      body = (
        <OnLeads pins={at} half={0}>
          <Ceramic />
        </OnLeads>
      );
      break;
    case 'inductor':
      body = (
        <OnLeads pins={at} half={10}>
          <Inductor />
        </OnLeads>
      );
      break;
    case 'to92':
      body = turned(<To92 labels={labels} model={model} />);
      break;
    case 'to220':
      body = turned(<To220 labels={labels} model={model} />);
      break;
    case 'trimmer':
      body = turned(<Trimmer />);
      break;
    case 'tactile':
      body = turned(<Tactile isPressed={el.props.pressed === '1'} />);
      break;
    case 'toggle':
      body = turned(<Toggle isOn={el.props.closed === '1'} />);
      break;
    case 'slide':
      body = turned(<Slide toSecond={el.props.position === '2'} />);
      break;
    case 'lamp':
      body = turned(<Lamp />);
      break;
    default:
      body = turned(<Generic count={pins.length} name={el.tag || def.name} />);
  }
  return (
    <g data-part={el.id} style={isSelected ? { filter: 'drop-shadow(0 0 2px var(--accent))' } : undefined}>
      {body}
    </g>
  );
};

/** Where a part lights up, and in what colour: a LED at its lens, a lamp at its bulb. */
export function glowSpot(el: Element, footprint: Footprint, pins: { at: Pt }[]): { at: Pt; color: string; r: number } | null {
  if (footprint.art === 'led') {
    const [a, b] = pins.map((p) => p.at);
    return { at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, color: LED_COLORS[String(el.props.model)] ?? LED_COLORS.LED_ROSSO, r: 7 };
  }
  if (footprint.art === 'lamp') {
    const rad = (el.bb!.rot * Math.PI) / 180;
    const [lx, ly] = [10, -12];
    return { at: { x: el.bb!.x + lx * Math.cos(rad) - ly * Math.sin(rad), y: el.bb!.y + lx * Math.sin(rad) + ly * Math.cos(rad) }, color: '#fde047', r: 11 };
  }
  return null;
}
