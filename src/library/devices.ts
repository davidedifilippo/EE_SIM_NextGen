import { ComponentDef, Prim, Rotation, Circuit, Element, Pt } from '../model/types';

const twoPin = (a: string, b: string) => [
  { id: a, x: -40, y: 0 },
  { id: b, x: 40, y: 0 },
];

const leads = (inner: number): Prim[] => [
  { t: 'line', x1: -40, y1: 0, x2: -inner, y2: 0 },
  { t: 'line', x1: inner, y1: 0, x2: 40, y2: 0 },
];

export const DEVICES: ComponentDef[] = [
  {
    id: 'resistor',
    name: 'Resistore',
    tagPrefix: 'R',
    terminals: twoPin('a', 'b'),
    symbol: [...leads(20), { t: 'rect', x: -20, y: -8, w: 40, h: 16, fill: '#ffffff' }],
    props: [{ key: 'value', label: 'Resistenza', type: 'text', default: '1k' }],
    spice: { kind: 'passive', prefix: 'R', a: 'a', b: 'b', valueProp: 'value' },
  },
  {
    id: 'capacitor',
    name: 'Condensatore',
    tagPrefix: 'C',
    terminals: twoPin('a', 'b'),
    symbol: [
      ...leads(5),
      { t: 'line', x1: -5, y1: -14, x2: -5, y2: 14, w: 2 },
      { t: 'line', x1: 5, y1: -14, x2: 5, y2: 14, w: 2 },
    ],
    props: [{ key: 'value', label: 'Capacità', type: 'text', default: '100u' }],
    spice: { kind: 'passive', prefix: 'C', a: 'a', b: 'b', valueProp: 'value' },
  },
  {
    id: 'inductor',
    name: 'Induttore',
    tagPrefix: 'L',
    terminals: twoPin('a', 'b'),
    symbol: [...leads(24), { t: 'path', d: 'M -24 0 A 6 6 0 0 1 -12 0 A 6 6 0 0 1 0 0 A 6 6 0 0 1 12 0 A 6 6 0 0 1 24 0' }],
    props: [{ key: 'value', label: 'Induttanza', type: 'text', default: '10m' }],
    spice: { kind: 'passive', prefix: 'L', a: 'a', b: 'b', valueProp: 'value' },
  },
  {
    id: 'vsource',
    name: 'Generatore',
    tagPrefix: 'V',
    terminals: twoPin('pos', 'neg'),
    symbol: [
      ...leads(18),
      { t: 'circle', cx: 0, cy: 0, r: 18, fill: '#ffffff' },
      { t: 'line', x1: -14, y1: 0, x2: -8, y2: 0 },
      { t: 'line', x1: -11, y1: -3, x2: -11, y2: 3 },
      { t: 'line', x1: 8, y1: 0, x2: 14, y2: 0 },
      { t: 'path', d: 'M -6 0 Q -3 -9 0 0 T 6 0' },
    ],
    props: [{ key: 'spec', label: 'Sorgente', type: 'text', default: 'SIN(0 10 50)' }],
    spice: { kind: 'vsource', pos: 'pos', neg: 'neg' },
  },
  {
    id: 'diode',
    name: 'Diodo',
    tagPrefix: 'D',
    terminals: twoPin('anode', 'cathode'),
    symbol: [
      ...leads(10),
      { t: 'path', d: 'M -10 -12 L 10 0 L -10 12 Z', fill: '#0f172a' },
      { t: 'line', x1: 10, y1: -12, x2: 10, y2: 12, w: 2 },
    ],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'D1N4148' }],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'ground',
    name: 'Massa',
    terminals: [{ id: 'g', x: 0, y: 0 }],
    symbol: [
      { t: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
      { t: 'line', x1: -12, y1: 10, x2: 12, y2: 10, w: 2 },
      { t: 'line', x1: -8, y1: 15, x2: 8, y2: 15, w: 2 },
      { t: 'line', x1: -4, y1: 20, x2: 4, y2: 20, w: 2 },
    ],
    props: [],
    spice: { kind: 'ground', terminal: 'g' },
  },
];

const byId = new Map(DEVICES.map((d) => [d.id, d]));

export function getDevice(id: string): ComponentDef | undefined {
  return byId.get(id);
}

/** First free tag for the prefix: deleting R1 from R1, R2 gives R1 again, never a duplicate R2. */
export function nextTag(prefix: string, elements: Element[]): string {
  const used = new Set(elements.map((e) => e.tag.toUpperCase()));
  let n = 1;
  while (used.has(`${prefix}${n}`.toUpperCase())) n++;
  return `${prefix}${n}`;
}

export function createElement(def: ComponentDef, pos: Pt, rot: Rotation, circuit: Circuit, id: string): Element {
  return {
    id,
    def: def.id,
    x: pos.x,
    y: pos.y,
    rot,
    tag: def.tagPrefix ? nextTag(def.tagPrefix, circuit.elements) : '',
    props: Object.fromEntries(def.props.map((p) => [p.key, p.default])),
  };
}
