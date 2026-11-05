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

/** A pin as the drawing names it: the complement of Q with its bar. */
const pinName = (terminal: string) => (terminal === 'nQ' ? 'Q̄' : terminal);

export const unitOf = (probe: ScopeProbe): ScopeUnit => (probe.kind === 'current' || probe.kind === 'ib' ? 'A' : 'V');

/** What can be measured on a part. */
export function elementProbes(el: Element): ProbeChoice[] {
  const spice = getDevice(el.def)?.spice;
  if (!spice || spice.kind === 'ground' || spice.kind === 'block') return [];
  // A logic part with several outputs: each output on its own, as on a logic analyser
  if (spice.kind === 'logic' && spice.outputs.length > 1) {
    return spice.outputs.map((terminal) => ({
      label: `Uscita ${pinName(terminal)}`,
      probe: { id: `pin:${el.id}:${terminal}`, kind: 'pin', elementId: el.id, terminal },
    }));
  }
  const choice = (label: string, kind: 'voltage' | 'current' | 'vbe' | 'ib'): ProbeChoice => ({
    label,
    probe: { id: `${kind}:${el.id}`, kind, elementId: el.id },
  });
  if (spice.kind === 'regulator' && spice.sensor) return [choice('Vout', 'vbe'), choice('Iout', 'ib')];
  if (spice.kind === 'regulator') return [choice('Vin−Vout', 'voltage'), choice('Vout', 'vbe'), choice('Iin', 'current'), choice('Iout', 'ib')];
  if (spice.kind === 'transformer') return [choice('V1', 'voltage'), choice('I1', 'current'), choice('V2', 'vbe'), choice('I2', 'ib')];
  if (spice.kind === 'mos') return [choice('Vds', 'voltage'), choice('Vgs', 'vbe'), choice('Id', 'current')];
  if (spice.kind === 'relay') return [choice('V bobina', 'voltage'), choice('I bobina', 'current'), choice('V contatto', 'vbe'), choice('I contatto', 'ib')];
  if (spice.kind === 'pot') {
    return [choice('Tensione', 'voltage'), choice('Corrente', 'current'), { label: 'Cursore', probe: { id: `pin:${el.id}:${spice.wiper}`, kind: 'pin', elementId: el.id, terminal: spice.wiper } }];
  }
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
  if (probe.kind === 'pin') {
    const tag = circuit.elements.find((el) => el.id === probe.elementId)?.tag ?? '?';
    return `V(${tag}.${pinName(probe.terminal)})`;
  }
  if (probe.kind !== 'node') {
    const tag = circuit.elements.find((el) => el.id === probe.elementId)?.tag ?? '?';
    const kind = getDevice(circuit.elements.find((el) => el.id === probe.elementId)?.def ?? '')?.spice.kind;
    const names =
      kind === 'regulator'
        ? { voltage: 'Vin−Vout', current: 'Iin', vbe: 'Vout', ib: 'Iout' }
        : kind === 'transformer'
        ? { voltage: 'V1', current: 'I1', vbe: 'V2', ib: 'I2' }
        : kind === 'relay'
        ? { voltage: 'Vbob', current: 'Ibob', vbe: 'Vcont', ib: 'Icont' }
        : kind === 'mos'
        ? { voltage: 'Vds', current: 'Id', vbe: 'Vgs', ib: 'Ig' }
        : { voltage: kind === 'bjt' ? 'Vce' : 'V', current: kind === 'bjt' ? 'Ic' : 'I', vbe: 'Vbe', ib: 'Ib' };
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
