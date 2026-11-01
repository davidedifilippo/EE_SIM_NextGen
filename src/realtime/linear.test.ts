import { describe, expect, it } from 'vitest';
import { luFactor, luSolve } from './linear';

function solve(rows: number[][], b: number[]): number[] {
  const n = rows.length;
  const a = Float64Array.from(rows.flat());
  const pivots = new Int32Array(n);
  expect(luFactor(a, n, pivots)).toBe(true);
  const x = Float64Array.from(b);
  luSolve(a, n, pivots, x);
  return [...x];
}

describe('LU solver', () => {
  it('solves a system that needs several pivots', () => {
    const rows = [
      [0, 0, 1, 2],
      [0, 3, 1, 0],
      [4, 1, 0, 1],
      [1, 0, 5, 0],
    ];
    const expected = [1, -2, 3, 0.5];
    const b = rows.map((r) => r.reduce((sum, v, i) => sum + v * expected[i], 0));
    solve(rows, b).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  it('solves random systems, checked by multiplying back', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let trial = 0; trial < 50; trial++) {
      const n = 2 + (trial % 12);
      const rows = Array.from({ length: n }, () => Array.from({ length: n }, () => (rand() > 0.5 ? 0 : rand())));
      rows.forEach((r, i) => (r[(i + trial) % n] += 3));
      const b = Array.from({ length: n }, rand);
      const x = solve(rows, b);
      rows.forEach((r, i) => {
        expect(r.reduce((sum, v, c) => sum + v * x[c], 0)).toBeCloseTo(b[i], 8);
      });
    }
  });

  it('detects a singular matrix', () => {
    const a = Float64Array.from([1, 2, 2, 4]);
    expect(luFactor(a, 2, new Int32Array(2))).toBe(false);
  });
});
