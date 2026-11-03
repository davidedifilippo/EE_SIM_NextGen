import { Pt, Wire } from '../model/types';
import { Box, dist, isPointOnSegment, normalizeBox, snap } from '../utils/geometry';

/** A wire attached to a part being moved, as it was when the drag started. */
export interface WireFollower {
  wireId: string;
  pts: Pt[];
  /** Indices of its points that sit on the moving terminals. */
  moving: number[];
  /** Everything else attached to it: these connections must survive the move. */
  pins: Pt[];
}

const TOLERANCE = 1;
const same = (a: Pt, b: Pt) => dist(a, b) < TOLERANCE;

/** Drops repeated points and the middle of straight runs, but keeps a run that turns back on itself. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length > 0 && same(out[out.length - 1], p)) continue;
    const [a, b] = [out[out.length - 2], out[out.length - 1]];
    const straight =
      a && ((a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) > 0) || (a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) > 0));
    if (straight) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.length >= 2 ? out : [pts[0], pts[pts.length - 1]];
}

/** Path from the moved tip to the rest of the wire, with right angles only. path[0] is the tip before the move. */
function routeTip(path: Pt[], target: Pt, pins: Pt[]): Pt[] {
  const [tip, far, ...beyond] = path;
  const horizontal = Math.abs(tip.y - far.y) < TOLERANCE;
  // What is attached along the first segment holds the wire from the nearest attachment on
  const held = pins.filter((p) => isPointOnSegment(p, tip, far, TOLERANCE) && !same(p, tip) && !same(p, far));
  const nearest = held.sort((a, b) => dist(a, tip) - dist(b, tip))[0];
  const [next, ...rest] = nearest ? [nearest, far, ...beyond] : [far, ...beyond];
  const corner = horizontal ? { x: next.x, y: target.y } : { x: target.x, y: next.y };
  // The corner may fall on the following segment: the stretch before it is then free to go,
  // unless something is attached there
  const after = rest[0];
  const landsOnNext = after && !same(corner, next) && isPointOnSegment(corner, next, after, TOLERANCE);
  const isFree = !pins.some((p) => isPointOnSegment(p, corner, next, TOLERANCE) && !same(p, corner));
  return simplify(landsOnNext && isFree ? [target, corner, ...rest] : [target, corner, next, ...rest]);
}

/** The points of a wire after its part moved by (dx, dy) from where the drag started. */
export function followMove({ pts, moving, pins }: WireFollower, dx: number, dy: number): Pt[] {
  if (dx === 0 && dy === 0) return pts;
  const last = pts.length - 1;
  const shifted = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });

  if (moving.length === 1 && moving[0] === 0) return routeTip(pts, shifted(pts[0]), pins);
  if (moving.length === 1 && moving[0] === last) return routeTip([...pts].reverse(), shifted(pts[last]), pins).reverse();
  // Both tips on the moving part: the whole wire goes with it
  if (moving.includes(0) && moving.includes(last)) return pts.map(shifted);
  return pts.map((p, i) => (moving.includes(i) ? shifted(p) : p));
}

/** Finds the wires attached to the given terminals. otherPoints are the terminals of the other parts. */
export function wireFollowers(wires: Wire[], terminals: Pt[], otherPoints: Pt[]): WireFollower[] {
  const followers: WireFollower[] = [];
  for (const wire of wires) {
    const moving = wire.pts.flatMap((p, i) => (terminals.some((t) => dist(t, p) < 2) ? [i] : []));
    if (moving.length === 0) continue;
    const otherTips = wires.filter((w) => w !== wire).flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
    followers.push({ wireId: wire.id, pts: wire.pts, moving, pins: [...otherPoints, ...otherTips] });
  }
  return followers;
}

/**
 * The selected wires held by something that stays: moved whole, they would come off it. A wire
 * only partly held passes the hold on through its free tip, to the wires it goes on with.
 */
export function anchoredWires(selected: Wire[], movingTerminals: Pt[], staying: Pt[]): Set<string> {
  const isOn = (p: Pt, points: Pt[]) => points.some((q) => dist(p, q) < 2);
  const holds = [...staying];
  const anchored = new Set<string>();
  for (let found = true; found; ) {
    found = false;
    for (const wire of selected) {
      if (anchored.has(wire.id)) continue;
      const tips = [wire.pts[0], wire.pts[wire.pts.length - 1]].filter((tip) => !isOn(tip, movingTerminals));
      if (!tips.some((tip) => isOn(tip, holds))) continue;
      anchored.add(wire.id);
      holds.push(...tips);
      found = true;
    }
  }
  return anchored;
}

/** Margin of the blue area around what is selected, so that it is easy to grab with a finger. */
const SELECTION_MARGIN = 14;

/** The rectangle around selected parts and wires, or null with nothing to surround. */
export function selectionBounds(points: Pt[]): Box | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x1: Math.min(...xs) - SELECTION_MARGIN,
    y1: Math.min(...ys) - SELECTION_MARGIN,
    x2: Math.max(...xs) + SELECTION_MARGIN,
    y2: Math.max(...ys) + SELECTION_MARGIN,
  };
}

export const wireLength = (pts: Pt[]) => pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);

/** So short that a press anywhere on it is also a press near its ends, as always with a finger on a piece of one grid step. */
export const isShortWire = (pts: Pt[], reach: number) => wireLength(pts) <= 2 * reach;

/** The wire ending at a point, the shortest if there are several: the hardest to reach any other way. */
export function wireEndingAt(wires: Wire[], point: Pt): Wire | undefined {
  const ending = wires.filter((w) => dist(w.pts[0], point) < 2 || dist(w.pts[w.pts.length - 1], point) < 2);
  return ending.sort((a, b) => wireLength(a.pts) - wireLength(b.pts))[0];
}

/** One end of a wire to route: where it is, and the way out of the part it belongs to (null on a wire). */
export interface RouteEnd {
  pt: Pt;
  out: Pt | null;
}

/** How far a wire runs out of a terminal before it may turn, when it must not go back over its part. */
const ROUTE_STUB = 20;
const CROSSING_PENALTY = 1000;
const BACKWARD_PENALTY = 400;
const BEND_PENALTY = 15;
/** Leaving a terminal sideways, not along its lead: allowed, but a straight exit looks better. */
const SIDEWAYS_PENALTY = 30;

/** Whether a horizontal or vertical segment passes through the inside of a box, not just along its edge. */
function crossesBox(a: Pt, b: Pt, box: Box): boolean {
  const { minX, minY, maxX, maxY } = normalizeBox(box);
  const inset = 2;
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x2 > minX + inset && x1 < maxX - inset && y2 > minY + inset && y1 < maxY - inset;
}

function cost(pts: Pt[], from: RouteEnd, to: RouteEnd, obstacles: Box[], avoid: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
    total += obstacles.filter((box) => crossesBox(pts[i - 1], pts[i], box)).length * CROSSING_PENALTY;
    // A terminal or a wire end on the way would be connected to it
    total += avoid.filter((p) => isPointOnSegment(p, pts[i - 1], pts[i], TOLERANCE)).length * CROSSING_PENALTY;
  }
  total += (pts.length - 2) * BEND_PENALTY;
  // Leaving a terminal back over its own part reads badly even when it crosses nothing
  const leaves = (end: RouteEnd, next: Pt) => (end.out ? (next.x - end.pt.x) * end.out.x + (next.y - end.pt.y) * end.out.y : 0);
  for (const way of [leaves(from, pts[1]), leaves(to, pts[pts.length - 2])]) {
    if (way < 0) total += BACKWARD_PENALTY;
    else if (way === 0) total += SIDEWAYS_PENALTY;
  }
  return total;
}

/** Room left between a wire going round a part and the part. */
const ROUTE_CLEARANCE = 20;

/**
 * The ways an orthogonal wire can go between two points: straight, with one corner, or with two, the
 * middle run half way or just past the edge of a part, to go round it.
 */
function shapes(a: Pt, b: Pt, obstacles: Box[]): Pt[][] {
  const xs = [snap((a.x + b.x) / 2)];
  const ys = [snap((a.y + b.y) / 2)];
  for (const box of obstacles) {
    const { minX, minY, maxX, maxY } = normalizeBox(box);
    xs.push(snap(minX - ROUTE_CLEARANCE), snap(maxX + ROUTE_CLEARANCE));
    ys.push(snap(minY - ROUTE_CLEARANCE), snap(maxY + ROUTE_CLEARANCE));
  }
  return [
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
    ...xs.map((x) => [a, { x, y: a.y }, { x, y: b.y }, b]),
    ...ys.map((y) => [a, { x: a.x, y }, { x: b.x, y }, b]),
  ];
}

/**
 * An orthogonal path for a wire from one terminal to another, as tidy as a simple rule can make it:
 * touching no other terminal or wire end, clear of the parts, leaving each terminal outwards, then
 * short and with few corners. The user can still drag it afterwards.
 */
export function routeWire(from: RouteEnd, to: RouteEnd, obstacles: Box[], avoid: Pt[] = []): Pt[] {
  const others = avoid.filter((p) => !same(p, from.pt) && !same(p, to.pt));
  const stub = (end: RouteEnd) => (end.out ? { x: end.pt.x + end.out.x * ROUTE_STUB, y: end.pt.y + end.out.y * ROUTE_STUB } : end.pt);
  const candidates = [...shapes(from.pt, to.pt, obstacles), ...shapes(stub(from), stub(to), obstacles).map((path) => [from.pt, ...path, to.pt])].map(simplify);
  let best = candidates[0];
  let bestCost = Infinity;
  for (const path of candidates) {
    const c = cost(path, from, to, obstacles, others);
    if (c < bestCost - 1e-9) [best, bestCost] = [path, c];
  }
  return best;
}
