import { Pt, Wire } from '../model/types';
import { dist, isPointOnSegment } from '../utils/geometry';

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
