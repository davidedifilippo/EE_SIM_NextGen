import { BlockDef, Circuit, Element, Pt, Wire } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { isPointOnSegment, localToWorld, ptKey, snapPt } from '../utils/geometry';
import { blockProblem, createBlock } from './blocks';
import { getDevice, nextTag } from './devices';
import { findModel, usedModelNames } from './models';

/** A node that joins the selection to the rest: it becomes a pin. at is where the two sides touch. */
export interface ProposedPin {
  name: string;
  side: 'left' | 'right';
  at: Pt;
}

interface Boundary {
  pins: ProposedPin[];
  /** Ground nodes the selection is on without a ground of its own: the block gets one inside. */
  groundsToAdd: Pt[];
  /** The middle of the selection, where the block goes. */
  center: Pt;
}

const terminalPoints = (circuit: Circuit, elements: Element[]) =>
  elements.flatMap((el) => (getDevice(el.def)?.terminals ?? []).map((t) => ({ key: terminalKey(el.id, t.id), elementId: el.id, pt: localToWorld(el.x, el.y, t, el.rot, el.flip) })));

const ends = (w: Wire) => [w.pts[0], w.pts[w.pts.length - 1]];
const onWire = (p: Pt, w: Wire) => w.pts.some((a, i) => i + 1 < w.pts.length && isPointOnSegment(p, a, w.pts[i + 1]));

/**
 * Where the selection meets the rest of the circuit: one pin for each node on both sides, at a point where
 * they touch, except ground, which is common to all. Null if the selection holds no part.
 */
export function selectionBoundary(circuit: Circuit, selectedIds: Set<string>): Boundary | null {
  const inside = circuit.elements.filter((el) => selectedIds.has(el.id));
  if (inside.length === 0) return null;
  const outside = circuit.elements.filter((el) => !selectedIds.has(el.id));
  const [inWires, outWires] = [circuit.wires.filter((w) => selectedIds.has(w.id)), circuit.wires.filter((w) => !selectedIds.has(w.id))];
  const { netOf, wireNet } = computeConnectivity(circuit);
  const [inTerminals, outTerminals] = [terminalPoints(circuit, inside), terminalPoints(circuit, outside)];

  // The nodes of the selection alone: two of its parts may meet only through a wire left outside
  const alone = computeConnectivity({ ...circuit, elements: inside, wires: inWires });
  const innerNetAt = (p: Pt) => {
    const terminal = inTerminals.find((t) => ptKey(t.pt) === ptKey(p));
    if (terminal) return alone.netOf.get(terminal.key)!;
    const w = inWires.find((wire) => onWire(p, wire));
    return w ? alone.wireNet.get(w.id)! : '';
  };

  // The points where something inside touches something outside, each with its node, and its node inside
  const contacts: { net: string; inner: string; at: Pt }[] = [];
  const touches = (p: Pt, terminals: { pt: Pt }[], wires: Wire[]) => terminals.some((t) => ptKey(t.pt) === ptKey(p)) || wires.some((w) => onWire(p, w));
  const add = (net: string, at: Pt) => contacts.push({ net, inner: innerNetAt(at), at });
  for (const t of inTerminals) if (touches(t.pt, outTerminals, outWires)) add(netOf.get(t.key)!, t.pt);
  for (const w of inWires) for (const p of ends(w)) if (touches(p, outTerminals, outWires)) add(wireNet.get(w.id)!, p);
  for (const w of outWires) for (const p of ends(w)) if (touches(p, inTerminals, inWires)) add(wireNet.get(w.id)!, p);

  const groundNets = new Set(circuit.elements.flatMap((el) => (getDevice(el.def)?.spice.kind === 'ground' ? [netOf.get(terminalKey(el.id, 'g'))!] : [])));
  const groundInside = new Set(inside.flatMap((el) => (getDevice(el.def)?.spice.kind === 'ground' ? [netOf.get(terminalKey(el.id, 'g'))!] : [])));

  const xs = inTerminals.map((t) => t.pt.x);
  const ys = inTerminals.map((t) => t.pt.y);
  const center = snapPt({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });

  const seen = new Set<string>();
  const pins: Omit<ProposedPin, 'name'>[] = [];
  const groundsToAdd: Pt[] = [];
  for (const { net, inner, at } of contacts) {
    // One pin for each piece of the selection on the node: pieces joined only outside get one each
    if (seen.has(`${net}|${inner}`)) continue;
    seen.add(`${net}|${inner}`);
    if (groundNets.has(net)) {
      // Every piece on ground needs a ground inside, unless one of its own is already there
      if (!groundInside.has(net) || !inside.some((el) => getDevice(el.def)?.spice.kind === 'ground' && alone.netOf.get(terminalKey(el.id, 'g')) === inner)) groundsToAdd.push(at);
      continue;
    }
    pins.push({ side: at.x < center.x ? 'left' : 'right', at });
  }
  pins.sort((a, b) => (a.side === b.side ? a.at.y - b.at.y : a.side === 'left' ? -1 : 1));
  return { pins: pins.map((p, k) => ({ ...p, name: `P${k + 1}` })), groundsToAdd, center };
}

/** The inner circuit of the block: the selection, a flag at each pin, a ground where the selection needs one. */
function innerCircuit(circuit: Circuit, selectedIds: Set<string>, name: string, pins: ProposedPin[], groundsToAdd: Pt[]): Circuit {
  const elements: Element[] = [
    ...circuit.elements.filter((el) => selectedIds.has(el.id)),
    ...pins.map((pin, k): Element => ({ id: `pin_${k + 1}`, def: pin.side === 'left' ? 'port_in' : 'port_out', x: pin.at.x, y: pin.at.y, rot: 0, tag: pin.name, props: {} })),
    ...groundsToAdd.map((at, k): Element => ({ id: `ground_${k + 1}`, def: 'ground', x: at.x, y: at.y, rot: 0, tag: '', props: {} })),
  ];
  const inner: Circuit = { title: name, elements, wires: circuit.wires.filter((w) => selectedIds.has(w.id)), models: [] };
  // The models it uses go with it, so that it works in any circuit
  const models = usedModelNames(inner).flatMap((model) => {
    const found = findModel(circuit, model);
    return found && circuit.models.includes(found) ? [found] : [];
  });
  return { ...inner, models };
}

/** The same nodes among the parts left outside, and each pin on the node it stands for. */
function keepsConnections(before: Circuit, after: Circuit, selectedIds: Set<string>, blockId: string, pins: ProposedPin[], pinNets: string[]): boolean {
  const outside = before.elements.filter((el) => !selectedIds.has(el.id));
  const keys = terminalPoints(before, outside).map((t) => t.key);
  const [old, now] = [computeConnectivity(before).netOf, computeConnectivity(after).netOf];
  const label = (net: Map<string, string>, key: string) => net.get(key)!;
  // Two outside terminals share a node after exactly when they did before
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if ((label(old, keys[i]) === label(old, keys[j])) !== (label(now, keys[i]) === label(now, keys[j]))) return false;
    }
  }
  // Each pin on its node, and two pins on one node only if they stood for the same one
  const pinNow = pins.map((pin) => now.get(terminalKey(blockId, pin.name))!);
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) if ((pinNow[i] === pinNow[j]) !== (pinNets[i] === pinNets[j])) return false;
  }
  return pins.every((_, k) => keys.every((key) => (label(old, key) === pinNets[k]) === (label(now, key) === pinNow[k])));
}

/**
 * Replaces the selection with a block: the block where the selection was, a wire from each pin to the point
 * where its node met the rest. The wires try a few routes and places, and the first that keeps every
 * connection as it was is taken. Otherwise, what went wrong.
 */
export function replaceWithBlock(circuit: Circuit, selectedIds: Set<string>, name: string, pins: ProposedPin[], stamp: number): { circuit: Circuit; blocks: BlockDef[] } | { error: string } {
  const boundary = selectionBoundary(circuit, selectedIds);
  if (!boundary) return { error: 'Seleziona almeno un componente' };
  if (!name.trim()) return { error: 'Dai un nome al blocco' };
  const inner = innerCircuit(circuit, selectedIds, name.trim(), pins, boundary.groundsToAdd);
  const problem = boundary.pins.length > 0 ? blockProblem(inner) : 'La selezione non è collegata al resto del circuito: un blocco ha bisogno di almeno un piedino';
  if (problem) return { error: problem };
  const blocks = createBlock(name.trim(), inner);
  const [block] = blocks;
  const def = getDevice(block.id)!;
  const { netOf, wireNet } = computeConnectivity(circuit);
  // The node each pin stands for, from what touches at its point
  const pinNets = pins.map((pin) => {
    const terminal = terminalPoints(circuit, circuit.elements).find((t) => ptKey(t.pt) === ptKey(pin.at));
    if (terminal) return netOf.get(terminal.key)!;
    const w = circuit.wires.find((wire) => onWire(pin.at, wire));
    return w ? wireNet.get(w.id)! : '';
  });
  const kept: Circuit = {
    ...circuit,
    elements: circuit.elements.filter((el) => !selectedIds.has(el.id)),
    wires: circuit.wires.filter((w) => !selectedIds.has(w.id)),
  };
  const tag = nextTag('X', kept.elements);
  const id = `elem_${stamp}_block`;
  for (const dy of [0, 40, -40, 80, -80, 120, -120]) {
    const at = { x: boundary.center.x, y: boundary.center.y + dy };
    const element: Element = { id, def: block.id, x: at.x, y: at.y, rot: 0, tag, props: {} };
    for (const style of ['lanes', 'corner'] as const) {
      const wires = pins.map((pin, k): Wire => {
        const t = def.terminals.find((terminal) => terminal.id === pin.name)!;
        const from = localToWorld(at.x, at.y, t, 0);
        const lane = from.x + Math.sign(t.x) * 20 * (k + 1);
        const pts = style === 'corner' ? [from, { x: pin.at.x, y: from.y }, pin.at] : [from, { x: lane, y: from.y }, { x: lane, y: pin.at.y }, pin.at];
        return { id: `wire_${stamp}_pin${k + 1}`, pts: pts.filter((p, i) => i === 0 || ptKey(p) !== ptKey(pts[i - 1])) };
      }).filter((w) => w.pts.length >= 2);
      const next: Circuit = { ...kept, elements: [...kept.elements, element], wires: [...kept.wires, ...wires], blocks: [...(circuit.blocks ?? []), ...blocks] };
      if (keepsConnections(circuit, next, selectedIds, id, pins, pinNets)) return { circuit: next, blocks };
    }
  }
  return { error: 'Non trovo un posto per il blocco che lasci i collegamenti come prima: sposta un po\' i componenti intorno e riprova' };
}
