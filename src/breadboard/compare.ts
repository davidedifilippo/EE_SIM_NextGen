import { Circuit, Element, Pt } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { holeAt, pointKey } from './board';
import { footprintOf, pinPoints } from './footprints';

class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(k, root);
    return root;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

/** A pin of a mounted part where it is, with the terminal of the schematic it stands for. */
export interface MountedPin {
  elementId: string;
  terminal: string;
  label: string;
  at: Pt;
}

export const isMounted = (el: Element) => el.bb !== undefined && footprintOf(el) !== null;

/** Every pin of every mounted part. */
export function mountedPins(circuit: Circuit): MountedPin[] {
  return circuit.elements.filter(isMounted).flatMap((el) => pinPoints(el).map((p) => ({ elementId: el.id, ...p })));
}

/**
 * The nodes of the breadboard: the holes of a strip or of a rail are one, the two ends of a jumper are one,
 * the pins of a part that stand for the same terminal are one inside it, and things at the same point touch.
 * Gives the node of each pin, by its place in the list.
 */
export function breadboardNodes(circuit: Circuit, pins: MountedPin[]): string[] {
  const uf = new UnionFind();
  const at = (p: Pt) => {
    const hole = holeAt(p);
    return hole ? `strip:${hole.strip}` : `point:${pointKey(p)}`;
  };
  for (const w of circuit.breadboard?.wires ?? []) uf.union(at(w.a), at(w.b));
  const byTerminal = new Map<string, string>();
  for (const p of pins) {
    const key = terminalKey(p.elementId, p.terminal);
    const node = at(p.at);
    if (byTerminal.has(key)) uf.union(byTerminal.get(key)!, node);
    else byTerminal.set(key, node);
  }
  return pins.map((p) => uf.find(at(p.at)));
}

/** Two groups of pins that the schematic joins and the breadboard does not: the nearest two, for a dashed line. */
export interface Missing {
  from: Pt;
  to: Pt;
  /** A pin of each side, as R1.b. */
  names: [string, string];
}

/** A node of the breadboard that joins nodes the schematic keeps apart. */
export interface Short {
  at: Pt[];
  /** One pin of each node of the schematic it joins. */
  names: string[];
}

export interface Comparison {
  missing: Missing[];
  shorts: Short[];
  /** Parts with a body on the breadboard not mounted yet. */
  unmounted: string[];
  isComplete: boolean;
}

/** The breadboard against the schematic, on the pins of the parts mounted. */
export function compareWithSchematic(circuit: Circuit): Comparison {
  const tagOf = new Map(circuit.elements.map((el) => [el.id, el.tag]));
  const name = (p: MountedPin) => `${tagOf.get(p.elementId)}.${p.label}`;
  const pins = mountedPins(circuit);
  const nodes = breadboardNodes(circuit, pins);
  const { netOf } = computeConnectivity(circuit);
  const nets = pins.map((p) => netOf.get(terminalKey(p.elementId, p.terminal)) ?? `alone:${p.elementId}:${p.terminal}`);

  const missing: Missing[] = [];
  const byNet = new Map<string, number[]>();
  nets.forEach((net, k) => byNet.set(net, [...(byNet.get(net) ?? []), k]));
  for (const members of byNet.values()) {
    // The pieces the breadboard has of one node of the schematic, joined one after the other by the nearest pins
    const pieces = new Map<string, number[]>();
    for (const k of members) pieces.set(nodes[k], [...(pieces.get(nodes[k]) ?? []), k]);
    const groups = [...pieces.values()];
    const joined = [groups[0]];
    const rest = groups.slice(1);
    while (rest.length > 0) {
      let best = { d: Infinity, i: 0, j: 0, r: 0 };
      rest.forEach((group, r) => {
        for (const i of joined.flat()) {
          for (const j of group) {
            const d = Math.hypot(pins[i].at.x - pins[j].at.x, pins[i].at.y - pins[j].at.y);
            if (d < best.d) best = { d, i, j, r };
          }
        }
      });
      missing.push({ from: pins[best.i].at, to: pins[best.j].at, names: [name(pins[best.i]), name(pins[best.j])] });
      joined.push(rest.splice(best.r, 1)[0]);
    }
  }

  const shorts: Short[] = [];
  const byNode = new Map<string, number[]>();
  nodes.forEach((node, k) => byNode.set(node, [...(byNode.get(node) ?? []), k]));
  for (const members of byNode.values()) {
    const firstOfNet = new Map<string, number>();
    for (const k of members) if (!firstOfNet.has(nets[k])) firstOfNet.set(nets[k], k);
    if (firstOfNet.size > 1) shorts.push({ at: members.map((k) => pins[k].at), names: [...firstOfNet.values()].map((k) => name(pins[k])) });
  }

  const unmounted = circuit.elements.filter((el) => !el.bb && footprintOf(el) !== null).map((el) => el.id);
  return { missing, shorts, unmounted, isComplete: missing.length === 0 && shorts.length === 0 && unmounted.length === 0 };
}

/** In a line, for the top of the view. */
export function comparisonSummary(c: Comparison): string {
  if (c.isComplete) return 'Tutto collegato come nello schema';
  const parts = [
    c.unmounted.length > 0 ? `${c.unmounted.length} ${c.unmounted.length === 1 ? 'componente da montare' : 'componenti da montare'}` : '',
    c.missing.length > 0 ? `${c.missing.length} ${c.missing.length === 1 ? 'collegamento mancante' : 'collegamenti mancanti'}` : '',
    c.shorts.length > 0 ? `${c.shorts.length} ${c.shorts.length === 1 ? 'collegamento in più' : 'collegamenti in più'}` : '',
  ].filter(Boolean);
  return parts.join(', ');
}
