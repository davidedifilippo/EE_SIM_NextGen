import { describe, expect, it } from 'vitest';
import { Circuit, Element, Rotation, Wire } from '../model/types';
import { DEVICES, getDevice } from '../library/devices';
import { HOLES, holeAt } from './board';
import { resistorBands } from './colorCode';
import { compareWithSchematic, comparisonSummary } from './compare';
import { footprintOf, isElectrolytic, pinPoints } from './footprints';
import { pressOnBoard, removeFromBoard, turnedPlace, turnOnBoard } from './edit';
import { supplyAmps, supplyVolts } from './art/PartArt';
import { compileCircuit } from '../realtime/compile';
import { LiveSimulation } from '../realtime/liveSimulation';
import { parseCircuitFile, serializeCircuit } from '../storage/circuitFile';

const part = (id: string, def: string, x: number, y: number, rot: Rotation, tag: string, props: Record<string, string> = {}): Element => ({
  id,
  def,
  x,
  y,
  rot,
  tag,
  props: { ...Object.fromEntries((getDevice(def)?.props ?? []).map((p) => [p.key, p.default])), ...props },
});
const wire = (id: string, ...pts: [number, number][]): Wire => ({ id, pts: pts.map(([x, y]) => ({ x, y })) });

describe('the breadboard', () => {
  it('has 830 points: strips of five, rails in groups of five, the groove between e and f', () => {
    expect(HOLES).toHaveLength(830);
    const strip = (label: string) => HOLES.find((h) => h.label === label)!.strip;
    expect(strip('a1')).toBe(strip('e1'));
    expect(strip('e1')).not.toBe(strip('f1'));
    expect(strip('a1')).not.toBe(strip('a2'));
    expect(holeAt({ x: 10, y: 0 })?.label).toBe('a2');
    expect(holeAt({ x: 5, y: 0 })).toBeNull();
    const rails = HOLES.filter((h) => h.strip === 'rail:topPlus');
    expect(rails).toHaveLength(50);
    expect(new Set(HOLES.filter((h) => h.strip.startsWith('rail')).map((h) => h.strip)).size).toBe(4);
  });

  it('writes the colours of a resistor', () => {
    expect(resistorBands('1k')!.names).toEqual(['marrone', 'nero', 'rosso', 'oro']);
    expect(resistorBands('4.7k')!.names).toEqual(['giallo', 'viola', 'rosso', 'oro']);
    expect(resistorBands('220')!.names).toEqual(['rosso', 'rosso', 'marrone', 'oro']);
    expect(resistorBands('10')!.names).toEqual(['marrone', 'nero', 'nero', 'oro']);
    expect(resistorBands('4.7')!.names).toEqual(['giallo', 'viola', 'oro', 'oro']);
    expect(resistorBands('1meg')!.names).toEqual(['marrone', 'nero', 'verde', 'oro']);
    expect(resistorBands('abc')).toBeNull();
  });

  it('tells an electrolytic from a ceramic', () => {
    expect(isElectrolytic('100u')).toBe(true);
    expect(isElectrolytic('1u')).toBe(true);
    expect(isElectrolytic('100n')).toBe(false);
  });

  it('gives every part of the library a footprint, ground and the pin flags none', () => {
    for (const def of DEVICES) {
      const el = part('x', def.id, 0, 0, 0, 'X');
      const footprint = footprintOf(el);
      if (def.spice.kind === 'ground' || def.spice.kind === 'port') expect(footprint).toBeNull();
      else {
        expect(footprint, def.id).not.toBeNull();
        // Every terminal of the schematic has a pin
        expect(new Set(footprint!.pins.map((p) => p.terminal)), def.id).toEqual(new Set(def.terminals.map((t) => t.id)));
      }
    }
  });

  it('turns a fixed footprint with the part, and puts the leads where they are bent', () => {
    const pot = { ...part('p', 'potentiometer', 0, 0, 0, 'P1'), bb: { x: 100, y: 0, rot: 90 as Rotation } };
    expect(pinPoints(pot).map((p) => p.at)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 100, y: 20 },
    ]);
    const r = { ...part('r', 'resistor', 0, 0, 0, 'R1'), bb: { x: 0, y: 0, rot: 0 as Rotation, legs: [{ x: 0, y: 0 }, { x: 0, y: 70 }] as [{ x: number; y: number }, { x: number; y: number }] } };
    expect(pinPoints(r).map((p) => p.at)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 70 },
    ]);
  });
});

/** A divider: V1 10 V, R1 and R2 1k in series to ground; the schematic. */
const divider = (): Circuit => ({
  title: 't',
  elements: [
    // A battery, which goes into the holes: the DC supply stands beside the breadboard
    part('v1', 'battery', 0, 40, 90, 'V1', { amplitude: '10' }),
    part('g', 'ground', 0, 80, 0, ''),
    part('r1', 'resistor', 160, 0, 0, 'R1', { value: '1k' }),
    part('r2', 'resistor', 240, 40, 90, 'R2', { value: '1k' }),
    part('g2', 'ground', 240, 80, 0, ''),
  ],
  wires: [wire('w1', [0, 0], [120, 0]), wire('w2', [200, 0], [240, 0]), wire('w3', [240, 80], [0, 80])],
  models: [],
});

/**
 * Mounted: V1 with + in a1 and − in a2 (its generic footprint, pins in a row), R1 from c1 to c5, R2 from d5 to d9,
 * a jumper from e9 to e2, back to the − of V1.
 */
function mounted(): Circuit {
  const c = divider();
  const place = (id: string, bb: Element['bb']) => (c.elements = c.elements.map((el) => (el.id === id ? { ...el, bb } : el)));
  place('v1', { x: 0, y: 0, rot: 0 });
  place('r1', { x: 0, y: 20, rot: 0, legs: [{ x: 0, y: 20 }, { x: 40, y: 20 }] });
  place('r2', { x: 40, y: 30, rot: 0, legs: [{ x: 40, y: 30 }, { x: 80, y: 30 }] });
  return { ...c, breadboard: { wires: [{ id: 'j1', a: { x: 80, y: 40 }, b: { x: 10, y: 40 }, color: '#111827' }] } };
}

describe('the breadboard against the schematic', () => {
  it('finds everything joined as in the schematic', () => {
    const result = compareWithSchematic(mounted());
    expect(result).toMatchObject({ missing: [], shorts: [], unmounted: [], isComplete: true });
    expect(comparisonSummary(result)).toBe('Tutto collegato come nello schema');
  });

  it('finds a jumper missing, with the nearest pins to join', () => {
    const c = mounted();
    const result = compareWithSchematic({ ...c, breadboard: { wires: [] } });
    expect(result.missing).toEqual([{ from: { x: 10, y: 0 }, to: { x: 80, y: 30 }, names: ['V1.neg', 'R2.b'] }]);
    expect(comparisonSummary(result)).toBe('1 collegamento mancante');
  });

  it('finds a short, and the parts still to mount', () => {
    const c = mounted();
    // A jumper from the strip of R1.b to that of V1.+: R1 shorted
    const shorted = { ...c, breadboard: { wires: [...c.breadboard!.wires, { id: 'j2', a: { x: 40, y: 0 }, b: { x: 0, y: 40 }, color: '#dc2626' }] } };
    const result = compareWithSchematic(shorted);
    expect(result.shorts).toHaveLength(1);
    expect(new Set(result.shorts[0].names)).toEqual(new Set(['V1.pos', 'R1.b']));
    const loose = { ...c, elements: c.elements.map((el) => (el.id === 'r2' ? { ...el, bb: undefined } : el)) };
    expect(comparisonSummary(compareWithSchematic(loose))).toBe('1 componente da montare');
  });

  it('joins the two pins on each side of a push button', () => {
    const button = { ...part('s', 'pushno', 0, 0, 0, 'S1'), bb: { x: 0, y: 40, rot: 0 as Rotation } };
    const c: Circuit = { title: 't', elements: [button], wires: [], models: [] };
    // Its pins a are in e1 and f1, across the groove, yet one node: nothing missing
    expect(compareWithSchematic(c).missing).toEqual([]);
  });
});

describe('the breadboard in files and edits', () => {
  it('goes to a file and comes back, as version 3; a circuit without it stays version 1', () => {
    const c = mounted();
    expect(parseCircuitFile(serializeCircuit(c))).toEqual(c);
    expect(JSON.parse(serializeCircuit(c)).version).toBe(3);
    expect(JSON.parse(serializeCircuit(divider())).version).toBe(1);
  });

  it('refuses a jumper colour that is not a colour', () => {
    const text = serializeCircuit({ ...mounted(), breadboard: { wires: [{ id: 'j', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, color: 'url(x)' }] } });
    expect(() => parseCircuitFile(text)).toThrow();
  });

  it('turns two leads around the first, and takes parts back to the tray', () => {
    expect(turnedPlace({ x: 0, y: 0, rot: 0, legs: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }).legs).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ]);
    const back = removeFromBoard(mounted(), new Set(['r1', 'j1']));
    expect(back.elements.find((el) => el.id === 'r1')!.bb).toBeUndefined();
    expect(back.elements.find((el) => el.id === 'r1')).toBeDefined();
    expect(back.breadboard!.wires).toEqual([]);
  });
});

/**
 * A supply of 12 V with 1 Ω inside, on a resistor of 11 Ω. On the breadboard the supply stands below it, its
 * sockets at (100, 250) and (120, 250); the resistor between a11 and a15; a jumper from each socket.
 */
function supplied(jumpers: [[number, number], [number, number]][]): Circuit {
  return {
    title: 't',
    elements: [
      { ...part('v1', 'dcsupply', 0, 40, 90, 'V1', { amplitude: '12', rint: '1' }), bb: { x: 100, y: 250, rot: 0 } },
      { ...part('r1', 'resistor', 80, 40, 90, 'R1', { value: '11' }), bb: { x: 100, y: 0, rot: 0, legs: [{ x: 100, y: 0 }, { x: 140, y: 0 }] } },
      part('g', 'ground', 0, 80, 0, ''),
    ],
    wires: [wire('w1', [0, 0], [80, 0]), wire('w2', [0, 80], [80, 80])],
    models: [],
    breadboard: { wires: jumpers.map(([a, b], k) => ({ id: `j${k}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, color: '#dc2626' })) },
  };
}
const PLUS: [[number, number], [number, number]] = [[100, 250], [100, 10]];
const MINUS: [[number, number], [number, number]] = [[120, 250], [140, 10]];

describe('the bench supply on the breadboard', () => {
  it('stands for the DC supply, with a red and a black socket two pitches apart; a battery stays a box', () => {
    const footprint = footprintOf(part('v1', 'dcsupply', 0, 0, 0, 'V1'))!;
    expect(footprint.art).toBe('benchsupply');
    expect(footprint.pins.map((p) => [p.terminal, p.label, p.at.x])).toEqual([['pos', '+', 0], ['neg', '−', 20]]);
    expect(footprintOf(part('b1', 'battery', 0, 0, 0, 'B1'))!.art).toBe('generic');
  });

  it('feeds the breadboard through two jumpers from its sockets, beside it', () => {
    const c = supplied([PLUS, MINUS]);
    // Its sockets are on no hole: only the jumpers join them to the strips
    expect(pinPoints(c.elements[0]).map((p) => holeAt(p.at))).toEqual([null, null]);
    const comparison = compareWithSchematic(c);
    expect(comparison.missing).toEqual([]);
    expect(comparison.shorts).toEqual([]);
  });

  it('is found not joined when a jumper is missing', () => {
    expect(compareWithSchematic(supplied([PLUS])).missing).toHaveLength(1);
  });

  it('does not turn: its display would lie on its side', () => {
    const c = supplied([PLUS, MINUS]);
    const turned = turnOnBoard(c, new Set(['v1', 'r1']));
    expect(turned.elements[0].bb).toEqual(c.elements[0].bb);
    expect(turned.elements[1].bb).not.toEqual(c.elements[1].bb);
  });

  it('shows the voltage at its sockets and the current it gives', () => {
    const c = supplied([PLUS, MINUS]);
    const compiled = compileCircuit(c);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const supply = compiled.compiled.elementIds.indexOf('v1');
    const sim = new LiveSimulation();
    expect(sim.load(c)).toEqual({ ok: true });
    sim.advance(10, 1e-4, 1e6);
    const frame = sim.frame()!;
    // 12 V behind 1 Ω on 11 Ω: 11 V at the sockets, 1 A out of the red one
    expect(supplyVolts(frame.deviceVoltage[supply])).toBe('11.00');
    expect(supplyAmps(-frame.deviceCurrent[supply])).toBe('1.000');
    expect(supplyVolts(230)).toBe('230.0');
    expect(supplyAmps(12.5)).toBe('12.50');
  });

  it('shows dashes for a supply the animation has not met yet, as one just added', () => {
    expect(supplyVolts(undefined)).toBe('--.--');
    expect(supplyAmps(undefined)).toBe('-.---');
    expect(supplyAmps(NaN)).toBe('-.---');
  });
});

describe('the switches on the breadboard', () => {
  it('a press closes and opens a switch, the same part as in the schematic', () => {
    const c: Circuit = { title: 't', elements: [{ ...part('s1', 'switch', 0, 0, 0, 'S1'), bb: { x: 0, y: 0, rot: 0 } }], wires: [], models: [] };
    const closed = pressOnBoard(c, 's1')!;
    expect(closed.elements[0].props.closed).toBe('1');
    expect(pressOnBoard(closed, 's1')!.elements[0].props.closed).toBe('0');
    // Where it is mounted does not change
    expect(closed.elements[0].bb).toEqual(c.elements[0].bb);
  });

  it('a press sends a changeover to its other way, and does nothing to a part with no lever', () => {
    const c: Circuit = { title: 't', elements: [{ ...part('s1', 'spdt', 0, 0, 0, 'S1'), bb: { x: 0, y: 0, rot: 0 } }, { ...part('r1', 'resistor', 0, 0, 0, 'R1'), bb: { x: 0, y: 20, rot: 0 } }], wires: [], models: [] };
    const second = pressOnBoard(c, 's1')!;
    expect(second.elements[0].props.position).toBe('2');
    expect(pressOnBoard(second, 's1')!.elements[0].props.position).toBe('1');
    expect(pressOnBoard(c, 'r1')).toBeNull();
  });
});
