import { Circuit, Pt } from '../model/types';
import { getDevice } from '../library/devices';
import { isPointOnSegment, localToWorld, ptKey } from '../utils/geometry';

export const terminalKey = (elementId: string, terminalId: string) => `${elementId}:${terminalId}`;

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

export interface Connectivity {
  /** Net representative for each terminal key. */
  netOf: Map<string, string>;
  /** Terminal keys that touch no wire and no other terminal. */
  unconnected: string[];
  /** Net representative for each wire id. */
  wireNet: Map<string, string>;
}

/**
 * Groups terminals into nets. Points join when they coincide, or when a wire endpoint or a
 * terminal lies on a wire segment. Two wires that merely cross stay separate.
 */
export function computeConnectivity(circuit: Circuit): Connectivity {
  const uf = new UnionFind();
  const terminals: { key: string; pt: Pt }[] = [];

  for (const el of circuit.elements) {
    for (const t of getDevice(el.def)?.terminals ?? []) {
      terminals.push({ key: terminalKey(el.id, t.id), pt: localToWorld(el.x, el.y, t, el.rot, el.flip) });
    }
  }

  const touched = new Set<string>();

  for (const w of circuit.wires) {
    const wireNet = `wire:${w.id}`;
    uf.find(wireNet);

    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [a, b] = [w.pts[i], w.pts[i + 1]];

      for (const t of terminals) {
        if (isPointOnSegment(t.pt, a, b)) {
          uf.union(t.key, wireNet);
          touched.add(t.key);
        }
      }

      for (const other of circuit.wires) {
        if (other === w) continue;
        for (const end of [other.pts[0], other.pts[other.pts.length - 1]]) {
          if (isPointOnSegment(end, a, b)) uf.union(`wire:${other.id}`, wireNet);
        }
      }
    }
  }

  const terminalsAt = new Map<string, string[]>();
  for (const t of terminals) {
    const k = ptKey(t.pt);
    terminalsAt.set(k, [...(terminalsAt.get(k) ?? []), t.key]);
  }
  for (const group of terminalsAt.values()) {
    if (group.length < 2) continue;
    for (const key of group) {
      uf.union(key, group[0]);
      touched.add(key);
    }
  }

  // A pin of a block and its flag inside: one node, with no wire between them
  for (const [a, b] of circuit.ties ?? []) {
    uf.union(a, b);
    touched.add(a);
    touched.add(b);
  }

  const netOf = new Map(terminals.map((t) => [t.key, uf.find(t.key)]));
  const unconnected = terminals.filter((t) => !touched.has(t.key)).map((t) => t.key);
  const wireNet = new Map(circuit.wires.map((w) => [w.id, uf.find(`wire:${w.id}`)]));
  return { netOf, unconnected, wireNet };
}
