import { describe, expect, it } from 'vitest';
import { laneY } from './ScopePanel';

describe('lanes of the oscilloscope', () => {
  it('uses the whole height without lanes', () => {
    expect(laneY(0, 0, 5, 10, 100, null, 0)).toBe(110);
    expect(laneY(5, 0, 5, 10, 100, null, 0)).toBe(10);
  });

  it('keeps each trace in its own lane, top first, with lanes that never touch', () => {
    const top = (lane: number) => laneY(5, 0, 5, 0, 120, lane, 4);
    const bottom = (lane: number) => laneY(0, 0, 5, 0, 120, lane, 4);
    for (let lane = 0; lane < 4; lane++) {
      expect(top(lane)).toBeGreaterThan(lane * 30);
      expect(bottom(lane)).toBeLessThan((lane + 1) * 30);
      expect(bottom(lane) - top(lane)).toBeGreaterThan(15);
    }
  });
});
