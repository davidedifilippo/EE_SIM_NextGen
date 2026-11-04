import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { circuitFromNets, Part } from './testCircuits';
import { EXAMPLES } from '../samples/examples';

const last = (values: number[]) => values[values.length - 1];

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const input = (tag: string, net: string, state: '0' | '1'): Part => ({ def: 'logicinput', tag, nets: [net], props: { state, vdd: '5' } });
const gate = (def: Part['def'], tag: string, out: string, ...inputs: string[]): Part => ({ def, tag, nets: [...inputs, out], props: { vdd: '5' } });
const led = (tag: string, a: string, k: string): Part => ({ def: 'led', tag, nets: [a, k], props: { model: 'LED_ROSSO' } });
const SQUARE: Part = { def: 'vsource', tag: 'V1', nets: ['clk', '0'], props: { shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '1k', phase: '0', duty: '50', spec: '' } };

function realtime(parts: Part[]) {
  const circuit = circuitFromNets('t', parts);
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  /** Voltage at the output of a part, by its id. */
  const output = (id: string) => engine.nodeVoltage(compiled.compiled.devices[compiled.compiled.elementIds.indexOf(id)].a);
  return { engine, compiled: compiled.compiled, output };
}

async function precise(parts: Part[], stop = '1m', step = '1u') {
  const circuit = circuitFromNets('t', parts);
  const netlist = generateNetlist(circuit, { type: 'tran', step, stop, maxStep: step });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const at = (id: string, terminal: string) => {
    const name = netlist.nodeOf.get(terminalKey(id, terminal))!;
    return name === '0' ? result.time.map(() => 0) : result.voltages.get(name)!;
  };
  return { result, at };
}

describe('logic parts against ngspice', () => {
  const lit = (a: '0' | '1', b: '0' | '1'): Part[] => [input('IN1', 'a', a), input('IN2', 'b', b), gate('gate_and', 'U1', 'y', 'a', 'b'), R('R1', 'y', 'k', '220'), led('D1', 'k', '0')];

  it.each([
    ['0', '0'],
    ['0', '1'],
    ['1', '1'],
  ] as const)('AND with inputs %s %s lights the LED the same way', async (a, b) => {
    const { engine, compiled } = realtime(lit(a, b));
    const led = compiled.elementIds.indexOf('d1');
    const realCurrent = engine.deviceCurrent(led);
    const { at } = await precise(lit(a, b), '10u', '1u');
    const ngCurrent = (last(at('r1', 'a')) - last(at('r1', 'b'))) / 220;
    if (a === '1' && b === '1') {
      // About (5 - 1.9) / (100 + 220)
      expect(realCurrent).toBeGreaterThan(8e-3);
      expect(realCurrent).toBeCloseTo(ngCurrent, 4);
    } else {
      expect(Math.abs(realCurrent)).toBeLessThan(1e-6);
      expect(Math.abs(ngCurrent)).toBeLessThan(1e-6);
    }
  });

  it.each(['gate_or', 'gate_nand', 'gate_nor', 'gate_xor'] as const)('%s gives the same output level', async (def) => {
    for (const [a, b] of [['0', '1'], ['1', '1']] as const) {
      const parts = [input('IN1', 'a', a), input('IN2', 'b', b), gate(def, 'U1', 'y', 'a', 'b'), R('RL', 'y', '0', '10k')];
      const { at } = await precise(parts, '10u', '1u');
      expect(realtime(parts).output('u1')).toBeCloseTo(last(at('rl', 'a')), 3);
    }
  });

  it('a NOT on a square wave follows it a step later, as the animation says', async () => {
    const parts = [SQUARE, gate('gate_not', 'U1', 'y', 'clk'), R('RL', 'y', '0', '10k')];
    const { engine, output } = realtime(parts);
    const h = 1e-6;
    const realSamples: number[] = [];
    for (let k = 0; k < 2000; k++) {
      engine.step(h);
      realSamples.push(output('u1'));
    }
    const { result, at } = await precise(parts, '2m', '1u');
    const ng = at('rl', 'a');
    // Compared away from the edges, where the two differ by the step of delay
    let compared = 0;
    for (const t of [0.25e-3, 0.75e-3, 1.25e-3, 1.75e-3]) {
      const k = Math.round(t / h) - 1;
      const j = result.time.findIndex((time) => time >= t);
      expect(realSamples[k]).toBeCloseTo(ng[j], 2);
      compared++;
    }
    expect(compared).toBe(4);
    expect(realSamples[249]).toBeLessThan(0.1);
    expect(realSamples[749]).toBeGreaterThan(4.9);
  });

  it('a chain of gates settles at the start, and a ring of three inverters keeps running', () => {
    const chain = [input('IN1', 'a', '1'), gate('gate_not', 'U1', 'b', 'a'), gate('gate_not', 'U2', 'c', 'b'), gate('gate_not', 'U3', 'd', 'c'), R('RL', 'd', '0', '10k')];
    expect(realtime(chain).output('u3')).toBeLessThan(0.1);

    const ring = [gate('gate_not', 'U1', 'b', 'a'), gate('gate_not', 'U2', 'c', 'b'), gate('gate_not', 'U3', 'a', 'c'), R('RL', 'a', '0', '10k')];
    const running = realtime(ring);
    const levels = new Set<number>();
    for (let k = 0; k < 20; k++) {
      running.engine.step(1e-6);
      levels.add(running.output('u3') > 2.5 ? 1 : 0);
    }
    expect(levels.size).toBe(2);
  });

  it('switching an input by hand changes the output at the next step', () => {
    const before = realtime([input('IN1', 'a', '0'), gate('gate_not', 'U1', 'y', 'a'), R('RL', 'y', '0', '10k')]);
    const after = realtime([input('IN1', 'a', '1'), gate('gate_not', 'U1', 'y', 'a'), R('RL', 'y', '0', '10k')]);
    after.engine.adoptState(before.engine);
    after.engine.step(1e-6);
    after.engine.step(1e-6);
    expect(after.output('u1')).toBeLessThan(0.1);
  });
});

describe('truth tables and displays against ngspice', () => {
  it('a decoder lights the same segments of the display in both engines', async () => {
    const circuit = EXAMPLES.find((e) => e.id === 'sevenseg')!.build();
    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u', maxStep: '1u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const display = compiled.compiled.devices[compiled.compiled.elementIds.indexOf('ds1')];
    if (display.kind !== 'display7') throw new Error('not a display');
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((segment, k) => {
      const ng = last(result.voltages.get(netlist.nodeOf.get(terminalKey('ds1', segment))!)!);
      expect(engine.nodeVoltage(display.segments[k])).toBeCloseTo(ng, 2);
    });
  });

  it('a table of its own gives the same output', async () => {
    // XNOR, written by hand; the layout of the tests needs no pin in the middle of a side
    const xnor: Part = { def: 'truthtable', tag: 'U1', nets: ['a', 'b', 'y'], props: { table: '1 0 0 1', vdd: '5' } };
    for (const [a, b] of [['1', '1'], ['1', '0'], ['0', '0']] as const) {
      const parts = [input('IN1', 'a', a), input('IN2', 'b', b), xnor, R('RL', 'y', '0', '10k')];
      const { at } = await precise(parts, '10u', '1u');
      const real = realtime(parts).output('u1');
      expect(real).toBeCloseTo(last(at('rl', 'a')), 3);
      expect(real > 2.5).toBe(a === b);
    }
  });
});

describe('clock, flip-flop and counter against ngspice', () => {
  const clock: Part = { def: 'clock', tag: 'CK1', nets: ['clk'], props: { frequency: '1k', vdd: '5' } };
  const loads = (...nets: string[]) => nets.map((net, k) => R(`RL${k}`, net, '0', '10k'));

  /** Both engines over the same time, read at the given instants: one value per net and instant. */
  async function compare(parts: Part[], nets: string[], times: number[], stop: string) {
    const { engine, compiled } = realtime(parts);
    const h = 1e-6;
    const real: number[][] = [];
    let t = 0;
    for (const time of times) {
      while (t < time - h / 2) {
        engine.step(h);
        t += h;
      }
      real.push(nets.map((_, k) => engine.nodeVoltage(compiled.devices[compiled.elementIds.indexOf(`rl${k}`)].a)));
    }
    const { result, at } = await precise(parts, stop, '1u');
    const precise_ = times.map((time) => {
      const j = result.time.findIndex((x) => x >= time);
      return nets.map((_, k) => at(`rl${k}`, 'a')[j]);
    });
    return { real, precise: precise_ };
  }

  const count = (levels: number[]) => levels.reduce((n, v) => n * 2 + (v > 2.5 ? 1 : 0), 0);

  it('a decade counter on a clock counts the rising edges, and starts again after nine', async () => {
    const parts = [clock, { def: 'counter4', tag: 'U1', nets: ['clk', '0', 'q3', 'q2', 'q1', 'q0'], props: { modulus: '10', vdd: '5' } } as Part, ...loads('q3', 'q2', 'q1', 'q0')];
    // Edges at 0.5 ms, 1.5 ms and so on: read a quarter period after each
    const times = Array.from({ length: 12 }, (_, k) => (k + 0.25) * 1e-3);
    const { real, precise: ng } = await compare(parts, ['q3', 'q2', 'q1', 'q0'], times, '12m');
    expect(real.map(count)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    expect(ng.map(count)).toEqual(real.map(count));
  });

  it('a binary counter goes on past nine', () => {
    const parts = [clock, { def: 'counter4', tag: 'U1', nets: ['clk', '0', 'q3', 'q2', 'q1', 'q0'], props: { modulus: '16', vdd: '5' } } as Part, ...loads('q3', 'q2', 'q1', 'q0')];
    const { engine, compiled } = realtime(parts);
    for (let k = 0; k < 12250; k++) engine.step(1e-6);
    const levels = [0, 1, 2, 3].map((k) => engine.nodeVoltage(compiled.devices[compiled.elementIds.indexOf(`rl${k}`)].a));
    expect(count(levels)).toBe(12);
  });

  it('a flip-flop with its complement back on D divides the clock by two', async () => {
    const parts = [clock, { def: 'dff', tag: 'FF1', nets: ['d', 'clk', '0', '0', 'q', 'd'], props: { vdd: '5' } } as Part, ...loads('q')];
    const times = Array.from({ length: 6 }, (_, k) => (k + 0.25) * 1e-3);
    const { real, precise: ng } = await compare(parts, ['q'], times, '6m');
    expect(real.map(count)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(ng.map(count)).toEqual(real.map(count));
  });

  it('reset holds the counter at zero, set holds the flip-flop at one', async () => {
    const counter = [clock, input('IN1', 'r', '1'), { def: 'counter4', tag: 'U1', nets: ['clk', 'r', 'q3', 'q2', 'q1', 'q0'], props: { modulus: '10', vdd: '5' } } as Part, ...loads('q3', 'q2', 'q1', 'q0')];
    const times = [1.25e-3, 3.25e-3];
    const a = await compare(counter, ['q3', 'q2', 'q1', 'q0'], times, '4m');
    expect(a.real.map(count)).toEqual([0, 0]);
    expect(a.precise.map(count)).toEqual([0, 0]);

    const flipflop = [clock, input('IN1', 's', '1'), { def: 'dff', tag: 'FF1', nets: ['0', 'clk', 's', '0', 'q', 'qn'], props: { vdd: '5' } } as Part, ...loads('q', 'qn')];
    const b = await compare(flipflop, ['q', 'qn'], times, '4m');
    expect(b.real.map(count)).toEqual([2, 2]);
    expect(b.precise.map(count)).toEqual([2, 2]);
  });
});
