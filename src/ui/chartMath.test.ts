import { describe, expect, it } from 'vitest';
import { downsampleMinMax, formatFixed, formatSi, nearestIndex, niceTicks, pickTimeUnit } from './chartMath';

describe('niceTicks', () => {
  it('covers the range with round values', () => {
    expect(niceTicks(-0.01, 9.31, 6)).toEqual([-2, 0, 2, 4, 6, 8, 10]);
  });

  it('avoids floating point drift', () => {
    expect(niceTicks(0, 0.1, 6)).toEqual([0, 0.02, 0.04, 0.06, 0.08, 0.1]);
  });

  it('handles a constant signal', () => {
    const ticks = niceTicks(5, 5, 6);
    expect(ticks[0]).toBeLessThan(5);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(5);
  });
});

describe('nearestIndex', () => {
  it('finds the closest sample', () => {
    expect(nearestIndex([0, 1, 2, 10], 8)).toBe(3);
    expect(nearestIndex([0, 1, 2, 10], 1.2)).toBe(1);
    expect(nearestIndex([0, 1, 2, 10], -5)).toBe(0);
  });
});

describe('downsampleMinMax', () => {
  it('keeps every point when there are few', () => {
    expect(downsampleMinMax([0, 1, 2], [5, 6, 7], 100)).toEqual([0, 1, 2]);
  });

  it('keeps a one-sample peak', () => {
    const n = 10_000;
    const time = Array.from({ length: n }, (_, i) => i);
    const values = time.map((i) => (i === 4321 ? 100 : 0));
    const idx = downsampleMinMax(time, values, 200);
    expect(idx.length).toBeLessThanOrEqual(400);
    expect(idx).toContain(4321);
  });

  it('returns indices in time order and reaches the last sample', () => {
    const time = Array.from({ length: 5000 }, (_, i) => i);
    const values = time.map((i) => Math.sin(i / 50));
    const idx = downsampleMinMax(time, values, 100);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx[idx.length - 1]).toBeGreaterThan(4900);
  });
});

describe('formatting', () => {
  it('uses the Italian decimal comma', () => {
    expect(formatSi(2.5)).toBe('2,5');
  });

  it('never shows a negative zero', () => {
    expect(formatFixed(-0.0001, 3)).toBe('0,000');
    expect(formatFixed(-9.853, 3)).toBe('-9,853');
  });

  it('picks the time unit from the duration', () => {
    expect(pickTimeUnit(0.1).symbol).toBe('ms');
    expect(pickTimeUnit(2).symbol).toBe('s');
    expect(pickTimeUnit(5e-6).symbol).toBe('µs');
  });
});
