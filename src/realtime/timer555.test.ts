import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { Circuit } from '../model/types';
import { EXAMPLES } from '../samples/examples';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { automaticSpeed, generatorFrequencies } from './liveRate';
import { nextTimerState, NE555, timerEstimate } from './timer555';

const example = (id: string, changes: Record<string, Record<string, string>> = {}, def?: string): Circuit => {
  const circuit = EXAMPLES.find((e) => e.id === id)!.build();
  circuit.elements = circuit.elements.map((el) => ({ ...el, def: el.id === 'u1' && def ? def : el.def, props: { ...el.props, ...(changes[el.id] ?? {}) } }));
  return circuit;
};

/** Rising and falling edges through a level. */
function edges(times: ArrayLike<number>, values: ArrayLike<number>, level: number) {
  const rising: number[] = [];
  const falling: number[] = [];
  for (let k = 1; k < values.length; k++) {
    if (values[k - 1] < level && values[k] >= level) rising.push(times[k]);
    if (values[k - 1] >= level && values[k] < level) falling.push(times[k]);
  }
  return { rising, falling };
}

function engineOf(circuit: Circuit) {
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const index = compiled.compiled.elementIds.indexOf('u1');
  return { engine, index, out: () => engine.nodeVoltage(compiled.compiled.devices[index].a) };
}

/** OUT of U1 over a time in the animation. */
function run(circuit: Circuit, seconds: number, h: number, from?: RealtimeEngine) {
  const { engine, index, out } = engineOf(circuit);
  if (from) engine.adoptState(from);
  const times: number[] = [];
  const values: number[] = [];
  const end = engine.time + seconds;
  while (engine.time < end - h / 2) {
    engine.step(h);
    times.push(engine.time);
    values.push(out());
  }
  return { engine, index, times, values };
}

async function precise(circuit: Circuit, stop: string, step: string) {
  const netlist = generateNetlist(circuit, { type: 'tran', step, stop, maxStep: step });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  return { time: result.time, at: (id: string, terminal: string) => result.voltages.get(netlist.nodeOf.get(terminalKey(id, terminal))!)! };
}

/** Period and duty after the first cycle, which starts from an empty capacitor. */
function cycle(times: ArrayLike<number>, values: ArrayLike<number>, level: number) {
  const { rising, falling } = edges(times, values, level);
  // The first edge is the start, with the capacitor empty: the cycles count from the second
  const steady = rising.slice(1);
  const period = (steady[steady.length - 1] - steady[0]) / (steady.length - 1);
  const fall = falling.find((t) => t > steady[0])!;
  return { period, duty: (fall - steady[0]) / period };
}

describe('the rules of the flip-flop', () => {
  const at = (trig: number, thr: number, reset = 5) => ({ trig, thr, ctrl: 10 / 3, lower: 5 / 3, reset });
  it('TRIG sets, THR clears, TRIG wins over THR, RESET wins over all', () => {
    expect(nextTimerState(NE555, false, at(1, 0))).toBe(true);
    expect(nextTimerState(NE555, true, at(3, 4))).toBe(false);
    expect(nextTimerState(NE555, true, at(3, 2))).toBe(true);
    expect(nextTimerState(NE555, false, at(1, 4))).toBe(true);
    expect(nextTimerState(NE555, true, at(1, 0, 0.2))).toBe(false);
  });
});

describe('the 555 as an astable', () => {
  // With 68 nF in place of 10 µF: about 140 Hz, quick to simulate
  const fast = () => example('astable', { c1: { value: '68n' } });
  const expected = { period: Math.LN2 * (1e3 + 2 * 75e3) * 68e-9, duty: 76 / 151 };

  it('oscillates as the formula of the books says, and as ngspice', async () => {
    const real = run(fast(), 40e-3, 2e-6);
    const r = cycle(real.times, real.values, 2);
    expect(Math.abs(r.period - expected.period) / expected.period).toBeLessThan(0.03);
    expect(r.duty).toBeCloseTo(expected.duty, 1);
    const { time, at } = await precise(fast(), '40m', '2u');
    const n = cycle(time, at("u1", "OUT"), 2);
    expect(Math.abs(r.period - n.period) / n.period).toBeLessThan(0.02);
    expect(Math.abs(r.duty - n.duty)).toBeLessThan(0.02);
  });

  it('the capacitor swings between a third and two thirds of the supply', () => {
    const { engine, index } = run(fast(), 20e-3, 2e-6);
    const compiled = compileCircuit(fast());
    if (!compiled.ok) throw new Error();
    const device = compiled.compiled.devices[index];
    if (device.kind !== 'timer') throw new Error();
    let [low, high] = [Infinity, -Infinity];
    for (let k = 0; k < 4000; k++) {
      engine.step(2e-6);
      const v = engine.nodeVoltage(device.thr);
      [low, high] = [Math.min(low, v), Math.max(high, v)];
    }
    expect(low).toBeCloseTo(5 / 3, 1);
    expect(high).toBeCloseTo(10 / 3, 1);
  });

  it('the NE555 gives the supply less its drop, the TLC555 almost the supply', () => {
    for (const [def, high] of [['ne555', 3.75], ['tlc555', 4.75]] as const) {
      // A light load: the TLC555 gives little current when high
      const { out, engine, index } = engineOf(example('astable', { r3: { value: '10k' } }, def));
      // At the start the capacitor is empty: OUT goes high at once, into the LED
      for (let k = 0; k < 3; k++) engine.step(1e-6);
      expect(out()).toBeGreaterThan(high - 0.5);
      expect(out()).toBeLessThan(high + 0.3);
      expect(engine.timerStatus(index)?.isHigh).toBe(true);
    }
  });

  it('is recognized, with its frequency and duty, and runs in real time at 1 Hz', () => {
    const circuit = example('astable');
    const estimate = timerEstimate(circuit, circuit.elements.find((el) => el.id === 'u1')!);
    expect(estimate?.kind).toBe('astable');
    if (estimate?.kind !== 'astable') return;
    expect(estimate.frequency).toBeCloseTo(1 / (Math.LN2 * 151e3 * 10e-6), 6);
    expect(estimate.duty).toBeCloseTo(76 / 151, 6);
    expect(generatorFrequencies(circuit)).toEqual([estimate.frequency]);
    expect(automaticSpeed(1 / estimate.frequency)).toBe(1);
  });
});

describe('the 555 as a monostable', () => {
  // With 100 nF in place of 10 µF: a pulse of 11 ms
  const withButton = (pressed: string) => example('monostable', { c1: { value: '100n' }, s1: { pressed } });

  it('rests low, and a press gives a pulse of 1.1 RC, as in ngspice', async () => {
    const rest = engineOf(withButton('0'));
    expect(rest.out()).toBeLessThan(0.5);
    const pressed = run(withButton('1'), 1e-3, 2e-6, rest.engine);
    const released = run(withButton('0'), 20e-3, 2e-6, pressed.engine);
    const times = [...pressed.times, ...released.times];
    const values = [...pressed.values, ...released.values];
    const { rising, falling } = edges(times, values, 2);
    const width = falling[0] - rising[0];
    const expected = Math.log(3) * 100e3 * 100e-9;
    expect(Math.abs(width - expected) / expected).toBeLessThan(0.03);
    const estimate = timerEstimate(withButton('0'), withButton('0').elements.find((el) => el.id === 'u1')!);
    expect(estimate?.kind).toBe('monostable');
    if (estimate?.kind === 'monostable') expect(estimate.duration).toBeCloseTo(expected, 9);
    // The real pulse of 1.1 s runs in real time
    const real = example('monostable');
    expect(automaticSpeed(1 / Math.max(...generatorFrequencies(real)))).toBe(1);
  });

  it('RESET to ground holds the output low and the discharge on', () => {
    const circuit = example('astable');
    // RESET taken off the rail and to the ground below
    circuit.wires = circuit.wires.map((w) => (w.id === 'wreset' ? { ...w, pts: [{ x: 20, y: -60 }, { x: 20, y: -40 }] } : w));
    circuit.elements.push({ id: 'gr', def: 'ground', x: 20, y: -40, rot: 0, tag: '', props: {} });
    const { out } = engineOf(circuit);
    expect(out()).toBeLessThan(0.1);
  });
});

describe('the limits of the datasheet', () => {
  it('a supply out of range and an output into a short say so', () => {
    const low = example('astable', { v1: { amplitude: '3' } });
    const { engine, index } = engineOf(low);
    expect(engine.timerStatus(index)?.warnings).toEqual(['Alimentazione fuori campo']);
    const shorted = example('astable', { r3: { value: '1' }, v1: { amplitude: '15' } });
    const s = engineOf(shorted);
    for (let k = 0; k < 3; k++) s.engine.step(1e-6);
    expect(s.engine.timerStatus(s.index)?.warnings).toEqual(['OUT oltre 200 mA']);
    const tlc = engineOf(example('astable', { v1: { amplitude: '3' } }, 'tlc555'));
    expect(tlc.engine.timerStatus(tlc.index)?.warnings).toEqual([]);
  });
});
