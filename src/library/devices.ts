import { METER_MODES } from '../realtime/meterModes';
import { MAX_BLOCK_PINS, MIN_BLOCK_PINS } from './blockPins';
import { ComponentDef, Prim, Rotation, Circuit, Element, Pt } from '../model/types';
import { GateKind } from '../realtime/logic';
import { SourceShape, sourceShape } from '../netlist/source';


/** One part for each number of pins, as terminals belong to the kind of part: half on the left, the rest on the right. */
function blockDevice(count: number): ComponentDef {
  const left = Math.ceil(count / 2);
  const rows = (side: number, index: number) => (index - (side - 1) / 2) * 20;
  const terminals = Array.from({ length: count }, (_, k) => (k < left ? { id: `p${k + 1}`, x: -50, y: rows(left, k) } : { id: `p${k + 1}`, x: 50, y: rows(count - left, k - left) }));
  const halfHeight = (left * 20) / 2 + 6;
  return {
    id: blockId(count),
    name: 'Sottocircuito',
    category: 'Altri',
    tagPrefix: 'X',
    terminals,
    symbol: [
      ...terminals.map((t): Prim => ({ t: 'line', x1: t.x, y1: t.y, x2: Math.sign(t.x) * 34, y2: t.y })),
      { t: 'rect', x: -34, y: -halfHeight, w: 68, h: 2 * halfHeight, fill: 'var(--sch-part-soft)' },
    ],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: '', modelType: 'SUBCKT' }],
    spice: { kind: 'block', pins: terminals.map((t) => t.id), modelProp: 'model' },
    isHidden: count !== DEFAULT_BLOCK_PINS,
  };
}

/** Typical values from the datasheets of the fixed series, for a TO-220 without a heatsink; they differ by maker. */
const FIXED_REGULATOR = { iq: 5e-3, imax: '2.2', dropout: '2', rth: '65' };
const ADJUSTABLE_REGULATOR = { iq: 50e-6, imax: '2.2', dropout: '2', rth: '50' };

function regulatorDevice(name: string, vNominal: number, polarity: 1 | -1, isAdjustable = false): ComponentDef {
  const { iq, imax, dropout, rth } = isAdjustable ? ADJUSTABLE_REGULATOR : FIXED_REGULATOR;
  return {
    id: `reg${name.toLowerCase()}`,
    name,
    category: 'Regolatori',
    tagPrefix: 'U',
    terminals: [
      { id: 'in', x: -40, y: 0 },
      { id: 'out', x: 40, y: 0 },
      { id: 'ref', x: 0, y: 40 },
    ],
    symbol: [...leads(32), { t: 'line', x1: 0, y1: 20, x2: 0, y2: 40 }, { t: 'rect', x: -32, y: -20, w: 64, h: 40, fill: 'var(--sch-part-soft)' }],
    props: [
      { key: 'model', label: 'Modello', type: 'model', default: '', modelType: 'REGULATOR' },
      { key: 'imax', label: 'Corrente massima (A)', type: 'text', default: imax },
      { key: 'dropout', label: 'Caduta minima (V)', type: 'text', default: dropout },
      { key: 'rth', label: 'Resistenza termica (°C/W)', type: 'text', default: rth },
      { key: 'ta', label: 'Temperatura ambiente (°C)', type: 'text', default: '25' },
    ],
    spice: { kind: 'regulator', input: 'in', output: 'out', ref: 'ref', vNominal, polarity, iq },
  };
}

/** The part for a model with so many pins. */
export const blockId = (count: number) => `block${count}`;
const DEFAULT_BLOCK_PINS = 3;

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
  { t: 'circle', cx: 0, cy: 0, r: 18, fill: 'var(--sch-part)' },
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

/** The instrument, with the pointer of its dial on a mode. */
function meterSymbol(mode: unknown): Prim[] {
  const { x, y } = (METER_MODES.find((m) => m.value === mode) ?? METER_MODES[0]).dial;
  const length = Math.hypot(x, y);
  const [ux, uy] = [x / length, y / length];
  const at = (along: number, across: number) => `${ux * along - uy * across} ${uy * along + ux * across}`;
  const ticks = METER_MODES.map(({ dial }): Prim => {
    const size = Math.hypot(dial.x, dial.y);
    return { t: 'line', x1: (dial.x / size) * 18, y1: (dial.y / size) * 18, x2: (dial.x / size) * 22, y2: (dial.y / size) * 22, w: 1.2 };
  });
  const socket = (cx: number, ring: string, center: string): Prim[] => [
    { t: 'line', x1: cx, y1: 60, x2: cx, y2: 80 },
    { t: 'circle', cx, cy: 50, r: 9, fill: ring },
    { t: 'circle', cx, cy: 50, r: 4, fill: center },
  ];
  return [
    { t: 'path', d: 'M -42 -80 H 42 A 8 8 0 0 1 50 -72 V 58 A 8 8 0 0 1 42 66 H -42 A 8 8 0 0 1 -50 58 V -72 A 8 8 0 0 1 -42 -80 Z', fill: 'var(--sch-part)' },
    { t: 'rect', x: -41, y: -71, w: 82, h: 32, fill: '#e2e8e0' },
    ...ticks,
    { t: 'circle', cx: 0, cy: 0, r: 16, fill: 'var(--sch-part)' },
    { t: 'path', d: `M ${at(14, 0)} L ${at(7, 4)} L ${at(7, -4)} Z`, fill: 'var(--sch-ink)' },
    ...socket(-20, '#dc2626', '#7f1d1d'),
    ...socket(20, '#475569', '#1e293b'),
  ];
}

/** A source that only gives a fixed voltage. To the engines it is a generator like the others. */
function dcSource(id: string, name: string, voltage: string, resistance: string, symbol: Prim[], searchTerms: string): ComponentDef {
  return {
    id,
    category: 'Sorgenti',
    name,
    tagPrefix: 'V',
    searchTerms,
    terminals: twoPin('pos', 'neg'),
    symbol,
    props: [
      { key: 'shape', label: 'Tipo di segnale', type: 'text', default: 'dc' },
      { key: 'amplitude', label: 'Tensione', type: 'text', default: voltage },
      { key: 'rint', label: 'Resistenza interna', type: 'text', default: resistance },
    ],
    spice: { kind: 'vsource', pos: 'pos', neg: 'neg' },
  };
}

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
    category: 'Passivi',
    name: 'Resistore',
    tagPrefix: 'R',
    terminals: twoPin('a', 'b'),
    symbol: [...leads(20), { t: 'rect', x: -20, y: -8, w: 40, h: 16, fill: 'var(--sch-part)' }],
    props: [{ key: 'value', label: 'Resistenza', type: 'text', default: '1k' }],
    spice: { kind: 'passive', prefix: 'R', a: 'a', b: 'b', valueProp: 'value' },
  },
  {
    id: 'capacitor',
    category: 'Passivi',
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
    category: 'Passivi',
    name: 'Induttore',
    tagPrefix: 'L',
    terminals: twoPin('a', 'b'),
    symbol: [...leads(24), { t: 'path', d: 'M -24 0 A 6 6 0 0 1 -12 0 A 6 6 0 0 1 0 0 A 6 6 0 0 1 12 0 A 6 6 0 0 1 24 0' }],
    props: [{ key: 'value', label: 'Induttanza', type: 'text', default: '10m' }],
    spice: { kind: 'passive', prefix: 'L', a: 'a', b: 'b', valueProp: 'value' },
  },
  // A bench supply is close to ideal; a battery is not, and gives its current only through its own resistance
  dcSource('dcsupply', 'Alimentazione continua', '12', '0', SOURCE_BODY, 'dc alimentatore'),
  dcSource(
    'battery',
    'Batteria',
    '9',
    '1',
    [
      ...leads(9),
      // Two cells: the long plate is the positive one
      { t: 'line', x1: -9, y1: -14, x2: -9, y2: 14 },
      { t: 'line', x1: -3, y1: -7, x2: -3, y2: 7, w: 3 },
      { t: 'line', x1: 3, y1: -14, x2: 3, y2: 14 },
      { t: 'line', x1: 9, y1: -7, x2: 9, y2: 7, w: 3 },
      { t: 'line', x1: -20, y1: -9, x2: -14, y2: -9, w: 1.2 },
      { t: 'line', x1: -17, y1: -12, x2: -17, y2: -6, w: 1.2 },
      { t: 'line', x1: 14, y1: -9, x2: 20, y2: -9, w: 1.2 },
    ],
    'dc pila',
  ),
  {
    id: 'vsource',
    category: 'Sorgenti',
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
      { key: 'rint', label: 'Resistenza interna', type: 'text', default: '0' },
    ],
    spice: { kind: 'vsource', pos: 'pos', neg: 'neg' },
  },
  {
    id: 'diode',
    category: 'Semiconduttori',
    name: 'Diodo',
    tagPrefix: 'D',
    terminals: twoPin('anode', 'cathode'),
    symbol: [
      ...leads(10),
      { t: 'path', d: 'M -10 -12 L 10 0 L -10 12 Z', fill: 'var(--sch-ink)' },
      { t: 'line', x1: 10, y1: -12, x2: 10, y2: 12, w: 2 },
    ],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'D1N4148', modelType: 'D' }],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'led',
    category: 'Semiconduttori',
    name: 'LED',
    tagPrefix: 'D',
    searchTerms: 'led luce diodo luminoso',
    terminals: twoPin('anode', 'cathode'),
    symbol: [
      ...leads(10),
      { t: 'path', d: 'M -10 -12 L 10 0 L -10 12 Z', fill: 'var(--sch-part)' },
      { t: 'line', x1: 10, y1: -12, x2: 10, y2: 12, w: 2 },
      { t: 'path', d: 'M 0 -15 L 7 -24 M 3 -24 L 7 -24 L 7 -20', w: 1.2 },
      { t: 'path', d: 'M 7 -13 L 14 -22 M 10 -22 L 14 -22 L 14 -18', w: 1.2 },
    ],
    props: [
      {
        key: 'model',
        label: 'Colore',
        type: 'choice',
        default: 'LED_ROSSO',
        options: [
          { value: 'LED_ROSSO', label: 'Rosso' },
          { value: 'LED_GIALLO', label: 'Giallo' },
          { value: 'LED_VERDE', label: 'Verde' },
          { value: 'LED_BLU', label: 'Blu' },
          { value: 'LED_BIANCO', label: 'Bianco' },
        ],
      },
    ],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'zener',
    category: 'Semiconduttori',
    name: 'Zener',
    tagPrefix: 'D',
    terminals: twoPin('anode', 'cathode'),
    symbol: [
      ...leads(10),
      { t: 'path', d: 'M -10 -12 L 10 0 L -10 12 Z', fill: 'var(--sch-ink)' },
      { t: 'path', d: 'M 15 -15 L 10 -12 L 10 12 L 5 15', w: 2 },
    ],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'DZ5V1', modelType: 'D' }],
    spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' },
  },
  {
    id: 'npn',
    category: 'Semiconduttori',
    name: 'NPN',
    tagPrefix: 'Q',
    terminals: BJT_TERMINALS,
    symbol: [...BJT_BODY, { t: 'path', d: 'M 20 20 L 13 9 L 7 18 Z', fill: 'var(--sch-ink)' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: '2N3904', modelType: 'NPN' }],
    spice: { kind: 'bjt', collector: 'collector', base: 'base', emitter: 'emitter', modelProp: 'model', modelType: 'NPN' },
  },
  {
    id: 'pnp',
    category: 'Semiconduttori',
    name: 'PNP',
    tagPrefix: 'Q',
    // Emitter on top, where a PNP is drawn: towards the positive supply
    terminals: [
      { id: 'collector', x: 20, y: 40 },
      { id: 'base', x: -40, y: 0 },
      { id: 'emitter', x: 20, y: -40 },
    ],
    symbol: [...BJT_BODY, { t: 'path', d: 'M -6 -6 L 7 -8 L 2 -16 Z', fill: 'var(--sch-ink)' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: '2N3906', modelType: 'PNP' }],
    spice: { kind: 'bjt', collector: 'collector', base: 'base', emitter: 'emitter', modelProp: 'model', modelType: 'PNP' },
  },
  {
    id: 'nmos',
    category: 'Semiconduttori',
    name: 'MOS N',
    tagPrefix: 'M',
    terminals: MOS_TERMINALS,
    // The middle line is the bulk, tied to the source
    symbol: [...MOS_BODY, { t: 'line', x1: 20, y1: 0, x2: 20, y2: 12 }, { t: 'path', d: 'M -6 0 L 4 -5 L 4 5 Z', fill: 'var(--sch-ink)' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'MN1', modelType: 'NMOS' }],
    spice: { kind: 'mos', drain: 'drain', gate: 'gate', source: 'source', modelProp: 'model', modelType: 'NMOS' },
  },
  {
    id: 'pmos',
    category: 'Semiconduttori',
    name: 'MOS P',
    tagPrefix: 'M',
    // Source on top, where a P channel is drawn: towards the positive supply
    terminals: [
      { id: 'drain', x: 20, y: 40 },
      { id: 'gate', x: -40, y: 0 },
      { id: 'source', x: 20, y: -40 },
    ],
    symbol: [...MOS_BODY, { t: 'line', x1: 20, y1: 0, x2: 20, y2: -12 }, { t: 'path', d: 'M 6 0 L -4 -5 L -4 5 Z', fill: 'var(--sch-ink)' }],
    props: [{ key: 'model', label: 'Modello', type: 'model', default: 'MP1', modelType: 'PMOS' }],
    spice: { kind: 'mos', drain: 'drain', gate: 'gate', source: 'source', modelProp: 'model', modelType: 'PMOS' },
  },
  {
    id: 'opamp',
    category: 'Operazionali',
    name: 'Op. amp',
    tagPrefix: 'U',
    terminals: [
      { id: 'minus', x: -40, y: -10 },
      { id: 'plus', x: -40, y: 10 },
      { id: 'out', x: 40, y: 0 },
    ],
    symbol: [
      { t: 'line', x1: -40, y1: -10, x2: -24, y2: -10 },
      { t: 'line', x1: -40, y1: 10, x2: -24, y2: 10 },
      { t: 'line', x1: 28, y1: 0, x2: 40, y2: 0 },
      { t: 'path', d: 'M -24 -30 L 28 0 L -24 30 Z', fill: 'var(--sch-part)' },
      { t: 'line', x1: -20, y1: -10, x2: -15, y2: -10, w: 1.2 },
      { t: 'line', x1: -20, y1: 10, x2: -15, y2: 10, w: 1.2 },
      { t: 'line', x1: -17.5, y1: 7.5, x2: -17.5, y2: 12.5, w: 1.2 },
    ],
    props: [
      { key: 'high', label: 'Alimentazione + (V)', type: 'text', default: '15' },
      { key: 'low', label: 'Alimentazione − (V)', type: 'text', default: '-15' },
      { key: 'model', label: 'Modello', type: 'model', default: '', modelType: 'OPAMP' },
      { key: 'gbw', label: 'GBW (Hz), vuoto se ideale', type: 'text', default: '' },
    ],
    spice: { kind: 'opamp', plus: 'plus', minus: 'minus', out: 'out', highProp: 'high', lowProp: 'low', gbwProp: 'gbw', modelProp: 'model', pinsProp: 'pins' },
  },
  {
    id: 'multimeter',
    category: 'Strumenti',
    name: 'Multimetro',
    tagPrefix: 'MM',
    // On the sockets at the bottom: the red one, on the left, is the positive
    terminals: [
      { id: 'a', x: -20, y: 80 },
      { id: 'b', x: 20, y: 80 },
    ],
    symbol: meterSymbol('vdc'),
    props: [{ key: 'mode', label: 'Misura', type: 'choice', default: 'vdc', options: METER_MODES.map(({ value, label }) => ({ value, label })) }],
    spice: { kind: 'meter', a: 'a', b: 'b', modeProp: 'mode' },
  },
  {
    id: 'multimetercompact',
    category: 'Strumenti',
    name: 'Multimetro compatto',
    tagPrefix: 'MM',
    searchTerms: 'multimetro piccolo',
    // The display is drawn over it, upright whatever the rotation: a square leaves room for it
    terminals: twoPin('a', 'b'),
    symbol: [
      ...leads(28),
      { t: 'rect', x: -28, y: -28, w: 56, h: 56, fill: 'var(--sch-part-soft)' },
      { t: 'line', x1: -38, y1: -8, x2: -32, y2: -8, w: 1.2 },
      { t: 'line', x1: -35, y1: -11, x2: -35, y2: -5, w: 1.2 },
      { t: 'line', x1: 32, y1: -8, x2: 38, y2: -8, w: 1.2 },
    ],
    props: [{ key: 'mode', label: 'Misura', type: 'choice', default: 'vdc', options: METER_MODES.map(({ value, label }) => ({ value, label })) }],
    spice: { kind: 'meter', a: 'a', b: 'b', modeProp: 'mode' },
  },
  {
    id: 'isource',
    category: 'Sorgenti',
    name: 'Generatore di corrente',
    tagPrefix: 'I',
    searchTerms: 'corrente isource',
    terminals: twoPin('a', 'b'),
    symbol: [
      ...leads(18),
      { t: 'circle', cx: 0, cy: 0, r: 18, fill: 'var(--sch-part)' },
      { t: 'line', x1: -11, y1: 0, x2: 10, y2: 0 },
      { t: 'path', d: 'M 4 -5 L 11 0 L 4 5' },
    ],
    props: [{ key: 'value', label: 'Corrente (A)', type: 'text', default: '10m' }],
    spice: { kind: 'isource', a: 'a', b: 'b', valueProp: 'value' },
  },
  {
    id: 'transformer',
    category: 'Passivi',
    name: 'Trasformatore',
    tagPrefix: 'T',
    // The upper terminals are in phase, as the dots say
    terminals: [
      { id: 'p1', x: -40, y: -20 },
      { id: 'p2', x: -40, y: 20 },
      { id: 's1', x: 40, y: -20 },
      { id: 's2', x: 40, y: 20 },
    ],
    symbol: [
      { t: 'line', x1: -40, y1: -20, x2: -14, y2: -20 },
      { t: 'line', x1: -40, y1: 20, x2: -14, y2: 20 },
      { t: 'line', x1: 14, y1: -20, x2: 40, y2: -20 },
      { t: 'line', x1: 14, y1: 20, x2: 40, y2: 20 },
      { t: 'path', d: 'M -14 -20 A 5 5 0 0 1 -14 -10 A 5 5 0 0 1 -14 0 A 5 5 0 0 1 -14 10 A 5 5 0 0 1 -14 20' },
      { t: 'path', d: 'M 14 -20 A 5 5 0 0 0 14 -10 A 5 5 0 0 0 14 0 A 5 5 0 0 0 14 10 A 5 5 0 0 0 14 20' },
      { t: 'line', x1: -3, y1: -22, x2: -3, y2: 22 },
      { t: 'line', x1: 3, y1: -22, x2: 3, y2: 22 },
      { t: 'circle', cx: -19, cy: -25, r: 2, fill: 'var(--sch-ink)' },
      { t: 'circle', cx: 19, cy: -25, r: 2, fill: 'var(--sch-ink)' },
    ],
    props: [
      { key: 'ratio', label: 'Rapporto spire N1/N2', type: 'text', default: '10' },
      { key: 'inductance', label: 'Induttanza primaria (H)', type: 'text', default: '10' },
      { key: 'coupling', label: 'Accoppiamento k (minore di 1)', type: 'text', default: '0.999' },
    ],
    spice: { kind: 'transformer', p1: 'p1', p2: 'p2', s1: 's1', s2: 's2', ratioProp: 'ratio', inductanceProp: 'inductance', couplingProp: 'coupling' },
  },
  {
    id: 'ground',
    category: 'Sorgenti',
    searchTerms: 'gnd ground terra',
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

/** Inputs on the left, the output on the right: the usual drawing of a gate in a schematic. */
const GATE_INPUTS = [
  { id: 'a', x: -40, y: -10 },
  { id: 'b', x: -40, y: 10 },
];
const GATE_LEADS: Prim[] = [
  { t: 'line', x1: -40, y1: -10, x2: -20, y2: -10 },
  { t: 'line', x1: -40, y1: 10, x2: -20, y2: 10 },
];
const AND_BODY = 'M -20 -18 H 0 A 18 18 0 0 1 0 18 H -20 Z';
const OR_BODY = 'M -24 -18 Q -14 0 -24 18 Q 4 18 18 0 Q 4 -18 -24 -18 Z';
const bubble = (x: number): Prim => ({ t: 'circle', cx: x + 4, cy: 0, r: 4, fill: 'var(--sch-part)' });
const output = (from: number): Prim => ({ t: 'line', x1: from, y1: 0, x2: 40, y2: 0 });
const SUPPLY_PROP = { key: 'vdd', label: 'Alimentazione (V)', type: 'text' as const, default: '5' };

function gateDevice(gate: GateKind, name: string, body: Prim[], searchTerms: string): ComponentDef {
  const isNot = gate === 'not';
  return {
    id: `gate_${gate}`,
    category: 'Logica',
    name,
    tagPrefix: 'U',
    searchTerms: `porta logica ${searchTerms}`,
    terminals: [...(isNot ? [{ id: 'a', x: -40, y: 0 }] : GATE_INPUTS), { id: 'y', x: 40, y: 0 }],
    symbol: body,
    props: [SUPPLY_PROP],
    spice: { kind: 'logic', gate, inputs: isNot ? ['a'] : ['a', 'b'], output: 'y', vddProp: 'vdd' },
  };
}

const LOGIC: ComponentDef[] = [
  {
    id: 'logicinput',
    category: 'Logica',
    name: 'Ingresso logico',
    tagPrefix: 'IN',
    searchTerms: 'interruttore livello logico 0 1 switch',
    terminals: [{ id: 'y', x: 40, y: 0 }],
    symbol: [
      { t: 'rect', x: -24, y: -14, w: 34, h: 28, fill: 'var(--sch-part)' },
      { t: 'line', x1: 10, y1: 0, x2: 40, y2: 0 },
    ],
    props: [
      { key: 'state', label: 'Livello', type: 'choice', default: '0', options: [{ value: '0', label: '0' }, { value: '1', label: '1' }] },
      SUPPLY_PROP,
    ],
    spice: { kind: 'logic', gate: 'input', inputs: [], output: 'y', vddProp: 'vdd', stateProp: 'state' },
  },
  gateDevice('and', 'AND', [...GATE_LEADS, { t: 'path', d: AND_BODY, fill: 'var(--sch-part)' }, output(18)], 'and e'),
  gateDevice('or', 'OR', [...GATE_LEADS, { t: 'path', d: OR_BODY, fill: 'var(--sch-part)' }, output(18)], 'or o'),
  gateDevice('not', 'NOT', [{ t: 'line', x1: -40, y1: 0, x2: -18, y2: 0 }, { t: 'path', d: 'M -18 -15 L 12 0 L -18 15 Z', fill: 'var(--sch-part)' }, bubble(12), output(20)], 'not inverter invertitore'),
  gateDevice('nand', 'NAND', [...GATE_LEADS, { t: 'path', d: AND_BODY, fill: 'var(--sch-part)' }, bubble(18), output(26)], 'nand'),
  gateDevice('nor', 'NOR', [...GATE_LEADS, { t: 'path', d: OR_BODY, fill: 'var(--sch-part)' }, bubble(18), output(26)], 'nor'),
  gateDevice('xor', 'XOR', [...GATE_LEADS, { t: 'path', d: 'M -30 -18 Q -20 0 -30 18' }, { t: 'path', d: OR_BODY, fill: 'var(--sch-part)' }, output(18)], 'xor or esclusivo'),
];

const REGULATORS = [
  ...[5, 6, 8, 9, 12, 15, 24].map((v) => regulatorDevice(`78${String(v).padStart(2, '0')}`, v, 1)),
  ...[5, 12, 15].map((v) => regulatorDevice(`79${String(v).padStart(2, '0')}`, v, -1)),
  regulatorDevice('LM317', 1.25, 1, true),
  regulatorDevice('LM337', 1.25, -1, true),
];

DEVICES.push(...REGULATORS, ...LOGIC);
for (let count = MIN_BLOCK_PINS; count <= MAX_BLOCK_PINS; count++) DEVICES.push(blockDevice(count));

const byId = new Map(DEVICES.map((d) => [d.id, d]));

export function getDevice(id: string): ComponentDef | undefined {
  return byId.get(id);
}

export function elementSymbol(def: ComponentDef, element: Element): Prim[] {
  if (def.id === 'multimeter' && def.spice.kind === 'meter') return meterSymbol(element.props[def.spice.modeProp]);
  if (def.id !== 'vsource') return def.symbol;
  return [...SOURCE_BODY, { t: 'path', d: SOURCE_GLYPHS[sourceShape(element.props)] }];
}

/** Parts that are not the same when mirrored: on the others a mirror would change nothing. */
export const canMirror = (def: ComponentDef | undefined) => def?.spice.kind === 'opamp' || def?.spice.kind === 'bjt' || def?.spice.kind === 'mos' || def?.spice.kind === 'transformer';

/** The full instrument on its side could not be read. */
export const canRotate = (def: ComponentDef | undefined) => def?.id !== 'multimeter';

export const isVoltageSource = (el: Element) => getDevice(el.def)?.spice.kind === 'vsource';

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
    rot: canRotate(def) ? rot : 0,
    tag: def.tagPrefix ? nextTag(def.tagPrefix, circuit.elements) : '',
    props: Object.fromEntries(def.props.map((p) => [p.key, p.default])),
  };
}
