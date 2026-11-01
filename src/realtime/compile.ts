import { Circuit } from '../model/types';
import { getDevice } from '../library/devices';
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
}

export type CompiledDevice =
  | { kind: 'resistor'; element: number; a: NodeIndex; b: NodeIndex; g: number }
  | { kind: 'capacitor'; element: number; a: NodeIndex; b: NodeIndex; c: number }
  | { kind: 'inductor'; element: number; a: NodeIndex; b: NodeIndex; l: number; branch: number }
  | { kind: 'vsource'; element: number; a: NodeIndex; b: NodeIndex; wave: Waveform; branch: number }
  /** a is the external anode, junction the node after the series resistance (a itself if rs is 0). */
  | { kind: 'diode'; element: number; a: NodeIndex; junction: NodeIndex; b: NodeIndex; params: DiodeParams };

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

/**
 * Reads the DC parameters of a .model card. Junction capacitance, transit time and breakdown
 * are left out on purpose: the animation needs speed, and ngspice covers the precise analysis.
 */
export function parseDiodeModel(card: string): DiodeParams {
  const param = (name: string, fallback: number) => {
    const match = new RegExp(`[\\s(]${name}\\s*=\\s*([^\\s)]+)`, 'i').exec(card);
    return (match && parseSpiceValue(match[1])) ?? fallback;
  };
  return { is: param('IS', 1e-14), nvt: param('N', 1) * THERMAL_VOLTAGE, rs: param('RS', 0) };
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
        const model = circuit.models.find((m) => m.name === el.props[s.modelProp]);
        if (!model) {
          errors.push(`${el.tag}: modello non definito "${el.props[s.modelProp] ?? ''}"`);
          break;
        }
        const params = parseDiodeModel(model.card);
        const [a, b] = [node(s.anode), node(s.cathode)];
        pending.push({
          element,
          needsBranch: false,
          build: (_, nextNode) => ({ kind: 'diode', element, a, b, params, junction: params.rs > 0 ? nextNode() : a }),
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
    devices.map((d) => [d.kind, elementIds[d.element], d.a, d.b, d.kind === 'diode' ? d.junction : 0]),
  ]);
  return { ok: true, compiled: { size: branch, devices, netIndex, elementIds, signature } };
}
