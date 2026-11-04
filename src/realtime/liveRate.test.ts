import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../samples/examples';
import { automaticSpeed, DEFAULT_SPEED, fastestPeriod, GOOD_SAMPLES_PER_PERIOD, samplesPerPeriod } from './liveRate';

describe('automatic speed', () => {
  it('keeps the usual speed for circuits in continuous voltage or at mains frequency', () => {
    expect(automaticSpeed(null)).toBe(DEFAULT_SPEED);
    expect(automaticSpeed(1 / 50)).toBe(DEFAULT_SPEED);
    // Slow signals: no more than one period a second, up to real time
    expect(automaticSpeed(1 / 10)).toBe(100e-3);
    expect(automaticSpeed(1)).toBe(1);
    expect(automaticSpeed(1 / 1000)).toBe(DEFAULT_SPEED);
  });

  it('slows down for fast signals, so that each period has enough points', () => {
    expect(automaticSpeed(1 / 50e3)).toBe(1e-3);
    expect(samplesPerPeriod(1 / 50e3, automaticSpeed(1 / 50e3))).toBeGreaterThanOrEqual(GOOD_SAMPLES_PER_PERIOD);
    expect(automaticSpeed(1 / 500e3)).toBe(100e-6);
    expect(samplesPerPeriod(1 / 500e3, automaticSpeed(1 / 500e3))).toBeGreaterThanOrEqual(GOOD_SAMPLES_PER_PERIOD);
    expect(automaticSpeed(1 / 5e6)).toBe(10e-6);
  });

  it('takes the fastest generator of a circuit', () => {
    const circuit = EXAMPLES.find((e) => e.id === 'lowpass')!.build();
    expect(fastestPeriod(circuit)).toBeCloseTo(1e-3, 9);
    expect(fastestPeriod(EXAMPLES.find((e) => e.id === 'divider')!.build())).toBeNull();
  });
});
