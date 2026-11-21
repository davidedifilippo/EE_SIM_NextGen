import { describe, expect, it } from 'vitest';
import { getDevice } from '../library/devices';
import { Circuit, Element, Rotation } from '../model/types';
import { shortedParts } from './shorted';
import { EXAMPLES } from '../samples/examples';

const part = (id: string, def: string, x: number, y: number, rot: Rotation = 0): Element => ({ id, def, x, y, rot, tag: id.toUpperCase(), props: Object.fromEntries((getDevice(def)?.props ?? []).map((p) => [p.key, p.default])) });

describe('parts short-circuited by a wire', () => {
  it('finds a fuse laid on a wire already drawn, its two terminals on it', () => {
    // F1 at (100, 0): terminals at (60, 0) and (140, 0); the wire runs under it from 0 to 200
    const c: Circuit = { title: 't', elements: [part('f1', 'fuse', 100, 0)], wires: [{ id: 'w', pts: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 140, y: 0 }, { x: 200, y: 0 }] }], models: [] };
    expect(shortedParts(c)).toEqual(['f1']);
  });

  it('leaves alone a part in series, and one with many terminals', () => {
    const c: Circuit = {
      title: 't',
      elements: [part('f1', 'fuse', 100, 0), part('q1', 'npn', 300, 0)],
      wires: [
        { id: 'w1', pts: [{ x: 0, y: 0 }, { x: 60, y: 0 }] },
        { id: 'w2', pts: [{ x: 140, y: 0 }, { x: 200, y: 0 }] },
        // Base and collector together, as a diode: not a mistake
        { id: 'w3', pts: [{ x: 260, y: 0 }, { x: 260, y: -40 }, { x: 320, y: -40 }] },
      ],
      models: [],
    };
    expect(shortedParts(c)).toEqual([]);
  });

  it('finds nothing in the examples', () => {
    for (const example of EXAMPLES) expect(shortedParts(example.build()), example.id).toEqual([]);
  });
});
