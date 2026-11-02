import { describe, expect, it } from 'vitest';
import { thumbGeometry } from './ComponentLibrary';

describe('thumbGeometry', () => {
  it('has nothing to show when everything fits', () => {
    expect(thumbGeometry(0, 200, 200)).toBeNull();
    expect(thumbGeometry(0, 150, 200)).toBeNull();
  });

  it('is as wide as the part in view, from one end to the other', () => {
    expect(thumbGeometry(0, 400, 200)).toEqual({ left: 0, width: 50 });
    expect(thumbGeometry(100, 400, 200)).toEqual({ left: 25, width: 50 });
    expect(thumbGeometry(200, 400, 200)).toEqual({ left: 50, width: 50 });
  });

  it('stays large enough to take, and still reaches the end', () => {
    expect(thumbGeometry(0, 10000, 200)?.width).toBe(20);
    expect(thumbGeometry(9800, 10000, 200)).toEqual({ left: 80, width: 20 });
  });
});
