import { describe, expect, it } from 'vitest';
import { Pt } from '../model/types';
import { isPointOnSegment } from '../utils/geometry';
import { anchoredWires, followMove, isShortWire, routeWire, selectionBounds, wireEndingAt, wireFollowers, wireLength } from './wireRouting';

const pt = (x: number, y: number): Pt => ({ x, y });
const isOrthogonal = (pts: Pt[]) => pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);
const touches = (pts: Pt[], p: Pt) => pts.slice(1).some((b, i) => isPointOnSegment(p, pts[i], b, 0.5));

const move = (pts: Pt[], moving: number[], dx: number, dy: number, pins: Pt[] = []) => followMove({ wireId: 'w', pts, moving, pins }, dx, dy);

describe('followMove', () => {
  it('keeps a straight wire straight along its own line', () => {
    expect(move([pt(0, 0), pt(100, 0)], [0], 30, 0)).toEqual([pt(30, 0), pt(100, 0)]);
  });

  it('adds a corner when the tip leaves the line, leaving in the same direction as before', () => {
    expect(move([pt(0, 0), pt(100, 0)], [0], 0, 40)).toEqual([pt(0, 40), pt(100, 40), pt(100, 0)]);
    expect(move([pt(0, 0), pt(0, 100)], [0], 40, 0)).toEqual([pt(40, 0), pt(40, 100), pt(0, 100)]);
  });

  it('works from the other tip too, in the same order', () => {
    expect(move([pt(0, 0), pt(100, 0)], [1], 0, 40)).toEqual([pt(0, 0), pt(0, 40), pt(100, 40)]);
  });

  it('leaves the rest of a longer wire where it is', () => {
    const moved = move([pt(0, 0), pt(100, 0), pt(100, 100)], [0], -20, 30);
    expect(moved).toEqual([pt(-20, 30), pt(100, 30), pt(100, 100)]);
  });

  it('gives right angles in every direction', () => {
    const wires = [
      [pt(0, 0), pt(100, 0)],
      [pt(0, 0), pt(0, 100)],
      [pt(0, 0), pt(100, 0), pt(100, 100), pt(200, 100)],
    ];
    for (const wire of wires) {
      for (const [dx, dy] of [[10, 10], [-10, 10], [10, -10], [-250, 150], [100, 0], [0, 100]]) {
        for (const end of [0, wire.length - 1]) {
          const moved = move(wire, [end], dx, dy);
          expect(isOrthogonal(moved)).toBe(true);
          const tip = end === 0 ? moved[0] : moved[moved.length - 1];
          const other = end === 0 ? moved[moved.length - 1] : moved[0];
          expect(tip).toEqual(pt(wire[end].x + dx, wire[end].y + dy));
          expect(other).toEqual(end === 0 ? wire[wire.length - 1] : wire[0]);
        }
      }
    }
  });

  it('does not lose what is attached along the wire', () => {
    const branch = pt(50, 0);
    for (const [dx, dy] of [[0, 40], [30, 0], [70, 0], [30, 40], [-30, -40]]) {
      const moved = move([pt(0, 0), pt(100, 0)], [0], dx, dy, [branch]);
      expect(touches(moved, branch)).toBe(true);
      expect(moved[0]).toEqual(pt(dx, dy));
      expect(moved[moved.length - 1]).toEqual(pt(100, 0));
      expect(isOrthogonal(moved)).toBe(true);
    }
  });

  it('moves the whole wire when both tips are on the moving part', () => {
    expect(move([pt(0, 0), pt(0, 50), pt(80, 50), pt(80, 0)], [0, 3], 10, 20)).toEqual([pt(10, 20), pt(10, 70), pt(90, 70), pt(90, 20)]);
  });

  it('goes back to the original wire when the part returns', () => {
    const pts = [pt(0, 0), pt(100, 0)];
    expect(move(pts, [0], 0, 0)).toEqual(pts);
  });
});

describe('wireFollowers', () => {
  it('finds the wires on the terminals and what else touches them', () => {
    const wires = [
      { id: 'a', pts: [pt(0, 0), pt(100, 0)] },
      { id: 'b', pts: [pt(50, 0), pt(50, 50)] },
    ];
    const followers = wireFollowers(wires, [pt(0, 0)], [pt(200, 200)]);
    expect(followers.map((f) => f.wireId)).toEqual(['a']);
    expect(followers[0].moving).toEqual([0]);
    expect(followers[0].pins).toContainEqual(pt(50, 0));
    expect(followers[0].pins).toContainEqual(pt(200, 200));
  });
});

describe('anchoredWires', () => {
  const wire = (id: string, a: Pt, b: Pt) => ({ id, pts: [a, b] });

  it('leaves free the wires between what moves', () => {
    expect(anchoredWires([wire('a', pt(0, 0), pt(100, 0))], [pt(0, 0), pt(100, 0)], [pt(500, 500)]).size).toBe(0);
  });

  it('holds a wire ending on something that stays, and what goes on from it', () => {
    const wires = [wire('a', pt(0, 0), pt(100, 0)), wire('b', pt(100, 0), pt(100, 100)), wire('c', pt(300, 0), pt(400, 0))];
    expect([...anchoredWires(wires, [], [pt(0, 0)])].sort()).toEqual(['a', 'b']);
  });

  it('does not pass the hold through a terminal that moves', () => {
    const wires = [wire('a', pt(0, 0), pt(100, 0)), wire('b', pt(100, 0), pt(200, 0))];
    expect([...anchoredWires(wires, [pt(100, 0)], [pt(0, 0)])]).toEqual(['a']);
  });
});

describe('selectionBounds', () => {
  it('surrounds the points with a margin', () => {
    expect(selectionBounds([pt(0, 0), pt(100, 50), pt(20, -10)])).toEqual({ x1: -14, y1: -24, x2: 114, y2: 64 });
  });

  it('has nothing to surround without points', () => {
    expect(selectionBounds([])).toBeNull();
  });
});

describe('short wires', () => {
  const short = { id: 's', pts: [pt(0, 0), pt(10, 0)] };
  const long = { id: 'l', pts: [pt(0, 0), pt(0, 100), pt(50, 100)] };

  it('measures along all the segments', () => {
    expect(wireLength(long.pts)).toBe(150);
  });

  it('calls short what fits between the reach of its two ends', () => {
    expect(isShortWire(short.pts, 20)).toBe(true);
    expect(isShortWire(pt2(40), 20)).toBe(true);
    expect(isShortWire(pt2(50), 20)).toBe(false);
    expect(isShortWire(short.pts, 12)).toBe(true);
    expect(isShortWire(pt2(30), 12)).toBe(false);
  });

  it('finds the wire ending at a point, the shortest of several', () => {
    expect(wireEndingAt([long, short], pt(0, 0))?.id).toBe('s');
    expect(wireEndingAt([long, short], pt(50, 100))?.id).toBe('l');
    expect(wireEndingAt([long, short], pt(0, 50))).toBeUndefined();
  });
});

function pt2(length: number) {
  return [pt(0, 0), pt(length, 0)];
}

describe('routeWire', () => {
  const right = { x: 1, y: 0 };
  const left = { x: -1, y: 0 };
  const up = { x: 0, y: -1 };
  const down = { x: 0, y: 1 };
  const corners = (pts: Pt[]) => pts.length - 2;

  it('goes straight between terminals facing each other', () => {
    expect(routeWire({ pt: pt(40, 0), out: right }, { pt: pt(120, 0), out: left }, [])).toEqual([pt(40, 0), pt(120, 0)]);
  });

  it('turns once between parts side by side, and stays orthogonal', () => {
    const path = routeWire({ pt: pt(40, 0), out: right }, { pt: pt(120, 80), out: up }, []);
    expect(isOrthogonal(path)).toBe(true);
    expect(corners(path)).toBe(1);
    expect(path).toEqual([pt(40, 0), pt(120, 0), pt(120, 80)]);
  });

  it('leaves a terminal outwards, not back over its part', () => {
    // Right terminal of a part at the origin, target behind it on the left and below
    const part = { x1: -40, y1: -10, x2: 40, y2: 10 };
    const path = routeWire({ pt: pt(40, 0), out: right }, { pt: pt(-80, 60), out: up }, [part]);
    expect(path.slice(1).every((p, i) => !(Math.min(p.y, path[i].y) < 8 && Math.max(p.y, path[i].y) > -8 && Math.max(p.x, path[i].x) > -38 && Math.min(p.x, path[i].x) < 38))).toBe(true);
  });

  it('goes round a part in the way', () => {
    const blocker = { x1: 60, y1: -20, x2: 100, y2: 20 };
    const path = routeWire({ pt: pt(40, 0), out: right }, { pt: pt(160, 0), out: left }, [blocker]);
    expect(isOrthogonal(path)).toBe(true);
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const inside = Math.max(a.x, b.x) > 62 && Math.min(a.x, b.x) < 98 && Math.max(a.y, b.y) > -18 && Math.min(a.y, b.y) < 18;
      expect(inside).toBe(false);
    }
  });

  it('leaves along the lead of the terminal when it can', () => {
    // The top terminal of an upright source to the left terminal of a resistor above and to the right
    expect(routeWire({ pt: pt(0, -40), out: up }, { pt: pt(80, -80), out: left }, [])).toEqual([pt(0, -40), pt(0, -80), pt(80, -80)]);
  });

  it('never runs over another terminal, which it would connect', () => {
    const path = routeWire({ pt: pt(240, 40), out: down }, { pt: pt(0, 80), out: null }, [], [pt(0, 40)]);
    for (let i = 1; i < path.length; i++) expect(isPointOnSegment(pt(0, 40), path[i - 1], path[i], 0.5)).toBe(false);
  });

  it('adds no corner where the points are already in line', () => {
    expect(routeWire({ pt: pt(0, 40), out: down }, { pt: pt(0, 120), out: up }, [])).toEqual([pt(0, 40), pt(0, 120)]);
    expect(routeWire({ pt: pt(0, 0), out: null }, { pt: pt(50, 0), out: null }, [])).toEqual([pt(0, 0), pt(50, 0)]);
  });
});
