import { describe, expect, it } from 'vitest';
import { localToWorld } from './geometry';

describe('localToWorld', () => {
  const pin = { x: -40, y: -10 };

  it('turns a point with the part', () => {
    expect(localToWorld(100, 100, pin, 0)).toEqual({ x: 60, y: 90 });
    expect(localToWorld(100, 100, pin, 90)).toEqual({ x: 110, y: 60 });
    expect(localToWorld(100, 100, pin, 180)).toEqual({ x: 140, y: 110 });
    expect(localToWorld(100, 100, pin, 270)).toEqual({ x: 90, y: 140 });
  });

  it('mirrors top to bottom on the part itself, before it turns', () => {
    expect(localToWorld(100, 100, pin, 0, true)).toEqual({ x: 60, y: 110 });
    expect(localToWorld(100, 100, pin, 90, true)).toEqual({ x: 90, y: 60 });
    expect(localToWorld(100, 100, pin, 180, true)).toEqual({ x: 140, y: 90 });
    expect(localToWorld(100, 100, pin, 270, true)).toEqual({ x: 110, y: 140 });
  });

  it('leaves a point on the axis of the part where it is', () => {
    expect(localToWorld(0, 0, { x: 40, y: 0 }, 0, true)).toEqual({ x: 40, y: 0 });
  });
});
