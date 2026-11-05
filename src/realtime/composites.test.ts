import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { COMPOSITES, getDevice } from '../library/devices';
import { compositeSchematic, logicNetwork } from '../library/composites';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { evaluateNetwork, sequentialSpec } from './logic';
import { circuitFromNets, Part } from './testCircuits';

const bitsOf = (row: number, count: number) => Array.from({ length: count }, (_, k) => ((row >> (count - 1 - k)) & 1) === 1);
const num = (levels: boolean[]) => levels.reduce((n, level) => n * 2 + (level ? 1 : 0), 0);

/** What each part made of parts must compute, from its inputs in the order of its pins: one bit per output. */
const EXPECTED: Record<string, (inputs: boolean[]) => number> = {
  halfadder: ([a, b]) => (a !== b ? 1 : 0) | (a && b ? 2 : 0),
  fulladder: (inputs) => {
    const sum = inputs.filter(Boolean).length;
    return (sum & 1) | (sum >= 2 ? 2 : 0);
  },
  mux2: ([d0, d1, s]) => ((s ? d1 : d0) ? 1 : 0),
  mux4: (inputs) => (inputs[num(inputs.slice(4))] ? 1 : 0),
  mux8: (inputs) => (inputs[num(inputs.slice(8))] ? 1 : 0),
  demux2: ([d, s]) => (d ? 1 << (s ? 1 : 0) : 0),
  demux4: ([d, ...select]) => (d ? 1 << num(select) : 0),
  demux8: ([d, ...select]) => (d ? 1 << num(select) : 0),
};

describe('the parts made of parts', () => {
  it.each(COMPOSITES.map((def) => def.id))('%s computes its function on every combination of inputs', (id) => {
    const network = logicNetwork(id);
    for (let row = 0; row < 1 << network.inputs; row++) {
      const inputs = bitsOf(row, network.inputs);
      expect(evaluateNetwork(network, inputs), `${id} ${row.toString(2)}`).toBe(EXPECTED[id](inputs));
    }
  });

  it.each(COMPOSITES.map((def) => def.id))('%s has a flag for each of its pins, and nothing else', (id) => {
    const spice = getDevice(id)!.spice;
    if (spice.kind !== 'logic') throw new Error('not logic');
    const flags = compositeSchematic(id)!.elements.filter((el) => el.def.startsWith('port_'));
    expect(flags.filter((el) => el.def === 'port_in').map((el) => el.tag).sort()).toEqual([...spice.inputs].sort());
    expect(flags.filter((el) => el.def === 'port_out').map((el) => el.tag).sort()).toEqual([...spice.outputs].sort());
  });

  it('the full adder is two half adders and an OR, and the half adder an XOR and an AND', () => {
    expect(compositeSchematic('fulladder')!.elements.filter((el) => !el.def.startsWith('port_')).map((el) => el.def)).toEqual(['halfadder', 'halfadder', 'gate_or']);
    expect(compositeSchematic('halfadder')!.elements.filter((el) => !el.def.startsWith('port_')).map((el) => el.def)).toEqual(['gate_xor', 'gate_and']);
    // Opened all the way down: two XOR and two AND, and the OR
    expect(logicNetwork('fulladder').gates.map((g) => g.kind).sort()).toEqual(['and', 'and', 'or', 'xor', 'xor']);
  });
});

const input = (tag: string, net: string, state: boolean): Part => ({ def: 'logicinput', tag, nets: [net], props: { state: state ? '1' : '0', vdd: '5' } });
const load = (tag: string, net: string): Part => ({ def: 'resistor', tag, nets: [net, '0'], props: { value: '10k' } });

function realtime(parts: Part[]) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  return { engine, compiled: compiled.compiled };
}

async function precise(parts: Part[], stop: string, step: string) {
  const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step, stop, maxStep: step });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  return (id: string, terminal: string) => {
    const values = result.voltages.get(netlist.nodeOf.get(terminalKey(id, terminal))!)!;
    return values[values.length - 1];
  };
}

/** A part with its inputs on logic inputs and a load on each output. */
function bench(id: Part['def'], inputs: boolean[]): Part[] {
  const spice = getDevice(id)!.spice;
  if (spice.kind !== 'logic') throw new Error('not logic');
  return [
    ...spice.inputs.map((pin, k) => input(`IN${k}`, `i${k}`, inputs[k])),
    { def: id, tag: 'U1', nets: [...spice.inputs.map((_, k) => `i${k}`), ...spice.outputs.map((_, j) => `o${j}`)], props: { vdd: '5' } },
    ...spice.outputs.map((_, j) => load(`RL${j}`, `o${j}`)),
  ];
}

/** The voltage of each output of the part U1 in the animation. */
function outputVoltages(engine: RealtimeEngine, compiled: ReturnType<typeof realtime>['compiled']): number[] {
  const device = compiled.devices[compiled.elementIds.indexOf('u1')];
  if (device.kind !== 'logic') throw new Error('not logic');
  return device.outputs.map((node) => engine.nodeVoltage(node));
}

describe('parts made of parts against ngspice', () => {
  it.each([
    ['fulladder', [true, false, true]],
    ['fulladder', [true, true, true]],
    ['mux8', [false, false, false, false, false, true, false, false, true, false, true]],
    ['demux4', [true, true, false]],
  ] as const)('%s with %j gives the same outputs', async (id, inputs) => {
    const parts = bench(id, [...inputs]);
    const { engine, compiled } = realtime(parts);
    const real = outputVoltages(engine, compiled);
    const at = await precise(parts, '10u', '1u');
    const spice = getDevice(id)!.spice;
    if (spice.kind !== 'logic') throw new Error('not logic');
    spice.outputs.forEach((pin, j) => {
      const ng = at('u1', pin);
      expect(Math.round(ng / 5)).toBe((EXPECTED[id]([...inputs]) >> j) & 1);
      expect(real[j]).toBeCloseTo(ng, 3);
    });
  });
});

/** A clock of 1 kHz from 0 to 5 V: rising edges at 0.5, 1.5, 2.5 ms… as the logic reads them. */
const CLOCK: Part = { def: 'vsource', tag: 'VC', nets: ['clk', '0'], props: { shape: 'square', amplitude: '2.5', offset: '2.5', frequency: '1k', phase: '180', duty: '50', spec: '' } };

/** Q after so many simulated seconds, in the animation and in ngspice. */
async function bothQ(parts: Part[], seconds: number) {
  const { engine, compiled } = realtime(parts);
  const h = 1e-6;
  for (let t = 0; t < seconds - h / 2; t += h) engine.step(h);
  const [q, nq] = outputVoltages(engine, compiled);
  const at = await precise(parts, `${seconds * 1e3}m`, '1u');
  return { real: [q, nq].map((v) => Math.round(v / 5)), ng: [at('u1', 'Q'), at('u1', 'nQ')].map((v) => Math.round(v / 5)) };
}

const flipFlop = (def: Part['def'], pins: Record<string, string>): Part => {
  const spice = getDevice(def)!.spice;
  if (spice.kind !== 'logic') throw new Error('not logic');
  return { def, tag: 'U1', nets: [...spice.inputs.map((pin) => pins[pin] ?? '0'), 'q', 'nq'], props: { vdd: '5' } };
};

describe('the flip-flops T, JK and SR', () => {
  it('the rules of the next state', () => {
    const t = sequentialSpec('tff', 0)!;
    expect([t.next(0, [false]), t.next(0, [true]), t.next(1, [true])]).toEqual([0, 1, 0]);
    const jk = sequentialSpec('jkff', 0)!;
    expect([0, 1].flatMap((q) => [[false, false], [false, true], [true, false], [true, true]].map((jk2) => jk.next(q, jk2)))).toEqual([0, 0, 1, 1, 1, 0, 1, 0]);
    const sr = sequentialSpec('srff', 0)!;
    expect([sr.next(0, [true, false]), sr.next(1, [false, true]), sr.next(1, [false, false]), sr.next(1, [true, true]), sr.next(2, [false, false]), sr.next(2, [true, false])]).toEqual([1, 0, 1, 2, 2, 1]);
    expect([0, 1, 2].map(sr.outputs)).toEqual([2, 1, 0]);
  });

  it('T at 1 divides the clock by two, in both engines', async () => {
    const parts: Part[] = [CLOCK, input('IN1', 't', true), flipFlop('tff', { T: 't', CLK: 'clk' }), load('RL', 'q')];
    // Three rising edges by 2.8 ms: Q turned over three times
    expect(await bothQ(parts, 2.8e-3)).toEqual({ real: [1, 0], ng: [1, 0] });
    expect(await bothQ(parts, 1.8e-3)).toEqual({ real: [0, 1], ng: [0, 1] });
  });

  it.each([
    [false, true, [0, 1]],
    [true, false, [1, 0]],
    [true, true, [1, 0]],
  ] as const)('JK with J=%s K=%s after three edges, in both engines', async (j, k, expected) => {
    const parts: Part[] = [CLOCK, input('IN1', 'j', j), input('IN2', 'k', k), flipFlop('jkff', { J: 'j', K: 'k', CLK: 'clk' }), load('RL', 'q')];
    expect(await bothQ(parts, 2.8e-3)).toEqual({ real: [...expected], ng: [...expected] });
  });

  it('JK: reset wins over everything, at once', async () => {
    const parts: Part[] = [CLOCK, input('IN1', 'j', true), input('IN2', 'r', true), flipFlop('jkff', { J: 'j', K: 'j', CLK: 'clk', R: 'r' }), load('RL', 'q')];
    expect(await bothQ(parts, 2.8e-3)).toEqual({ real: [0, 1], ng: [0, 1] });
  });

  it('SR with clock: S = R = 1 on an edge sends both outputs to 0', async () => {
    const parts: Part[] = [CLOCK, input('IN1', 's', true), flipFlop('srff', { S: 's', R: 's', CLK: 'clk' }), load('RL', 'q')];
    expect(await bothQ(parts, 1.8e-3)).toEqual({ real: [0, 0], ng: [0, 0] });
  });

  it.each([
    [true, false, [1, 0]],
    [false, true, [0, 1]],
    [true, true, [0, 0]],
  ] as const)('SR latch with S=%s R=%s, in both engines', async (s, r, expected) => {
    const parts: Part[] = [input('IN1', 's', s), input('IN2', 'r', r), flipFlop('srlatch', { S: 's', R: 'r' }), load('RL', 'q')];
    expect(await bothQ(parts, 10e-6)).toEqual({ real: [...expected], ng: [...expected] });
  });

  it('SR latch: from S = R = 1, the state is what the last input to fall leaves', () => {
    const states = (steps: [boolean, boolean][]) => {
      let previous: RealtimeEngine | null = null;
      let result: number[] = [];
      for (const [s, r] of steps) {
        const { engine, compiled } = realtime([input('IN1', 's', s), input('IN2', 'r', r), flipFlop('srlatch', { S: 's', R: 'r' }), load('RL', 'q')]);
        if (previous) engine.adoptState(previous);
        for (let k = 0; k < 3; k++) engine.step(1e-6);
        result = outputVoltages(engine, compiled).map((v) => Math.round(v / 5));
        previous = engine;
      }
      return result;
    };
    // R falls last: S was the one left, and set
    expect(states([[true, true], [true, false], [false, false]])).toEqual([1, 0]);
    // S falls last: reset
    expect(states([[true, true], [false, true], [false, false]])).toEqual([0, 1]);
    // Set, then nothing: it holds
    expect(states([[true, false], [false, false]])).toEqual([1, 0]);
  });
});
