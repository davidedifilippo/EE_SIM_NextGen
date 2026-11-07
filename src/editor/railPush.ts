import { getDevice } from '../library/devices';
import { Circuit, Element, Pt, Wire } from '../model/types';
import { dist, isPointOnSegment, localToWorld } from '../utils/geometry';

/**
 * Pushing a rail. A part joined to a wire by a short straight lead, moved along that lead past its
 * length, would carry its other leads across the wire and short them on it. Instead, once the part
 * reaches the wire, it pushes it: the wire, and what runs on along the same line, moves with the part;
 * the wires that reach it from the side grow, a part with one terminal on it (a ground) goes with it,
 * and from the terminal of any other part on it a new wire grows to keep it joined.
 */
export interface RailPush {
  /** The short lead from the moving part to the wire. */
  leadId: string;
  /** From the terminal to the wire, along x or y. */
  dir: Pt;
  length: number;
  /** For each wire on the rail, the indices of its points that move with it. */
  railPoints: Map<string, number[]>;
  /** Tips of other wires on the rail: they grow with it. */
  tips: { wireId: string; index: number }[];
  /** Parts with a single terminal on the rail, as a ground: they go with it. */
  carried: string[];
  /** Terminals of other parts on the rail: a wire grows from each to where the rail goes. */
  anchors: Pt[];
}

const TOLERANCE = 1;
const same = (a: Pt, b: Pt) => dist(a, b) < TOLERANCE;
const terminalsOf = (el: Element) => (getDevice(el.def)?.terminals ?? []).map((t) => localToWorld(el.x, el.y, t, el.rot, el.flip));

/** The rails each lead of a part could push, found where the drag starts. followerIds are the wires that already follow the part. */
export function planRailPushes(circuit: Circuit, elementId: string, followerIds: Set<string>): RailPush[] {
  const moving = circuit.elements.find((el) => el.id === elementId);
  if (!moving) return [];
  const pushes: RailPush[] = [];
  for (const terminal of terminalsOf(moving)) {
    const leads = circuit.wires.filter((w) => same(w.pts[0], terminal) || same(w.pts[w.pts.length - 1], terminal));
    if (leads.length !== 1 || leads[0].pts.length !== 2) continue;
    const lead = leads[0];
    const junction = same(lead.pts[0], terminal) ? lead.pts[1] : lead.pts[0];
    const length = dist(terminal, junction);
    const isVertical = Math.abs(junction.x - terminal.x) < TOLERANCE;
    const isHorizontal = Math.abs(junction.y - terminal.y) < TOLERANCE;
    if (length < TOLERANCE || isVertical === isHorizontal) continue;
    const dir = { x: (junction.x - terminal.x) / length, y: (junction.y - terminal.y) / length };
    const rail = railThrough(circuit.wires, junction, isVertical, lead.id);
    if (rail.size === 0 || [...rail.keys()].some((id) => followerIds.has(id))) continue;
    const segments = [...rail].flatMap(([id, indices]) => {
      const pts = circuit.wires.find((w) => w.id === id)!.pts;
      return indices.map((i) => [pts[i], pts[i + 1]] as const);
    });
    const onRail = (p: Pt) => segments.some(([a, b]) => isPointOnSegment(p, a, b, TOLERANCE));
    const railPoints = new Map([...rail].map(([id, indices]) => [id, [...new Set(indices.flatMap((i) => [i, i + 1]))]]));
    const tips = circuit.wires.flatMap((w) => {
      if (w.id === lead.id || followerIds.has(w.id)) return [];
      return [0, w.pts.length - 1].filter((index) => onRail(w.pts[index]) && !railPoints.get(w.id)?.includes(index)).map((index) => ({ wireId: w.id, index }));
    });
    const carried: string[] = [];
    const anchors: Pt[] = [];
    for (const el of circuit.elements) {
      if (el.id === elementId) continue;
      const onIt = terminalsOf(el).filter(onRail);
      if (onIt.length === 0) continue;
      if (terminalsOf(el).length === 1) carried.push(el.id);
      else anchors.push(...onIt);
    }
    pushes.push({ leadId: lead.id, dir, length, railPoints, tips, carried, anchors });
  }
  return pushes;
}

/**
 * The segments on the line across the lead at its far end, that touch that end or touch each other in
 * a chain from it: the rail, as wire id and index of the first point of each segment.
 */
function railThrough(wires: Wire[], junction: Pt, leadIsVertical: boolean, leadId: string): Map<string, number[]> {
  const isOnLine = (a: Pt, b: Pt) => (leadIsVertical ? Math.abs(a.y - junction.y) < TOLERANCE && Math.abs(b.y - junction.y) < TOLERANCE : Math.abs(a.x - junction.x) < TOLERANCE && Math.abs(b.x - junction.x) < TOLERANCE);
  const candidates = wires.flatMap((w) => (w.id === leadId ? [] : w.pts.slice(1).flatMap((b, k) => (isOnLine(w.pts[k], b) && !same(w.pts[k], b) ? [{ id: w.id, index: k, a: w.pts[k], b }] : []))));
  const taken = new Set<number>();
  const reach = [junction];
  for (let grew = true; grew; ) {
    grew = false;
    candidates.forEach((s, k) => {
      if (taken.has(k) || !reach.some((p) => isPointOnSegment(p, s.a, s.b, TOLERANCE))) return;
      taken.add(k);
      reach.push(s.a, s.b);
      grew = true;
    });
    // A segment that holds an end of a taken one joins too: a rail made of wires that overlap
    candidates.forEach((s, k) => {
      if (taken.has(k)) return;
      if ([...taken].some((t) => isPointOnSegment(s.a, candidates[t].a, candidates[t].b, TOLERANCE) || isPointOnSegment(s.b, candidates[t].a, candidates[t].b, TOLERANCE))) {
        taken.add(k);
        reach.push(s.a, s.b);
        grew = true;
      }
    });
  }
  const rail = new Map<string, number[]>();
  for (const k of taken) rail.set(candidates[k].id, [...(rail.get(candidates[k].id) ?? []), candidates[k].index]);
  return rail;
}

/** How far each rail is pushed by a move of the part: what the move goes beyond the length of its lead, along it. */
export const pushAmount = (push: RailPush, move: Pt) => Math.max(0, move.x * push.dir.x + move.y * push.dir.y - push.length);

/**
 * The wires and parts once the part moved by `move`, from what they were at the start of the drag: the
 * rails that are pushed, the leads that are gone, the wires that grow. Wires that follow the part are
 * left to the caller.
 */
export function applyRailPushes(origWires: Wire[], origElements: Element[], pushes: RailPush[], move: Pt): { wires: Wire[]; elements: Element[]; pushedLeads: Set<string> } {
  const active = pushes.map((push) => ({ push, amount: pushAmount(push, move) })).filter(({ amount }) => amount > 0);
  if (active.length === 0) return { wires: origWires, elements: origElements, pushedLeads: new Set() };
  const shiftOf = new Map<string, Map<number, Pt>>();
  const addShift = (wireId: string, index: number, by: Pt) => {
    const shifts = shiftOf.get(wireId) ?? new Map<number, Pt>();
    if (!shifts.has(index)) shifts.set(index, by);
    shiftOf.set(wireId, shifts);
  };
  const grown: Wire[] = [];
  const carriedBy = new Map<string, Pt>();
  for (const { push, amount } of active) {
    const by = { x: push.dir.x * amount, y: push.dir.y * amount };
    push.railPoints.forEach((indices, wireId) => indices.forEach((i) => addShift(wireId, i, by)));
    push.tips.forEach(({ wireId, index }) => addShift(wireId, index, by));
    push.carried.forEach((id) => carriedBy.set(id, by));
    push.anchors.forEach((p, k) => grown.push({ id: `${push.leadId}_grown${k}`, pts: [p, { x: p.x + by.x, y: p.y + by.y }] }));
  }
  const pushedLeads = new Set(active.map(({ push }) => push.leadId));
  const wires = origWires
    .filter((w) => !pushedLeads.has(w.id))
    .map((w) => {
      const shifts = shiftOf.get(w.id);
      return shifts ? { ...w, pts: w.pts.map((p, i) => (shifts.has(i) ? { x: p.x + shifts.get(i)!.x, y: p.y + shifts.get(i)!.y } : p)) } : w;
    });
  const elements = origElements.map((el) => (carriedBy.has(el.id) ? { ...el, x: el.x + carriedBy.get(el.id)!.x, y: el.y + carriedBy.get(el.id)!.y } : el));
  return { wires: [...wires, ...grown], elements, pushedLeads };
}
