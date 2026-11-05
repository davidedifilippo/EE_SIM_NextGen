import { Circuit, Element, Wire } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { GateKind, LogicNetwork } from '../realtime/logic';
import { getDevice } from './devices';

/**
 * The inner schematics of the parts made of parts: drawn with the parts of the library, gates or
 * other composites, and a flag for each pin. They are opened read-only from the properties, and
 * flattened into a network of elementary gates for the engines.
 */

const part = (id: string, def: string, x: number, y: number, tag: string): Element => ({ id, def, x, y, rot: 0, tag, props: { vdd: '5' } });
const portIn = (name: string, x: number, y: number): Element => ({ id: `in_${name}`, def: 'port_in', x, y, rot: 0, tag: name, props: {} });
const portOut = (name: string, x: number, y: number): Element => ({ id: `out_${name}`, def: 'port_out', x, y, rot: 0, tag: name, props: {} });
let wireCount = 0;
const wire = (...pts: [number, number][]): Wire => ({ id: `w${++wireCount}`, pts: pts.map(([x, y]) => ({ x, y })) });

const schematic = (title: string, elements: Element[], wires: Wire[]): Circuit => ({ title, elements, wires, models: [] });

/** XOR for the sum, AND for the carry. */
const halfAdder = () =>
  schematic(
    'Half adder',
    [portIn('A', -100, -40), portIn('B', -100, -20), part('u1', 'gate_xor', 40, -30, 'U1'), part('u2', 'gate_and', 40, 50, 'U2'), portOut('S', 140, -30), portOut('C', 140, 50)],
    [wire([-100, -40], [0, -40]), wire([-60, -40], [-60, 40], [0, 40]), wire([-100, -20], [0, -20]), wire([-40, -20], [-40, 60], [0, 60]), wire([80, -30], [140, -30]), wire([80, 50], [140, 50])],
  );

/** Two half adders, the first on A and B, the second on its sum and Cin; an OR of their carries. */
const fullAdder = () =>
  schematic(
    'Full adder',
    [
      portIn('A', -140, -40),
      portIn('B', -140, -20),
      portIn('Cin', -140, 60),
      part('ha1', 'halfadder', -40, -30, 'HA1'),
      part('ha2', 'halfadder', 100, 10, 'HA2'),
      part('u1', 'gate_or', 240, 50, 'U1'),
      portOut('S', 320, 0),
      portOut('Cout', 320, 50),
    ],
    [
      wire([-140, -40], [-80, -40]),
      wire([-140, -20], [-80, -20]),
      wire([0, -40], [30, -40], [30, 0], [60, 0]),
      wire([-140, 60], [40, 60], [40, 20], [60, 20]),
      wire([0, -20], [10, -20], [10, 100], [180, 100], [180, 40], [200, 40]),
      wire([140, 20], [160, 20], [160, 60], [200, 60]),
      wire([140, 0], [320, 0]),
      wire([280, 50], [320, 50]),
    ],
  );

/** Y = D0 when S is 0, D1 when S is 1: two AND, one with S and one with its complement, into an OR. */
const mux2 = () =>
  schematic(
    'MUX 2:1',
    [
      portIn('D0', -160, -40),
      portIn('D1', -160, 20),
      portIn('S', -160, 80),
      part('u1', 'gate_not', -60, 80, 'U1'),
      part('u2', 'gate_and', 40, -30, 'U2'),
      part('u3', 'gate_and', 40, 30, 'U3'),
      part('u4', 'gate_or', 140, 0, 'U4'),
      portOut('Y', 220, 0),
    ],
    [
      wire([-160, -40], [0, -40]),
      wire([-160, 20], [0, 20]),
      wire([-160, 80], [-100, 80]),
      wire([-120, 80], [-120, 40], [0, 40]),
      wire([-20, 80], [-10, 80], [-10, -20], [0, -20]),
      wire([80, -30], [90, -30], [90, -10], [100, -10]),
      wire([80, 30], [90, 30], [90, 10], [100, 10]),
      wire([180, 0], [220, 0]),
    ],
  );

/** Two MUX 2:1 choose with S0 in each pair, a third chooses between them with S1. */
const mux4 = () =>
  schematic(
    'MUX 4:1',
    [
      portIn('D0', -200, -100),
      portIn('D1', -200, -80),
      portIn('D2', -200, 0),
      portIn('D3', -200, 20),
      portIn('S0', -200, 80),
      portIn('S1', -200, 120),
      part('m1', 'mux2', 0, -80, 'M1'),
      part('m2', 'mux2', 0, 20, 'M2'),
      part('m3', 'mux2', 140, -30, 'M3'),
      portOut('Y', 220, -30),
    ],
    [
      wire([-200, -100], [-40, -100]),
      wire([-200, -80], [-40, -80]),
      wire([-200, 0], [-40, 0]),
      wire([-200, 20], [-40, 20]),
      wire([-200, 80], [-120, 80], [-120, -60], [-40, -60]),
      wire([-120, 40], [-40, 40]),
      wire([-200, 120], [80, 120], [80, -10], [100, -10]),
      wire([40, -80], [60, -80], [60, -50], [100, -50]),
      wire([40, 20], [70, 20], [70, -30], [100, -30]),
      wire([180, -30], [220, -30]),
    ],
  );

/** Two MUX 4:1 on D0–D3 and D4–D7, a MUX 2:1 between them with S2. */
const mux8 = () =>
  schematic(
    'MUX 8:1',
    [
      ...[-130, -110, -90, -70, 30, 50, 70, 90].map((y, k) => portIn(`D${k}`, -240, y)),
      portIn('S0', -240, 170),
      portIn('S1', -240, 190),
      portIn('S2', -240, 210),
      part('m1', 'mux4', 0, -80, 'M1'),
      part('m2', 'mux4', 0, 80, 'M2'),
      part('m3', 'mux2', 160, 0, 'M3'),
      portOut('Y', 240, 0),
    ],
    [
      ...[-130, -110, -90, -70, 30, 50, 70, 90].map((y) => wire([-240, y], [-40, y])),
      wire([-240, 190], [-160, 190], [-160, -50], [-40, -50]),
      wire([-160, 110], [-40, 110]),
      wire([-240, 170], [-140, 170], [-140, -30], [-40, -30]),
      wire([-140, 130], [-40, 130]),
      wire([-240, 210], [100, 210], [100, 20], [120, 20]),
      wire([40, -80], [80, -80], [80, -20], [120, -20]),
      wire([40, 80], [90, 80], [90, 0], [120, 0]),
      wire([200, 0], [240, 0]),
    ],
  );

/** D goes to Y0 when S is 0, to Y1 when S is 1: an AND each, one with S and one with its complement. */
const demux2 = () =>
  schematic(
    'DEMUX 1:2',
    [
      portIn('S', -160, -60),
      portIn('D', -160, 10),
      part('u1', 'gate_not', -60, -60, 'U1'),
      part('u2', 'gate_and', 40, 0, 'U2'),
      part('u3', 'gate_and', 40, 70, 'U3'),
      portOut('Y0', 120, 0),
      portOut('Y1', 120, 70),
    ],
    [
      wire([-160, -60], [-100, -60]),
      wire([-130, -60], [-130, 60], [0, 60]),
      wire([-20, -60], [-10, -60], [-10, -10], [0, -10]),
      wire([-160, 10], [0, 10]),
      wire([-110, 10], [-110, 80], [0, 80]),
      wire([80, 0], [120, 0]),
      wire([80, 70], [120, 70]),
    ],
  );

/** A DEMUX 1:2 on S1 sends D to one of two DEMUX 1:2 on S0. */
const demux4 = () =>
  schematic(
    'DEMUX 1:4',
    [
      portIn('D', -120, -10),
      portIn('S1', -120, 10),
      portIn('S0', -120, 120),
      part('t', 'demux2', 0, 0, 'T1'),
      part('l0', 'demux2', 160, -60, 'L0'),
      part('l1', 'demux2', 160, 60, 'L1'),
      ...[-70, -50, 50, 70].map((y, k) => portOut(`Y${k}`, 240, y)),
    ],
    [
      wire([-120, -10], [-40, -10]),
      wire([-120, 10], [-40, 10]),
      wire([40, -10], [80, -10], [80, -70], [120, -70]),
      wire([40, 10], [90, 10], [90, 50], [120, 50]),
      wire([-120, 120], [100, 120], [100, -50], [120, -50]),
      wire([100, 70], [120, 70]),
      ...[-70, -50, 50, 70].map((y) => wire([200, y], [240, y])),
    ],
  );

/** A DEMUX 1:2 on S2 sends D to one of two DEMUX 1:4 on S1 and S0. */
const demux8 = () =>
  schematic(
    'DEMUX 1:8',
    [
      portIn('D', -120, -10),
      portIn('S2', -120, 10),
      portIn('S1', -120, 140),
      portIn('S0', -120, 160),
      part('t', 'demux2', 0, 0, 'T1'),
      part('u', 'demux4', 160, -70, 'U1'),
      part('v', 'demux4', 160, 70, 'U2'),
      ...[-100, -80, -60, -40, 40, 60, 80, 100].map((y, k) => portOut(`Y${k}`, 240, y)),
    ],
    [
      wire([-120, -10], [-40, -10]),
      wire([-120, 10], [-40, 10]),
      wire([40, -10], [70, -10], [70, -90], [120, -90]),
      wire([40, 10], [70, 10], [70, 50], [120, 50]),
      wire([-120, 140], [90, 140], [90, -70], [120, -70]),
      wire([90, 70], [120, 70]),
      wire([-120, 160], [100, 160], [100, -50], [120, -50]),
      wire([100, 90], [120, 90]),
      ...[-100, -80, -60, -40, 40, 60, 80, 100].map((y) => wire([200, y], [240, y])),
    ],
  );

const SCHEMATICS: Record<string, () => Circuit> = { halfadder: halfAdder, fulladder: fullAdder, mux2, mux4, mux8, demux2, demux4, demux8 };

const schematics = new Map<string, Circuit>();

/** The inner schematic of a part made of parts, or null if it is not one. */
export function compositeSchematic(id: string): Circuit | null {
  if (!SCHEMATICS[id]) return null;
  if (!schematics.has(id)) schematics.set(id, SCHEMATICS[id]());
  return schematics.get(id)!;
}

/** The parts of the first level, as the properties list them. */
export const compositeParts = (id: string) => (compositeSchematic(id)?.elements ?? []).filter((el) => getDevice(el.def)?.spice.kind !== 'port');

const ELEMENTARY = new Set<GateKind>(['and', 'or', 'nand', 'nor', 'xor', 'not']);
const networks = new Map<string, LogicNetwork>();

/**
 * The network of elementary gates of a part made of parts, its composites opened all the way down,
 * in an order where each gate comes after those that feed it. Throws if the schematic is not sound:
 * a pin with no flag, an input left open, two outputs on one net, or a loop.
 */
export function logicNetwork(id: string): LogicNetwork {
  const cached = networks.get(id);
  if (cached) return cached;
  const spice = getDevice(id)?.spice;
  if (spice?.kind !== 'logic' || spice.gate !== 'network') throw new Error(`${id}: non è un componente composto`);
  const gates: LogicNetwork['gates'] = [];
  let next = spice.inputs.length + spice.outputs.length;
  const inputs = spice.inputs.map((_, k) => k);
  const outputs = spice.outputs.map((_, j) => spice.inputs.length + j);
  open(id, inputs, outputs, () => next++, gates, [id]);

  // Order: a gate only once every net it reads is known
  const known = new Set(inputs);
  const drivers = new Map<number, number>();
  gates.forEach((gate, g) => {
    if (drivers.has(gate.output) || known.has(gate.output)) throw new Error(`${id}: due uscite sullo stesso collegamento`);
    drivers.set(gate.output, g);
  });
  for (const gate of gates) {
    for (const net of gate.inputs) if (!known.has(net) && !drivers.has(net)) throw new Error(`${id}: un ingresso interno non è collegato`);
  }
  for (const net of outputs) if (!drivers.has(net)) throw new Error(`${id}: un'uscita non è collegata`);
  const ordered: LogicNetwork['gates'] = [];
  const pending = [...gates];
  while (pending.length > 0) {
    const ready = pending.findIndex((gate) => gate.inputs.every((net) => known.has(net)));
    if (ready < 0) throw new Error(`${id}: anello di porte senza memoria`);
    const [gate] = pending.splice(ready, 1);
    ordered.push(gate);
    known.add(gate.output);
  }
  const network = { inputs: spice.inputs.length, gates: ordered, outputs, netCount: next };
  networks.set(id, network);
  return network;
}

/** Adds the gates of one schematic, its pins on the nets given, opening the composites inside it. */
function open(id: string, inputs: number[], outputs: number[], newNet: () => number, gates: LogicNetwork['gates'], path: string[]) {
  const circuit = compositeSchematic(id);
  const spice = getDevice(id)?.spice;
  if (!circuit || spice?.kind !== 'logic') throw new Error(`${id}: schema interno mancante`);
  const { netOf } = computeConnectivity(circuit);
  const netNumber = new Map<string, number>();
  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (s?.kind !== 'port') continue;
    const names = s.direction === 'in' ? spice.inputs : spice.outputs;
    const k = names.indexOf(el.tag);
    if (k < 0) throw new Error(`${id}: la bandierina ${el.tag} non è un piedino`);
    const net = netOf.get(terminalKey(el.id, 'p'))!;
    if (netNumber.has(net)) throw new Error(`${id}: due piedini sullo stesso collegamento`);
    netNumber.set(net, (s.direction === 'in' ? inputs : outputs)[k]);
  }
  const number = (el: Element, terminal: string) => {
    const net = netOf.get(terminalKey(el.id, terminal))!;
    if (!netNumber.has(net)) netNumber.set(net, newNet());
    return netNumber.get(net)!;
  };
  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (s?.kind === 'port') continue;
    if (s?.kind !== 'logic') throw new Error(`${id}: ${el.tag} non è una parte logica`);
    if (ELEMENTARY.has(s.gate)) {
      gates.push({ kind: s.gate, inputs: s.inputs.map((t) => number(el, t)), output: number(el, s.outputs[0]) });
    } else if (s.gate === 'network' && s.network) {
      if (path.includes(s.network)) throw new Error(`${id}: ${s.network} contiene se stesso`);
      open(s.network, s.inputs.map((t) => number(el, t)), s.outputs.map((t) => number(el, t)), newNet, gates, [...path, s.network]);
    } else {
      throw new Error(`${id}: ${el.tag} ha una memoria, che un componente composto non può avere`);
    }
  }
}
