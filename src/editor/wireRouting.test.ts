import { describe, expect, it } from 'vitest';
import { Pt } from '../model/types';
import { isPointOnSegment } from '../utils/geometry';
import { followMove, wireFollowers } from './wireRouting';

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
