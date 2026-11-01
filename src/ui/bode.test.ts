import { describe, expect, it } from 'vitest';
import { bodeCurve, bodeSummary, decadeTicks, hasSignal, phaseTicks } from './bode';

const logSweep = (from: number, to: number, perDecade: number) => {
  const n = Math.round(Math.log10(to / from) * perDecade);
  return Array.from({ length: n + 1 }, (_, i) => from * 10 ** (i / perDecade));
};

describe('bodeCurve', () => {
  it('converts to dB and degrees', () => {
    const { gain, phase } = bodeCurve([1, 0, 10], [0, 1, 0]);
    expect(gain).toEqual([0, 0, 20]);
    expect(phase[1]).toBeCloseTo(90, 9);
  });

  it('removes the jump of a phase going past -180 degrees', () => {
    const degrees = [-100, -170, -190, -260, -350, -370];
    const re = degrees.map((d) => Math.cos((d * Math.PI) / 180));
    const im = degrees.map((d) => Math.sin((d * Math.PI) / 180));
    const { phase } = bodeCurve(re, im);
    phase.forEach((p, i) => expect(p).toBeCloseTo(degrees[i], 6));
  });

  it('survives a node without signal', () => {
    expect(bodeCurve([0], [0]).gain[0]).toBeCloseTo(-240, 6);
    expect(hasSignal([0, 0], [0, 0])).toBe(false);
    expect(hasSignal([0, 1e-3], [0, 0])).toBe(true);
  });
});

describe('bodeSummary', () => {
  it('finds the upper cutoff of a low pass', () => {
    const f = logSweep(1, 1e6, 20);
    const fc = 1591.5;
    const gain = f.map((x) => -10 * Math.log10(1 + (x / fc) ** 2));
    const s = bodeSummary(f, gain);
    expect(s.upper).toBeCloseTo(fc, -1);
    expect(s.lower).toBeNull();
    expect(s.peak).toBeCloseTo(0, 3);
  });

  it('finds the lower cutoff of a high pass', () => {
    const f = logSweep(1, 1e6, 20);
    const gain = f.map((x) => 20 - 10 * Math.log10(1 + (100 / x) ** 2));
    const s = bodeSummary(f, gain);
    expect(s.lower).toBeCloseTo(100, 0);
    expect(s.upper).toBeNull();
    expect(s.peak).toBeCloseTo(20, 3);
  });

  it('finds both sides of a resonance, and its peak', () => {
    const f = logSweep(100, 1e5, 200);
    const [f0, q] = [5000, 5];
    const gain = f.map((x) => -10 * Math.log10(1 + q * q * (x / f0 - f0 / x) ** 2));
    const s = bodeSummary(f, gain);
    expect(s.peakFrequency).toBeCloseTo(f0, -2);
    expect(s.upper! - s.lower!).toBeCloseTo(f0 / q, -1);
  });

  it('has no cutoff on a flat curve', () => {
    const s = bodeSummary([1, 10, 100], [6, 6, 6]);
    expect(s).toMatchObject({ lower: null, upper: null, peak: 6 });
  });
});

describe('ticks', () => {
  it('marks the powers of ten inside the sweep', () => {
    expect(decadeTicks(10, 1e5)).toEqual([10, 100, 1000, 10000, 100000]);
    expect(decadeTicks(3, 500)).toEqual([10, 100]);
  });

  it('marks the phase in round angles', () => {
    expect(phaseTicks(-90, 0)).toEqual([-90, -45, 0]);
    expect(phaseTicks(-180, 90)).toEqual([-180, -90, 0, 90]);
    expect(phaseTicks(-500, 0)).toEqual([-540, -360, -180, 0]);
    expect(phaseTicks(0, 0).length).toBeGreaterThan(1);
  });
});
