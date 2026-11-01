import { ComponentDef, Prim, Rotation, Circuit, Element, Pt } from '../model/types';
import { SourceShape, sourceShape } from '../netlist/source';

const twoPin = (a: string, b: string) => [
  { id: a, x: -40, y: 0 },
  { id: b, x: 40, y: 0 },
];

const leads = (inner: number): Prim[] => [
  { t: 'line', x1: -40, y1: 0, x2: -inner, y2: 0 },
  { t: 'line', x1: inner, y1: 0, x2: 40, y2: 0 },
];

const SOURCE_BODY: Prim[] = [
  ...leads(18),
  { t: 'circle', cx: 0, cy: 0, r: 18, fill: '#ffffff' },
  { t: 'line', x1: -14, y1: 0, x2: -8, y2: 0 },
  { t: 'line', x1: -11, y1: -3, x2: -11, y2: 3 },
  { t: 'line', x1: 8, y1: 0, x2: 14, y2: 0 },
];

/** What is drawn inside the generator, and on the buttons that choose the signal. */
export const SOURCE_GLYPHS: Record<SourceShape, string> = {
  sin: 'M -6 0 Q -3 -9 0 0 T 6 0',
  square: 'M -6 4 L -6 -4 L 0 -4 L 0 4 L 6 4',
  dc: 'M -6 -2 L 6 -2 M -6 2 L 6 2',
  custom: 'M -6 3 L -3 -5 L -1 1 L 2 -3 L 6 4',
};

const BJT_TERMINALS = [
  { id: 'collector', x: 20, y: -40 },
  { id: 'base', x: -40, y: 0 },
  { id: 'emitter', x: 20, y: 40 },
];

const BJT_BODY: Prim[] = [
  { t: 'line', x1: -40, y1: 0, x2: -6, y2: 0 },
  { t: 'line', x1: -6, y1: -14, x2: -6, y2: 14, w: 3 },
  { t: 'line', x1: -6, y1: -6, x2: 20, y2: -20 },
  { t: 'line', x1: 20, y1: -20, x2: 20, y2: -40 },
  { t: 'line', x1: -6, y1: 6, x2: 20, y2: 20 },
  { t: 'line', x1: 20, y1: 20, x2: 20, y2: 40 },
];

const MOS_TERMINALS = [
  { id: 'drain', x: 20, y: -40 },
  { id: 'gate', x: -40, y: 0 },
  { id: 'source', x: 20, y: 40 },
];

const MOS_BODY: Prim[] = [
  { t: 'line', x1: -40, y1: 0, x2: -12, y2: 0 },
  { t: 'line', x1: -12, y1: -14, x2: -12, y2: 14, w: 2 },
  { t: 'line', x1: -6, y1: -16, x2: -6, y2: -6, w: 3 },
  { t: 'line', x1: -6, y1: -4, x2: -6, y2: 4, w: 3 },
  { t: 'line', x1: -6, y1: 6, x2: -6, y2: 16, w: 3 },
  { t: 'line', x1: -6, y1: -12, x2: 20, y2: -12 },
  { t: 'line', x1: 20, y1: -12, x2: 20, y2: -40 },
  { t: 'line', x1: -6, y1: 12, x2: 20, y2: 12 },
  { t: 'line', x1: 20, y1: 12, x2: 20, y2: 40 },
  { t: 'line', x1: -6, y1: 0, x2: 20, y2: 0 },
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
    symbol: [...SOURCE_BODY, { t: 'path', d: SOURCE_GLYPHS.sin }],
    props: [
      { key: 'shape', label: 'Tipo di segnale', type: 'text', default: 'sin' },
      { key: 'amplitude', label: 'Valore massimo', type: 'text', default: '10' },
      { key: 'offset', label: 'Offset', type: 'text', default: '0' },
      { key: 'frequency', label: 'Frequenza', type: 'text', default: '50' },
      { key: 'phase', label: 'Fase iniziale', type: 'text', default: '0' },
      { key: 'duty', label: 'Duty cycle', type: 'text', default: '50' },
      { key: 'spec', label: 'Stringa ngspice', type: 'text', default: '' },
    ],
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
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'D1N4148', modelType: 'D' }],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'zener',
    name: 'Zener',
    tagPrefix: 'D',
    terminals: twoPin('anode', 'cathode'),
    symbol: [
      ...leads(10),
      { t: 'path', d: 'M -10 -12 L 10 0 L -10 12 Z', fill: '#0f172a' },
      { t: 'path', d: 'M 15 -15 L 10 -12 L 10 12 L 5 15', w: 2 },
    ],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'DZ5V1', modelType: 'D' }],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'npn',
    name: 'NPN',
    tagPrefix: 'Q',
    terminals: BJT_TERMINALS,
    symbol: [...BJT_BODY, { t: 'path', d: 'M 20 20 L 13 9 L 7 18 Z', fill: '#0f172a' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: '2N3904', modelType: 'NPN' }],
    spice: { kind: 'bjt', collector: 'collector', base: 'base', emitter: 'emitter', modelProp: 'model', modelType: 'NPN' },
  },
  {
    id: 'pnp',
    name: 'PNP',
    tagPrefix: 'Q',
    // Emitter on top, where a PNP is drawn: towards the positive supply
    terminals: [
      { id: 'collector', x: 20, y: 40 },
      { id: 'base', x: -40, y: 0 },
      { id: 'emitter', x: 20, y: -40 },
    ],
    symbol: [...BJT_BODY, { t: 'path', d: 'M -6 -6 L 7 -8 L 2 -16 Z', fill: '#0f172a' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: '2N3906', modelType: 'PNP' }],
    spice: { kind: 'bjt', collector: 'collector', base: 'base', emitter: 'emitter', modelProp: 'model', modelType: 'PNP' },
  },
  {
    id: 'nmos',
    name: 'MOS N',
    tagPrefix: 'M',
    terminals: MOS_TERMINALS,
    // The middle line is the bulk, tied to the source
    symbol: [...MOS_BODY, { t: 'line', x1: 20, y1: 0, x2: 20, y2: 12 }, { t: 'path', d: 'M -6 0 L 4 -5 L 4 5 Z', fill: '#0f172a' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'MN1', modelType: 'NMOS' }],
    spice: { kind: 'mos', drain: 'drain', gate: 'gate', source: 'source', modelProp: 'model', modelType: 'NMOS' },
  },
  {
    id: 'pmos',
    name: 'MOS P',
    tagPrefix: 'M',
    // Source on top, where a P channel is drawn: towards the positive supply
    terminals: [
      { id: 'drain', x: 20, y: 40 },
      { id: 'gate', x: -40, y: 0 },
      { id: 'source', x: 20, y: -40 },
    ],
    symbol: [...MOS_BODY, { t: 'line', x1: 20, y1: 0, x2: 20, y2: -12 }, { t: 'path', d: 'M 6 0 L -4 -5 L -4 5 Z', fill: '#0f172a' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'MP1', modelType: 'PMOS' }],
    spice: { kind: 'mos', drain: 'drain', gate: 'gate', source: 'source', modelProp: 'model', modelType: 'PMOS' },
  },
  {
    id: 'opamp',
    name: 'Op. amp',
    tagPrefix: 'U',
    terminals: [
      { id: 'minus', x: -40, y: -20 },
      { id: 'plus', x: -40, y: 20 },
      { id: 'out', x: 40, y: 0 },
    ],
    symbol: [
      { t: 'line', x1: -40, y1: -20, x2: -24, y2: -20 },
      { t: 'line', x1: -40, y1: 20, x2: -24, y2: 20 },
      { t: 'line', x1: 28, y1: 0, x2: 40, y2: 0 },
      { t: 'path', d: 'M -24 -28 L 28 0 L -24 28 Z', fill: '#ffffff' },
      { t: 'line', x1: -20, y1: -20, x2: -12, y2: -20 },
      { t: 'line', x1: -20, y1: 20, x2: -12, y2: 20 },
      { t: 'line', x1: -16, y1: 16, x2: -16, y2: 24 },
    ],
    props: [
      { key: 'high', label: 'Alimentazione + (V)', type: 'text', default: '15' },
      { key: 'low', label: 'Alimentazione − (V)', type: 'text', default: '-15' },
    ],
    spice: { kind: 'opamp', plus: 'plus', minus: 'minus', out: 'out', highProp: 'high', lowProp: 'low' },
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

export function elementSymbol(def: ComponentDef, element: Element): Prim[] {
  if (def.id !== 'vsource') return def.symbol;
  return [...SOURCE_BODY, { t: 'path', d: SOURCE_GLYPHS[sourceShape(element.props)] }];
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
