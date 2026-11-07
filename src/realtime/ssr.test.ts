import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { EXAMPLES } from '../samples/examples';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { LiveSimulation } from './liveSimulation';
import { ssrPartNumber, ssrSpecOf } from './ssr';
import { circuitFromNets, Part } from './testCircuits';

const SOURCE = { offset: '0', frequency: '50', phase: '0', duty: '50', rint: '0' };
const mains = (tag: string, net: string, amplitude = 325): Part => ({ def: 'vsource', tag, nets: [net, '0'], props: { ...SOURCE, shape: 'sin', amplitude: String(amplitude), spec: '' } });
const custom = (tag: string, net: string, spec: string): Part => ({ def: 'vsource', tag, nets: [net, '0'], props: { ...SOURCE, shape: 'custom', amplitude: '0', spec } });
const dc = (tag: string, net: string, volts: number): Part => ({ def: 'vsource', tag, nets: [net, '0'], props: { ...SOURCE, shape: 'dc', amplitude: String(volts), spec: '' } });
const resistor = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const ssr = (type = '1', current = '1', control = '05'): Part => ({ def: 'aqg', tag: 'U1', nets: ['in', '0', 'o', '0'], props: { current, type, control } });

/** The control turns on at 5 ms, at the peak of the first positive half wave. */
const CONTROL_AT_5MS = 'PULSE(0 5 5m 1u 1u 1 2)';
const H = 20e-6;

/** Runs the engine for a while, reading the current of RL at each step. */
function simulate(parts: Part[], stop: number) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const load = compiled.compiled.elementIds.indexOf('rl');
  const index = compiled.compiled.elementIds.indexOf('u1');
  const time: number[] = [];
  const current: number[] = [];
  while (engine.time < stop - H / 2) {
    engine.step(H);
    time.push(engine.time);
    current.push(load >= 0 ? engine.deviceCurrent(load) : NaN);
  }
  return { engine, index, time, current };
}

/** The same in ngspice: the current of RL from the voltages at its ends. */
async function ngspice(parts: Part[], stop: number, ohms: number) {
  const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '10u', stop: String(stop), maxStep: '10u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const at = (terminal: string) => {
    const node = netlist.nodeOf.get(terminalKey('rl', terminal))!;
    return node === '0' ? result.time.map(() => 0) : result.voltages.get(node)!;
  };
  const [a, b] = [at('a'), at('b')];
  return { time: result.time, current: a.map((v, k) => (v - b[k]) / ohms) };
}

const firstAbove = ({ time, current }: { time: number[]; current: number[] }, amps: number) => time[current.findIndex((i) => Math.abs(i) > amps)];
const lastAbove = ({ time, current }: { time: number[]; current: number[] }, amps: number) => time[current.length - 1 - [...current].reverse().findIndex((i) => Math.abs(i) > amps)];

describe('the AQ-G against its catalogue', () => {
  it('names each version as its part number', () => {
    expect(ssrPartNumber({ current: '1', type: '1', control: '05' })).toBe('AQG12105');
    expect(ssrPartNumber({ current: '2', type: '2', control: '24' })).toBe('AQG22224');
    expect(ssrSpecOf({ control: '12' }).inputResistance).toBe(800);
  });

  it('the input: its impedance, active from 4 V, let go only below 1 V', () => {
    const at = (spec: string, stop: number) => {
      const { engine, index } = simulate([custom('VI', 'in', spec), ssr()], stop);
      return { status: engine.ssrStatus(index)!, input: engine.terminalCurrents(index)[0] };
    };
    const five = at('DC 5', 1e-3);
    expect(five.input).toBeCloseTo(5 / 300, 6);
    expect(five.status.isControlled).toBe(true);
    expect(at('DC 3.5', 1e-3).status.isControlled).toBe(false);
    // Up to 5 V, then down to 2 V: still active; then to 0.5 V: let go
    expect(at('PULSE(5 2 1m 1u 1u 1 2)', 3e-3).status.isControlled).toBe(true);
    expect(at('PULSE(5 0.5 1m 1u 1u 1 2)', 3e-3).status.isControlled).toBe(false);
  });

  it('random: the load current starts within 1 ms of the control, in both engines', async () => {
    const parts = [custom('VI', 'in', CONTROL_AT_5MS), ssr('2'), mains('VM', 'ac'), resistor('RL', 'ac', 'o', '330')];
    const start = firstAbove(simulate(parts, 0.012), 0.1);
    expect(start).toBeGreaterThan(5e-3);
    expect(start).toBeLessThan(6e-3);
    expect(firstAbove(await ngspice(parts, 0.012, 330), 0.1)).toBeCloseTo(start, 3);
  });

  it('zero-cross: the load current waits for the next zero of the mains, within half a cycle and 1 ms, in both engines', async () => {
    const parts = [custom('VI', 'in', CONTROL_AT_5MS), ssr('1'), mains('VM', 'ac'), resistor('RL', 'ac', 'o', '330')];
    const start = firstAbove(simulate(parts, 0.015), 0.1);
    // The mains crosses zero at 10 ms; 0.1 A in 330 ohms is 33 V, a little after
    expect(start).toBeGreaterThan(9.5e-3);
    expect(start).toBeLessThan(11e-3);
    expect(firstAbove(await ngspice(parts, 0.015, 330), 0.1)).toBeCloseTo(start, 3);
  });

  it('let go mid half wave, the triac carries on to the zero of its current, in both engines', async () => {
    // Random, controlled from 1 ms to 15 ms: the peak of the negative half wave
    const parts = [custom('VI', 'in', 'PULSE(0 5 1m 1u 1u 14m 1)'), ssr('2'), mains('VM', 'ac'), resistor('RL', 'ac', 'o', '330')];
    const run = simulate(parts, 0.03);
    const end = lastAbove(run, 0.05);
    expect(end).toBeGreaterThan(19e-3);
    expect(end).toBeLessThan(20.5e-3);
    expect(lastAbove(await ngspice(parts, 0.03, 330), 0.05)).toBeCloseTo(end, 3);
  });

  it('off, about 1 mA through the snubber at 230 V and 50 Hz, under the 1.5 mA of the catalogue', () => {
    const { current } = simulate([dc('VI', 'in', 0), ssr(), mains('VM', 'ac'), resistor('RL', 'ac', 'o', '1k')], 0.06);
    const rms = Math.sqrt(current.slice(-1000).reduce((sum, i) => sum + i * i, 0) / 1000);
    expect(rms).toBeGreaterThan(0.8e-3);
    expect(rms).toBeLessThan(1.5e-3);
  });

  it.each([
    ['1', 1],
    ['2', 2],
  ])('on, at most 1.6 V across the %s A version at its rated current', (version, amps) => {
    const { engine, index } = simulate([dc('VI', 'in', 5), ssr('2', version), dc('VD', 'ac', 100), resistor('RL', 'ac', 'o', String(100 / amps))], 1e-3);
    const d = engine.compiled.devices[index];
    if (d.kind !== 'ssr') throw new Error('not a relay');
    const drop = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.d);
    expect(drop).toBeGreaterThan(0.5);
    expect(drop).toBeLessThanOrEqual(1.6 + 1e-6);
  });

  it('a cold lamp takes a higher inrush with random than with zero-cross', () => {
    const inrush = (type: string) => {
      const lamp: Part = { def: 'lamp', tag: 'RL', nets: ['ac', 'o'], props: { power: '60', volts: '230' } };
      const { current } = simulate([custom('VI', 'in', CONTROL_AT_5MS), ssr(type), mains('VM', 'ac'), lamp], 0.04);
      return Math.max(...current.map(Math.abs));
    };
    const [zeroCross, random] = [inrush('1'), inrush('2')];
    // Hot, the lamp takes 0.37 A at the peak
    expect(zeroCross).toBeGreaterThan(0.37 * 3);
    expect(random).toBeGreaterThan(zeroCross * 1.2);
  });

  it('warns below the minimum load current and beyond the surge current', () => {
    const warnings = (ohms: string) => {
      const { engine, index } = simulate([dc('VI', 'in', 5), ssr('2'), mains('VM', 'ac'), resistor('RL', 'ac', 'o', ohms)], 0.04);
      return engine.ssrStatus(index)!.warnings;
    };
    expect(warnings('330')).toEqual([]);
    expect(warnings('100k')).toEqual(['Carico sotto 20 mA']);
    expect(warnings('10')).toContain('Picco oltre 8 A');
  });
});

describe('the example', () => {
  it('lights the lamp with S1 closed, and leaves it dark open', () => {
    const run = (closed: string) => {
      const circuit = EXAMPLES.find((e) => e.id === 'ssr')!.build();
      circuit.elements = circuit.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, closed } } : el));
      const compiled = compileCircuit(circuit);
      if (!compiled.ok) throw new Error(compiled.errors.join());
      const engine = new RealtimeEngine(compiled.compiled);
      engine.initialize();
      const lamp = compiled.compiled.elementIds.indexOf('lp1');
      let sum = 0;
      let count = 0;
      while (engine.time < 0.5) {
        engine.step(H);
        if (engine.time > 0.4) {
          sum += engine.deviceCurrent(lamp) ** 2;
          count++;
        }
      }
      return Math.sqrt(sum / count);
    };
    // 60 W at 230 V: 0.26 A
    expect(run('1')).toBeCloseTo(60 / 230, 1);
    expect(run('0')).toBeLessThan(2e-3);
  });
});

describe('the lamp of the example in the animation', () => {
  it('reads 230 V RMS even when each frame holds only a slice of a period', () => {
    const circuit = EXAMPLES.find((e) => e.id === 'ssr')!.build();
    circuit.elements = circuit.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, closed: '1' } } : el));
    const sim = new LiveSimulation();
    expect(sim.load(circuit)).toEqual({ ok: true });
    const lamp = circuit.elements.filter((e) => e.def !== 'ground').findIndex((e) => e.id === 'lp1');
    let highest = 0;
    let lowest = Infinity;
    // Frames 0.7 ms apart, as at 20 ms/s; read after the first 0.3 s, while the reading settles
    for (let k = 0; k < 600; k++) {
      sim.advance(35, 2e-5, 1e6);
      const rms = sim.frame()!.lampRms[lamp];
      if (k < 430) continue;
      highest = Math.max(highest, rms);
      lowest = Math.min(lowest, rms);
    }
    expect(highest).toBeLessThan(230 * 1.05);
    expect(lowest).toBeGreaterThan(230 * 0.95);
  });
});
