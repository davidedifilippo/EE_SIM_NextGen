import { describe, expect, it } from 'vitest';
import { parseWaveform, waveformStats } from './waveform';

/** Max, min and RMS measured on the waveform itself, to check the closed forms against. */
function measure(spec: string, period: number) {
  const wave = parseWaveform(spec)!;
  const samples = 200000;
  let max = -Infinity;
  let min = Infinity;
  let squared = 0;
  for (let i = 0; i < samples; i++) {
    const v = wave(((i + 0.5) / samples) * period);
    max = Math.max(max, v);
    min = Math.min(min, v);
    squared += v * v;
  }
  return { max, min, rms: Math.sqrt(squared / samples) };
}

describe('waveformStats', () => {
  it('gives the values of the mains sine', () => {
    const stats = waveformStats('SIN(0 325 50)')!;
    expect(stats.max).toBe(325);
    expect(stats.min).toBe(-325);
    expect(stats.range).toBe(650);
    expect(stats.frequency).toBe(50);
    expect(stats.rms).toBeCloseTo(229.81, 2);
  });

  it('counts the offset in max, min and RMS', () => {
    const stats = waveformStats('SIN(2 3 1k)')!;
    expect(stats.max).toBe(5);
    expect(stats.min).toBe(-1);
    expect(stats.range).toBe(6);
    expect(stats.frequency).toBe(1000);
    expect(stats.rms).toBeCloseTo(measure('SIN(2 3 1k)', 1e-3).rms, 3);
  });

  it('accepts a negative amplitude', () => {
    expect(waveformStats('SIN(0 -5 50)')).toMatchObject({ max: 5, min: -5 });
  });

  it.each([
    ['square wave', 'PULSE(0 5 0 0 0 1m 2m)', 2e-3],
    ['bipolar with ramps', 'PULSE(-5 5 0 100u 200u 300u 1m)', 1e-3],
    ['flat top longer than the period', 'PULSE(0 5 0 100u 100u 5m 1m)', 1e-3],
    ['ramp longer than the period', 'PULSE(0 10 0 2m 0 1m 1m)', 1e-3],
  ])('matches the waveform for a pulse: %s', (_, spec, period) => {
    const stats = waveformStats(spec)!;
    const measured = measure(spec, period);
    expect(stats.frequency).toBeCloseTo(1 / period, 6);
    expect(stats.max).toBeCloseTo(measured.max, 2);
    expect(stats.min).toBeCloseTo(measured.min, 2);
    expect(stats.rms).toBeCloseTo(measured.rms, 2);
  });

  it.each(['5', 'DC 5', 'SIN(0 5 50 0 10)', 'SIN(0 5 0)', 'PULSE(0 5)', 'SIN(0 x 50)', ''])('has nothing to show for "%s"', (spec) => {
    expect(waveformStats(spec)).toBeNull();
  });
});
