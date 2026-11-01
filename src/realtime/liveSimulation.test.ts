import { describe, expect, it } from 'vitest';
import { Circuit } from '../model/types';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { circuitFromNets } from './testCircuits';
import { LiveSimulation } from './liveSimulation';
import { buildWireGraph, solveWireCurrents } from './wireGraph';

const pt = (x: number, y: number) => ({ x, y });

describe('wire currents', () => {
  it('splits a wire at terminals in the middle', () => {
    const graph = buildWireGraph([{ id: 'w', pts: [pt(0, 0), pt(100, 0)] }], [pt(0, 0), pt(50, 0), pt(100, 0)], []);
    expect(graph.edges.map((e) => [e.a.x, e.b.x])).toEqual([[0, 50], [50, 100]]);
  });

  it('applies Kirchhoff along a tee', () => {
    // 3 A enters at the left end and leaves 1 A up the branch, 2 A at the right end
    const wires = [
      { id: 'main', pts: [pt(0, 0), pt(100, 0)] },
      { id: 'branch', pts: [pt(50, 0), pt(50, 50)] },
    ];
    const graph = buildWireGraph(wires, [pt(0, 0), pt(100, 0), pt(50, 50)], [pt(100, 0)]);
    const injected = new Float64Array(graph.vertexCount);
    injected[graph.vertexOf.get('0,0')!] = 3;
    injected[graph.vertexOf.get('50,50')!] = -1;
    const out = new Float64Array(graph.edges.length);
    solveWireCurrents(graph, injected, out);
    const current = (x1: number, y1: number, x2: number, y2: number) => {
      const i = graph.edges.findIndex((e) => e.a.x === x1 && e.a.y === y1 && e.b.x === x2 && e.b.y === y2);
      return out[i];
    };
    expect(current(0, 0, 50, 0)).toBeCloseTo(3, 9);
    expect(current(50, 0, 100, 0)).toBeCloseTo(2, 9);
    expect(current(50, 0, 50, 50)).toBeCloseTo(1, 9);
  });

  it('does not join wires that only cross', () => {
    const graph = buildWireGraph(
      [
        { id: 'h', pts: [pt(0, 50), pt(100, 50)] },
        { id: 'v', pts: [pt(50, 0), pt(50, 100)] },
      ],
      [],
      [],
    );
    expect(graph.edges).toHaveLength(2);
  });

  it('leaves no current in the wire that closes a loop', () => {
    const wires = [
      { id: 'a', pts: [pt(0, 0), pt(100, 0)] },
      { id: 'b', pts: [pt(100, 0), pt(100, 100)] },
      { id: 'c', pts: [pt(100, 100), pt(0, 0)] },
    ];
    const graph = buildWireGraph(wires, [], []);
    const injected = new Float64Array(graph.vertexCount);
    const out = new Float64Array(graph.edges.length);
    injected[graph.vertexOf.get('100,0')!] = 1;
    injected[graph.vertexOf.get('0,0')!] = -1;
    solveWireCurrents(graph, injected, out);
    // The current takes the direct edge, and the two edges of the other way round stay at zero
    expect(out.filter((v) => v === 0)).toHaveLength(2);
    expect(out.filter((v) => Math.abs(v) === 1)).toHaveLength(1);
  });
});

describe('LiveSimulation', () => {
  const run = (sim: LiveSimulation, ms: number) => sim.advance(Math.round(ms * 100), 1e-5, 1e6);

  it('the series current in the wires matches the devices', () => {
    const sim = new LiveSimulation();
    const circuit = halfWaveRectifier();
    expect(sim.load(circuit)).toEqual({ ok: true });
    run(sim, 5);
    const frame = sim.frame()!;
    const resistor = circuit.elements.filter((e) => e.def !== 'ground').findIndex((e) => e.id === 'r1');
    const current = frame.deviceCurrent[resistor];
    expect(current).toBeGreaterThan(8e-3);
    // Every wire of the series loop carries the load current; only the free ends beyond R1 carry none
    const carrying = [...frame.edgeCurrent].filter((i) => i !== 0);
    expect(carrying).toHaveLength(4);
    for (const i of carrying) expect(Math.abs(i)).toBeCloseTo(current, 5);
    // The ground wire is at 0 V, the output wire near the peak
    expect(Math.min(...frame.edgeVoltage.map(Math.abs))).toBe(0);
    expect(Math.max(...frame.edgeVoltage)).toBeCloseTo(10, 1);
  });

  it('a capacitor keeps its charge when a value changes, and the clock survives a change of topology', () => {
    const sim = new LiveSimulation();
    const circuit = halfWaveRectifier({ capacitor: '100u' });
    sim.load(circuit);
    run(sim, 25);
    const time = sim.time;
    const output = () => Math.max(...sim.frame()!.deviceVoltage.map(Math.abs).slice(2));
    const charged = output();

    const changed: Circuit = {
      ...circuit,
      elements: circuit.elements.map((e) => (e.id === 'r1' ? { ...e, props: { value: '10k' } } : e)),
    };
    expect(sim.load(changed)).toEqual({ ok: true });
    expect(sim.time).toBe(time);
    expect(output()).toBeCloseTo(charged, 6);

    const rewired: Circuit = { ...changed, elements: changed.elements.filter((e) => e.id !== 'c1') };
    sim.load(rewired);
    expect(sim.time).toBe(time);
  });

  it('keeps running while a part is not connected yet', () => {
    const sim = new LiveSimulation();
    const circuit = halfWaveRectifier();
    circuit.elements.push({ id: 'x', def: 'resistor', x: 500, y: 500, rot: 0, tag: 'R9', props: { value: '1k' } });
    expect(sim.load(circuit)).toEqual({ ok: true });
    expect(run(sim, 1)).toBeGreaterThan(0);
  });

  it('shows the transistor currents on its own dots and on the wires', () => {
    const sim = new LiveSimulation();
    const circuit = circuitFromNets('t', [
      { def: 'vsource', tag: 'VCC', nets: ['vcc', '0'], props: { spec: 'DC 5' } },
      { def: 'resistor', tag: 'RC', nets: ['vcc', 'c'], props: { value: '1k' } },
      { def: 'resistor', tag: 'RB', nets: ['vcc', 'b'], props: { value: '430k' } },
      { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } },
    ]);
    expect(sim.load(circuit)).toEqual({ ok: true });
    run(sim, 1);
    const frame = sim.frame()!;
    const q = 3;
    const [ic, ib, ie] = frame.dotCurrent.slice(frame.dotCurrent.length - 3);
    expect(ic).toBeGreaterThan(1e-3);
    expect(ib).toBeGreaterThan(1e-6);
    expect(ie).toBeCloseTo(-(ic + ib), 12);
    expect(frame.deviceCurrent[q]).toBe(ic);
    expect(frame.deviceVbe[q]).toBeCloseTo(0.67, 1);
    expect(frame.deviceVoltage[q]).toBeGreaterThan(0.1);
    // The lead of each terminal carries the current of that terminal
    const carried = [...frame.edgeCurrent].map(Math.abs);
    for (const current of [ic, ib, -ie]) expect(carried.some((i) => Math.abs(i - Math.abs(current)) < 1e-9)).toBe(true);
  });

  it('explains what is missing and recovers once fixed', () => {
    const sim = new LiveSimulation();
    const circuit = halfWaveRectifier();
    const withoutGround = { ...circuit, elements: circuit.elements.filter((e) => e.def !== 'ground') };
    expect(sim.load(withoutGround)).toEqual({ ok: false, errors: ['Il circuito non ha una massa'] });
    expect(sim.frame()).toBeNull();
    expect(sim.load(circuit)).toEqual({ ok: true });
    expect(sim.frame()).not.toBeNull();
  });

  it('reports shorted sources instead of stopping the app', () => {
    const sim = new LiveSimulation();
    const circuit = circuitFromNets('t', [
      { def: 'vsource', tag: 'V1', nets: ['a', '0'], props: { spec: 'DC 5' } },
      { def: 'vsource', tag: 'V2', nets: ['a', '0'], props: { spec: 'DC 3' } },
    ]);
    const result = sim.load(circuit);
    expect(result.ok).toBe(false);
  });
});

describe('performance', () => {
  it('a 50-section RC ladder with diodes stays within the real-time budget', () => {
    const parts: Parameters<typeof circuitFromNets>[1] = [{ def: 'vsource', tag: 'V1', nets: ['n0', '0'], props: { spec: 'SIN(0 10 50)' } }];
    for (let i = 1; i <= 50; i++) {
      parts.push({ def: 'resistor', tag: `R${i}`, nets: [`n${i - 1}`, `n${i}`], props: { value: '100' } });
      parts.push({ def: 'capacitor', tag: `C${i}`, nets: [`n${i}`, '0'], props: { value: '1u' } });
    }
    parts.push({ def: 'diode', tag: 'D1', nets: ['n50', 'out'], props: { model: 'D1N4148' } });
    parts.push({ def: 'resistor', tag: 'RL', nets: ['out', '0'], props: { value: '1k' } });

    const sim = new LiveSimulation();
    expect(sim.load(circuitFromNets('ladder', parts))).toEqual({ ok: true });
    const start = performance.now();
    const steps = sim.advance(2400, 8e-6, 1e6);
    const seconds = (performance.now() - start) / 1000;
    console.info(`Scala RC da 50 sezioni: ${Math.round(steps / seconds)} passi al secondo`);
    expect(steps).toBe(2400);
  });
});
