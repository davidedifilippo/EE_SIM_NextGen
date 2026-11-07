import { describe, expect, it } from 'vitest';
import { Circuit, Element, Wire } from '../model/types';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { getDevice } from '../library/devices';
import { applyRailPushes, planRailPushes } from './railPush';
import { followMove, wireFollowers } from './wireRouting';
import { localToWorld } from '../utils/geometry';

const part = (id: string, def: string, x: number, y: number, rot: 0 | 90 = 90): Element => ({ id, def, x, y, rot, tag: id.toUpperCase(), props: {} });
const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]) => ({ x, y })) });

/**
 * The end of the rectifier of the video: a positive rail above, a ground rail below, C1 between them on
 * two short leads, R2 and RL at the two ends, a ground on the lower rail under RL.
 */
const rails = (): Circuit => ({
  title: 't',
  elements: [part('r2', 'resistor', 160, 150), part('c1', 'capacitor', 290, 170), part('rl', 'resistor', 440, 150), part('gnd', 'ground', 440, 240, 0)],
  wires: [
    wire('top', [160, 110], [440, 110]),
    wire('lead_top', [290, 110], [290, 130]),
    wire('lead_bottom', [290, 210], [290, 240]),
    wire('left', [160, 190], [160, 240], [290, 240]),
    wire('right', [290, 240], [440, 240]),
    wire('rl_down', [440, 190], [440, 240]),
  ],
  models: [],
});

/** What a drag of a part by (dx, dy) leaves, as the canvas computes it. */
function drag(circuit: Circuit, id: string, dx: number, dy: number): Circuit {
  const moving = circuit.elements.find((el) => el.id === id)!;
  const terminals = (el: Element) => (getDevice(el.def)?.terminals ?? []).map((t) => localToWorld(el.x, el.y, t, el.rot, el.flip));
  const followers = wireFollowers(circuit.wires, terminals(moving), circuit.elements.filter((el) => el.id !== id).flatMap(terminals));
  const pushes = planRailPushes(circuit, id, new Set(followers.map((f) => f.wireId)));
  const pushed = applyRailPushes(circuit.wires, circuit.elements, pushes, { x: dx, y: dy });
  return {
    ...circuit,
    elements: pushed.elements.map((el) => (el.id === id ? { ...el, x: el.x + dx, y: el.y + dy } : el)),
    wires: pushed.wires.map((w) => {
      const follower = followers.find((f) => f.wireId === w.id);
      return follower ? { ...w, pts: followMove(follower, dx, dy) } : w;
    }),
  };
}

/** Which terminals share a net: the same groups before and after, or the move changed the circuit. */
function groups(circuit: Circuit): string[] {
  const { netOf } = computeConnectivity(circuit);
  const byNet = new Map<string, string[]>();
  for (const el of circuit.elements) {
    for (const t of getDevice(el.def)!.terminals) {
      const net = netOf.get(terminalKey(el.id, t.id))!;
      byNet.set(net, [...(byNet.get(net) ?? []), `${el.id}.${t.id}`]);
    }
  }
  return [...byNet.values()].map((g) => g.sort().join(' ')).sort();
}

describe('pushing a rail', () => {
  it('a part dragged past its short lead pushes the wire below, and every connection stays as it was', () => {
    const before = rails();
    const after = drag(before, 'c1', 0, 130);
    expect(groups(after)).toEqual(groups(before));
    // The lower rail went down by 100, the lead below is gone, the side wires grew, the ground followed
    expect(after.wires.find((w) => w.id === 'lead_bottom')).toBeUndefined();
    expect(after.wires.find((w) => w.id === 'left')!.pts).toEqual([{ x: 160, y: 190 }, { x: 160, y: 340 }, { x: 290, y: 340 }]);
    expect(after.wires.find((w) => w.id === 'right')!.pts).toEqual([{ x: 290, y: 340 }, { x: 440, y: 340 }]);
    expect(after.wires.find((w) => w.id === 'rl_down')!.pts).toEqual([{ x: 440, y: 190 }, { x: 440, y: 340 }]);
    expect(after.elements.find((el) => el.id === 'gnd')).toMatchObject({ x: 440, y: 340 });
  });

  it('before it reaches the wire, nothing but its leads moves', () => {
    const before = rails();
    const after = drag(before, 'c1', 0, 20);
    expect(groups(after)).toEqual(groups(before));
    expect(after.wires.find((w) => w.id === 'right')).toEqual(before.wires.find((w) => w.id === 'right'));
  });

  it('upwards, it pushes the rail above in the same way', () => {
    const before = rails();
    const after = drag(before, 'c1', 0, -80);
    expect(groups(after)).toEqual(groups(before));
    expect(after.wires.find((w) => w.id === 'top')!.pts).toEqual([{ x: 160, y: 50 }, { x: 440, y: 50 }]);
  });

  it('a part with two terminals on the pushed rail stays, and a wire grows from it', () => {
    const before = rails();
    // RL sits on the lower rail itself, with no wire down to it
    before.elements = before.elements.map((el) => (el.id === 'rl' ? { ...el, y: 200 } : el));
    before.wires = before.wires.filter((w) => w.id !== 'rl_down').map((w) => (w.id === 'top' ? { ...w, pts: [{ x: 160, y: 110 }, { x: 440, y: 110 }] } : w));
    before.wires.push(wire('rl_up', [440, 110], [440, 160]));
    const after = drag(before, 'c1', 0, 130);
    expect(groups(after)).toEqual(groups(before));
    expect(after.elements.find((el) => el.id === 'rl')).toMatchObject({ x: 440, y: 200 });
  });
});
