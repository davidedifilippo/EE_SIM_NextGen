import { getDevice } from '../library/devices';
import { Circuit, Element } from '../model/types';
import { computeConnectivity } from '../netlist/connectivity';
import { ScopeProbe } from '../realtime/liveSimulation';

export const MAX_TRACES = 4;

export type ScopeUnit = 'V' | 'A';

/** A probe with its color. The slot stays with the trace, so that removing another does not repaint it. */
export type ScopeTrace = ScopeProbe & { slot: number };

export interface ProbeChoice {
  label: string;
  probe: ScopeProbe;
}

export const unitOf = (probe: ScopeProbe): ScopeUnit => (probe.kind === 'current' || probe.kind === 'ib' ? 'A' : 'V');

/** What can be measured on a part. */
export function elementProbes(el: Element): ProbeChoice[] {
  const spice = getDevice(el.def)?.spice;
  if (!spice || spice.kind === 'ground') return [];
  const choice = (label: string, kind: Exclude<ScopeProbe['kind'], 'node'>): ProbeChoice => ({
    label,
    probe: { id: `${kind}:${el.id}`, kind, elementId: el.id },
  });
  return spice.kind === 'bjt'
    ? [choice('Vce', 'voltage'), choice('Vbe', 'vbe'), choice('Ic', 'current'), choice('Ib', 'ib')]
    : [choice('Tensione', 'voltage'), choice('Corrente', 'current')];
}

/** All the wires of a node are the same node: they lead to one probe, on the first of them. */
export function nodeWire(wireId: string, circuit: Circuit): string {
  const { wireNet } = computeConnectivity(circuit);
  return circuit.wires.find((w) => wireNet.get(w.id) === wireNet.get(wireId))?.id ?? wireId;
}

export const wireProbe = (wireId: string): ProbeChoice => ({
  label: 'Tensione del nodo',
  probe: { id: `node:${wireId}`, kind: 'node', wireId },
});

/** The first free color. */
export function nextSlot(traces: ScopeTrace[]): number {
  const used = new Set(traces.map((t) => t.slot));
  let slot = 1;
  while (used.has(slot)) slot++;
  return slot;
}

/** Traces whose part or wire is still in the circuit. The same array if none went away. */
export function liveTraces(traces: ScopeTrace[], circuit: Circuit): ScopeTrace[] {
  const kept = traces.filter((t) => (t.kind === 'node' ? circuit.wires.some((w) => w.id === t.wireId) : circuit.elements.some((el) => el.id === t.elementId)));
  return kept.length === traces.length ? traces : kept;
}

/** The name of a trace, in the terms of the drawing. */
export function traceLabel(probe: ScopeProbe, circuit: Circuit): string {
  if (probe.kind !== 'node') {
    const tag = circuit.elements.find((el) => el.id === probe.elementId)?.tag ?? '?';
    const isBjt = getDevice(circuit.elements.find((el) => el.id === probe.elementId)?.def ?? '')?.spice.kind === 'bjt';
    const names = { voltage: isBjt ? 'Vce' : 'V', current: isBjt ? 'Ic' : 'I', vbe: 'Vbe', ib: 'Ib' };
    return `${names[probe.kind]}(${tag})`;
  }
  const { netOf, wireNet } = computeConnectivity(circuit);
  const net = wireNet.get(probe.wireId);
  for (const el of circuit.elements) {
    const def = getDevice(el.def);
    const terminal = def?.terminals.find((t) => netOf.get(`${el.id}:${t.id}`) === net);
    if (!terminal) continue;
    if (def?.spice.kind === 'ground') return 'V(massa)';
    return `V(${el.tag}.${terminal.id})`;
  }
  return 'V(nodo)';
}
