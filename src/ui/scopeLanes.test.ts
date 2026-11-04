import { describe, expect, it } from 'vitest';
import { laneY, slowestChannel, triggeredStart } from './ScopePanel';
import { ScopeBuffer } from './scopeBuffer';

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

describe('holding the last sweep', () => {
  // One rising edge at 2 s, then nothing: a slow signal, or a buffer shorter than two windows
  const buffer = new ScopeBuffer(1 << 16);
  buffer.reset(1);
  const rate = 100;
  const add = (from: number, to: number) => {
    const time = Float64Array.from({ length: Math.round((to - from) * rate) }, (_, i) => from + i / rate);
    buffer.append(time, [time.map((t) => (t >= 2 ? 5 : 0))]);
  };

  it('starts on the edge once a whole sweep follows it, and keeps it while the buffer holds it', () => {
    add(0, 13);
    const start = triggeredStart(buffer, 10, null);
    expect(start).toBeCloseTo(2, 1);
    add(13, 25);
    // The edge is now more than two windows back: no new one, the old sweep stays
    expect(buffer.triggerStart(0, 10)).toBeNull();
    expect(triggeredStart(buffer, 10, start)).toBe(start);
  });

  it('runs free with nothing to hold', () => {
    expect(triggeredStart(buffer, 10, null)).toBeNull();
  });
});

describe('trigger in the middle, on a chosen trace', () => {
  it('puts the edge of the chosen trace half a window after the start', () => {
    const buffer = new ScopeBuffer(1 << 16);
    buffer.reset(2);
    const rate = 100;
    const time = Float64Array.from({ length: 30 * rate }, (_, i) => i / rate);
    // A fast square on the first trace, one with a period of 10 s on the second, rising at 8, 18 and 28 s
    const fast = time.map((t) => (t % 2 >= 1 ? 5 : 0));
    const slow = time.map((t) => ((t + 7) % 10 >= 5 ? 5 : 0));
    buffer.append(time, [fast, slow]);
    const start = triggeredStart(buffer, 10, null, 1, 5)!;
    // The latest edge with half a window on each side: 18 s, the sweep from 13 to 23 s; at 28 s the window would run past the end
    expect(start + 5).toBeCloseTo(18, 1);
  });
});

describe('automatic trigger source', () => {
  const rate = 100;
  const time = Float64Array.from({ length: 30 * rate }, (_, i) => i / rate);
  const square = (period: number) => time.map((t) => (t % period >= period / 2 ? 5 : 0));

  it('follows the slowest trace, as the most significant bit of a counter', () => {
    const buffer = new ScopeBuffer(1 << 16);
    buffer.reset(4);
    buffer.append(time, [square(2), square(4), square(10), square(8)]);
    expect(slowestChannel(buffer, 4)).toBe(2);
  });

  it('passes over a flat trace, and does not count noise near the middle twice', () => {
    const buffer = new ScopeBuffer(1 << 16);
    buffer.reset(3);
    const noisy = time.map((t, i) => 2.5 + 2.5 * Math.sin((2 * Math.PI * t) / 5) + (i % 2 ? 0.05 : -0.05));
    buffer.append(time, [time.map(() => 5), noisy, square(2)]);
    // Up through the middle at 5, 10, 15, 20 and 25 s: the start, already rising, is not an edge
    expect(buffer.risingEdges(1)).toBe(5);
    expect(slowestChannel(buffer, 3)).toBe(1);
  });

  it('keeps its choice between traces that repeat as often, as two bits of a counter', () => {
    const buffer = new ScopeBuffer(1 << 16);
    buffer.reset(3);
    // Q2 and Q3 of a decade counter: each rises once in 10 s, Q2 at 4 s and Q3 at 8 s
    const bit = (k: number) => time.map((t) => ((Math.floor(t) % 10 >> k) & 1 ? 5 : 0));
    buffer.append(time, [bit(0), bit(2), bit(3)]);
    expect(buffer.risingEdges(1)).toBe(3);
    expect(buffer.risingEdges(2)).toBe(3);
    expect(slowestChannel(buffer, 3, 2)).toBe(2);
    expect(slowestChannel(buffer, 3, 1)).toBe(1);
    // With few edges in the buffer, two against three is still the same pace
    const short = new ScopeBuffer(1 << 16);
    short.reset(2);
    const t25 = time.filter((t) => t < 25);
    short.append(t25, [t25.map((t) => ((Math.floor(t) % 10 >> 2) & 1 ? 5 : 0)), t25.map((t) => ((Math.floor(t) % 10 >> 3) & 1 ? 5 : 0))]);
    expect([short.risingEdges(0), short.risingEdges(1)]).toEqual([3, 2]);
    expect(slowestChannel(short, 2, 0)).toBe(0);
    // A trace that is clearly faster gives way
    expect(slowestChannel(buffer, 3, 0)).toBe(1);
  });

  it('has nothing to follow without edges', () => {
    const buffer = new ScopeBuffer(16);
    buffer.reset(1);
    buffer.append(Float64Array.of(0, 1, 2), [Float64Array.of(1, 1, 1)]);
    expect(slowestChannel(buffer, 1)).toBeNull();
  });
});
