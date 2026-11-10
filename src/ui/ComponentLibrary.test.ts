import { describe, expect, it } from 'vitest';
import { DEVICES } from '../library/devices';
import { defaultSymbol, iconBox, thumbGeometry } from './ComponentLibrary';

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

describe('iconBox', () => {
  it('holds the whole box of every part, also where it goes beyond the first and the last pin', () => {
    for (const def of DEVICES) {
      const symbol = defaultSymbol(def);
      const box = iconBox(def, symbol);
      for (const prim of symbol) {
        if (prim.t !== 'rect') continue;
        expect(prim.x, def.id).toBeGreaterThan(box.x);
        expect(prim.y, def.id).toBeGreaterThan(box.y);
        expect(prim.x + prim.w, def.id).toBeLessThan(box.x + box.w);
        expect(prim.y + prim.h, def.id).toBeLessThan(box.y + box.h);
      }
    }
  });
});
