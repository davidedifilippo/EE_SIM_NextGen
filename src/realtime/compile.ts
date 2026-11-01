import { Circuit, ModelType } from '../model/types';
import { getDevice } from '../library/devices';
import { findModel, modelType } from '../library/models';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { sourceSpec } from '../netlist/source';
import { parseSpiceValue } from '../netlist/values';
import { parseWaveform, Waveform } from './waveform';

/** Thermal voltage at 27 °C, the temperature SPICE assumes. */
const THERMAL_VOLTAGE = 0.025865;

/** Unknown index of a node, or -1 for ground. */
export type NodeIndex = number;

export interface DiodeParams {
  is: number;
  /** Emission coefficient times thermal voltage. */
  nvt: number;
  rs: number;
  /** Reverse breakdown, if the model has one. */
  breakdown: { voltage: number; nvt: number } | null;
}

/** DC part of the Gummel-Poon model. Voltages n*Vt are ready for the exponentials; o-prefixed values are inverses, 0 for "not given". */
export interface BjtParams {
  polarity: 1 | -1;
  is: number;
  bf: number;
  br: number;
  vt: number;
  nfVt: number;
  nrVt: number;
  ise: number;
  neVt: number;
  isc: number;
  ncVt: number;
  ovaf: number;
  ovar: number;
  oikf: number;
  oikr: number;
  rb: number;
  rc: number;
  re: number;
}

export type CompiledDevice =
  | { kind: 'resistor'; element: number; a: NodeIndex; b: NodeIndex; g: number }
  | { kind: 'capacitor'; element: number; a: NodeIndex; b: NodeIndex; c: number }
  | { kind: 'inductor'; element: number; a: NodeIndex; b: NodeIndex; l: number; branch: number }
  | { kind: 'vsource'; element: number; a: NodeIndex; b: NodeIndex; wave: Waveform; branch: number }
  /** a is the external anode, junction the node after the series resistance (a itself if rs is 0). */
  | { kind: 'diode'; element: number; a: NodeIndex; junction: NodeIndex; b: NodeIndex; params: DiodeParams }
  /** a is the collector and b the emitter; the primed nodes come after the series resistances. */
  | { kind: 'bjt'; element: number; a: NodeIndex; b: NodeIndex; base: NodeIndex; cp: NodeIndex; bp: NodeIndex; ep: NodeIndex; params: BjtParams };

export interface CompiledCircuit {
  /** Node voltages followed by branch currents. */
  size: number;
  devices: CompiledDevice[];
  /** Node index of each net; ground nets map to -1. */
  netIndex: Map<string, NodeIndex>;
  /** Element ids, in device order. */
  elementIds: string[];
  /** Same value means state can carry over: only component values changed. */
  signature: string;
}

export type CompileResult = { ok: true; compiled: CompiledCircuit } | { ok: false; errors: string[] };

const cardParam = (card: string, name: string): number | null => {
  const match = new RegExp(`[\\s(]${name}\\s*=\\s*([^\\s)]+)`, 'i').exec(card);
  return match && parseSpiceValue(match[1]);
};

/** A model can say 0 where the equations divide: such a value counts as not given. */
const positive = (value: number | null, fallback: number) => (value !== null && value > 0 ? value : fallback);

/**
 * The internal breakdown voltage that gives IBV at BV, solved as ngspice does: the diode's own
 * current at that point is part of the total.
 */
function breakdownVoltage(bv: number, ibv: number, is: number, nvt: number): number {
  const vt = THERMAL_VOLTAGE;
  if (ibv < (is * bv) / vt) return bv;
  let x = bv - nvt * Math.log(1 + ibv / is);
  for (let i = 0; i < 25; i++) {
    x = bv - nvt * Math.log(ibv / is + 1 - x / vt);
    if (Math.abs(is * (Math.exp((bv - x) / nvt) - 1 + x / vt) - ibv) <= 1e-3 * ibv) break;
  }
  return x;
}

/**
 * Reads the DC parameters of a .model card. Junction capacitance and transit time are left out
 * on purpose: the animation needs speed, and ngspice covers the precise analysis.
 */
export function parseDiodeModel(card: string): DiodeParams {
  const param = (name: string, fallback: number) => cardParam(card, name) ?? fallback;
  const is = positive(cardParam(card, 'IS'), 1e-14);
  const n = positive(cardParam(card, 'N'), 1);
  const bv = cardParam(card, 'BV');
  const breakdownNvt = param('NBV', n) * THERMAL_VOLTAGE;
  return {
    is,
    nvt: n * THERMAL_VOLTAGE,
    rs: param('RS', 0),
    breakdown: bv !== null && bv > 0 ? { voltage: breakdownVoltage(bv, param('IBV', 1e-3), is, breakdownNvt), nvt: breakdownNvt } : null,
  };
}

/** Same selection as parseDiodeModel. RB is taken as constant, without RBM and IRB. */
export function parseBjtModel(card: string, polarity: 1 | -1): BjtParams {
  const param = (name: string, fallback: number) => cardParam(card, name) ?? fallback;
  const inverse = (...names: string[]) => {
    const value = names.map((name) => cardParam(card, name)).find((v) => v !== null);
    return value ? 1 / value : 0;
  };
  const vt = THERMAL_VOLTAGE;
  return {
    polarity,
    is: positive(cardParam(card, 'IS'), 1e-16),
    bf: positive(cardParam(card, 'BF'), 100),
    br: positive(cardParam(card, 'BR'), 1),
    vt,
    nfVt: positive(cardParam(card, 'NF'), 1) * vt,
    nrVt: positive(cardParam(card, 'NR'), 1) * vt,
    ise: param('ISE', 0),
    neVt: param('NE', 1.5) * vt,
    isc: param('ISC', 0),
    ncVt: param('NC', 2) * vt,
    ovaf: inverse('VAF', 'VA'),
    ovar: inverse('VAR', 'VB'),
    oikf: inverse('IKF', 'IK'),
    oikr: inverse('IKR'),
    rb: param('RB', 0),
    rc: param('RC', 0),
    re: param('RE', 0),
  };
}

/** Builds the solver's view of the circuit. Unconnected terminals are fine: a drawing in progress must not stop it. */
export function compileCircuit(circuit: Circuit): CompileResult {
  const errors: string[] = [];
  const { netOf } = computeConnectivity(circuit);

  const groundNets = new Set<string>();
  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (s?.kind === 'ground') groundNets.add(netOf.get(terminalKey(el.id, s.terminal))!);
  }
  if (groundNets.size === 0) return { ok: false, errors: ['Il circuito non ha una massa'] };

  const netIndex = new Map<string, NodeIndex>();
  groundNets.forEach((net) => netIndex.set(net, -1));
  let nodeCount = 0;
  const nodeOfNet = (net: string) => {
    if (!netIndex.has(net)) netIndex.set(net, nodeCount++);
    return netIndex.get(net)!;
  };

  type Pending = { element: number; build: (branch: number, nextNode: () => number) => CompiledDevice; needsBranch: boolean };
  const pending: Pending[] = [];
  const elementIds: string[] = [];

  const modelCard = (tag: string, name: string, type: ModelType) => {
    const model = findModel(circuit, name);
    if (!model) errors.push(`${tag}: modello non definito "${name}"`);
    else if (modelType(model.card) !== type) errors.push(`${tag}: il modello "${name}" non è di tipo ${type}`);
    else return model.card;
    return null;
  };

  for (const el of circuit.elements) {
    const s = getDevice(el.def)?.spice;
    if (!s || s.kind === 'ground') continue;
    const node = (terminal: string) => nodeOfNet(netOf.get(terminalKey(el.id, terminal))!);
    const element = elementIds.length;
    elementIds.push(el.id);

    switch (s.kind) {
      case 'passive': {
        const value = parseSpiceValue(String(el.props[s.valueProp] ?? ''));
        if (value === null || value <= 0) {
          errors.push(`${el.tag}: valore non valido "${el.props[s.valueProp] ?? ''}"`);
          break;
        }
        const [a, b] = [node(s.a), node(s.b)];
        if (s.prefix === 'R') pending.push({ element, needsBranch: false, build: () => ({ kind: 'resistor', element, a, b, g: 1 / value }) });
        else if (s.prefix === 'C') pending.push({ element, needsBranch: false, build: () => ({ kind: 'capacitor', element, a, b, c: value }) });
        else pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'inductor', element, a, b, l: value, branch }) });
        break;
      }
      case 'vsource': {
        const spec = sourceSpec(el.props);
        const wave = spec && parseWaveform(spec);
        if (!wave) {
          errors.push(`${el.tag}: sorgente non valida${spec ? ` "${spec}"` : ''}`);
          break;
        }
        const [a, b] = [node(s.pos), node(s.neg)];
        pending.push({ element, needsBranch: true, build: (branch) => ({ kind: 'vsource', element, a, b, wave, branch }) });
        break;
      }
      case 'diode': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), 'D');
        if (!card) break;
        const params = parseDiodeModel(card);
        const [a, b] = [node(s.anode), node(s.cathode)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({ kind: 'diode', element, a, b, params, junction: params.rs > 0 ? nextNode() : a }),
        });
        break;
      }
      case 'bjt': {
        const card = modelCard(el.tag, String(el.props[s.modelProp] ?? ''), s.modelType);
        if (!card) break;
        const params = parseBjtModel(card, s.modelType === 'NPN' ? 1 : -1);
        const [a, base, b] = [node(s.collector), node(s.base), node(s.emitter)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({
            kind: 'bjt',
            element,
            a,
            b,
            base,
            params,
            cp: params.rc > 0 ? nextNode() : a,
            bp: params.rb > 0 ? nextNode() : base,
            ep: params.re > 0 ? nextNode() : b,
          }),
        });
        break;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Terminals of unsupported nets still need an index, so nodes are final only after every element
  for (const net of netOf.values()) nodeOfNet(net);

  // Unknowns: external nodes, then internal diode nodes, then branch currents
  let next = nodeCount;
  const shells = pending.map((p) => p.build(-1, () => next++));
  const nodesTotal = next;
  let branch = nodesTotal;
  const devices = pending.map((p, i) => {
    const shell = shells[i];
    return p.needsBranch ? { ...shell, branch: branch++ } : shell;
  }) as CompiledDevice[];

  const signature = JSON.stringify([
    branch,
    devices.map((d) => [d.kind, elementIds[d.element], d.a, d.b, d.kind === 'diode' ? d.junction : 0, d.kind === 'bjt' ? [d.base, d.cp, d.bp, d.ep] : 0]),
  ]);
  return { ok: true, compiled: { size: branch, devices, netIndex, elementIds, signature } };
}
