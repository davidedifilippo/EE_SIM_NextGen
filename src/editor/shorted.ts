import { getDevice } from '../library/devices';
import { Circuit } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';

/**
 * The parts with two terminals that a wire joins to each other, as when a part is laid on a wire already drawn:
 * no current goes through them, and a fuse or a resistor there does nothing.
 */
export function shortedParts(circuit: Circuit): string[] {
  const { netOf } = computeConnectivity(circuit);
  return circuit.elements.flatMap((el) => {
    const def = getDevice(el.def);
    if (!def || def.terminals.length !== 2) return [];
    const kind = def.spice.kind;
    if (kind === 'ground' || kind === 'port') return [];
    const [a, b] = def.terminals.map((t) => netOf.get(terminalKey(el.id, t.id)));
    return a !== undefined && a === b ? [el.id] : [];
  });
}
