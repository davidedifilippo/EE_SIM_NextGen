import { describe, expect, it } from 'vitest';
import { ScopeBuffer } from './scopeBuffer';

const filled = (wave: (t: number) => number, seconds: number, rate = 10000, capacity = 32768) => {
  const buffer = new ScopeBuffer(capacity);
  buffer.reset(1);
  const n = Math.round(seconds * rate);
  const time = Float64Array.from({ length: n }, (_, i) => i / rate);
  buffer.append(time, [time.map(wave)]);
  return buffer;
};

const sine = (t: number) => 10 * Math.sin(2 * Math.PI * 50 * t);

describe('ring', () => {
  it('keeps the latest samples when it wraps around', () => {
    const buffer = new ScopeBuffer(4);
    buffer.reset(1);
    buffer.append(Float64Array.of(1, 2, 3, 4, 5, 6), [Float64Array.of(10, 20, 30, 40, 50, 60)]);
    expect(buffer.size).toBe(4);
    expect(buffer.latestTime).toBe(6);
    expect(buffer.sampleAt(0, 3)).toBe(30);
    expect(buffer.sampleAt(0, 1)).toBe(30);
    expect(buffer.sampleAt(0, 6)).toBe(60);
  });

  it('adds up across several appends', () => {
    const buffer = new ScopeBuffer(8);
    buffer.reset(2);
    buffer.append(Float64Array.of(1), [Float64Array.of(1), Float64Array.of(-1)]);
    buffer.append(Float64Array.of(2), [Float64Array.of(2), Float64Array.of(-2)]);
    expect(buffer.sampleAt(1, 2)).toBe(-2);
    expect(buffer.size).toBe(2);
  });

  it('starts over when the clock goes back', () => {
    const buffer = new ScopeBuffer(8);
    buffer.reset(1);
    buffer.append(Float64Array.of(5, 6), [Float64Array.of(1, 2)]);
    buffer.append(Float64Array.of(0, 1), [Float64Array.of(3, 4)]);
    expect(buffer.size).toBe(2);
    expect(buffer.latestTime).toBe(1);
  });

  it('ignores samples for another set of traces', () => {
    const buffer = new ScopeBuffer(8);
    buffer.reset(1);
    buffer.append(Float64Array.of(1), [Float64Array.of(1), Float64Array.of(2)]);
    expect(buffer.size).toBe(0);
  });

  it('is empty after a reset, and answers without failing', () => {
    const buffer = new ScopeBuffer(8);
    buffer.reset(1);
    expect(buffer.latestTime).toBeNull();
    expect(buffer.sampleAt(0, 1)).toBeNull();
    expect(buffer.stats(0, 0, 1)).toBeNull();
    expect(buffer.triggerStart(0, 1)).toBeNull();
    expect([...buffer.columns(0, 0, 1, 2)].every(Number.isNaN)).toBe(true);
  });
});

describe('stats', () => {
  it('measures a sine exactly over whole periods, whatever the window', () => {
    for (const t0 of [0.2, 0.2031, 0.2077]) {
      const s = filled(sine, 1).stats(0, t0, t0 + 0.0733)!;
      expect(s.max).toBeCloseTo(10, 1);
      expect(s.min).toBeCloseTo(-10, 1);
      expect(s.frequency).toBeCloseTo(50, 2);
      expect(s.rms).toBeCloseTo(7.071, 2);
      expect(s.mean).toBeCloseTo(0, 1);
    }
  });

  it('counts the offset', () => {
    const s = filled((t) => 2 + sine(t), 1).stats(0, 0.2, 0.3)!;
    expect(s.mean).toBeCloseTo(2, 1);
    expect(s.rms).toBeCloseTo(Math.sqrt(4 + 50), 1);
  });

  it('finds the frequency of a square wave with its duty cycle', () => {
    const square = (t: number) => ((t * 100) % 1 < 0.25 ? 5 : -5);
    const s = filled(square, 1).stats(0, 0.2, 0.3)!;
    expect(s.frequency).toBeCloseTo(100, 1);
    expect(s.mean).toBeCloseTo(-2.5, 1);
  });

  it('gives no frequency without two edges, and uses the whole window', () => {
    const s = filled(() => 5, 1).stats(0, 0.2, 0.3)!;
    expect(s.frequency).toBeNull();
    expect(s).toMatchObject({ max: 5, min: 5, mean: 5, rms: 5 });
    expect(filled(sine, 1).stats(0, 0.2, 0.21)!.frequency).toBeNull();
  });
});

describe('trigger', () => {
  it('starts each sweep on a rising edge, leaving it complete', () => {
    const buffer = filled(sine, 1);
    const start = buffer.triggerStart(0, 0.04)!;
    expect(start).toBeLessThanOrEqual(buffer.latestTime! - 0.04);
    expect(((start * 50) % 1 + 1) % 1).toBeLessThan(0.01);
  });

  it('stands still: new samples move the sweep by whole periods', () => {
    const phase = (seconds: number) => {
      const buffer = filled(sine, seconds);
      return Math.round((((buffer.triggerStart(0, 0.04)! * 50) % 1) + 1) % 1 * 100) % 100;
    };
    expect(new Set([0.5, 0.5037, 0.5111, 0.5189].map(phase)).size).toBe(1);
  });

  it('has nothing to do on a flat signal', () => {
    expect(filled(() => 5, 1).triggerStart(0, 0.04)).toBeNull();
    expect(filled(() => 5 + 1e-12 * Math.random(), 1).triggerStart(0, 0.04)).toBeNull();
  });

  it('waits until a whole sweep is available', () => {
    expect(filled(sine, 0.03).triggerStart(0, 0.04)).toBeNull();
  });
});

describe('columns', () => {
  it('keeps the peaks that fall inside a column', () => {
    const buffer = filled((t) => (Math.abs(t - 0.5) < 1e-5 ? 100 : 0), 1);
    const out = buffer.columns(0, 0, 1, 10);
    expect(out[5 * 2 + 1]).toBe(100);
    expect(out[4 * 2 + 1]).toBe(0);
  });

  it('leaves columns without samples empty', () => {
    const out = filled(sine, 0.5).columns(0, 0, 1, 4);
    expect(Number.isNaN(out[3 * 2])).toBe(true);
    expect(Number.isNaN(out[0])).toBe(false);
  });
});
