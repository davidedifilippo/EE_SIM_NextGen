import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { LiveSimulation } from './liveSimulation';
import { MeterWindow, meterResistance, meterValue, readingWindow, slowestPeriod } from './meter';
import { circuitFromNets, Part } from './testCircuits';

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const meter = (a: string, b: string, mode: string): Part => ({ def: 'multimeter', tag: 'MM1', nets: [a, b], props: { mode } });
const source = (props: Record<string, string>): Part => ({ def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'dc', amplitude: '10', offset: '0', frequency: '50', phase: '0', duty: '50', spec: '', ...props } });
const SINE = { shape: 'sin', amplitude: '10' };

/** The display after some seconds of simulated time, at a speed of the animation. */
function read(parts: Part[], mode: string, seconds = 0.2, h = 20e-3 / 2400) {
  const circuit = circuitFromNets('t', parts);
  const simulation = new LiveSimulation();
  expect(simulation.load(circuit)).toEqual({ ok: true });
  simulation.advance(Math.round(seconds / h), h, 1e9);
  const frame = simulation.frame()!;
  const index = circuit.elements.filter((el) => el.def !== 'ground').findIndex((el) => el.def === 'multimeter');
  return meterValue(mode, { mean: frame.meterMean[index], ac: frame.meterAc[index] });
}

describe('MeterWindow', () => {
  it('has nothing to say before the first step', () => {
    expect(new MeterWindow().reading).toBeNull();
  });

  it('shows what there is until the first window ends, then holds it', () => {
    const window = new MeterWindow();
    window.add(2, 1, 4);
    expect(window.reading).toEqual({ mean: 2, ac: 0 });
    window.add(2, 1, 4);
    window.add(2, 1, 4);
    window.add(2, 1, 4);
    window.add(100, 1, 4);
    expect(window.reading).toEqual({ mean: 2, ac: 0 });
  });

  it('keeps the value through a restart', () => {
    const window = new MeterWindow();
    window.add(2, 1, 1);
    window.restart();
    expect(window.reading?.mean).toBe(2);
  });

  it('separates the mean from what alternates', () => {
    const window = new MeterWindow();
    [3, 7].forEach((v) => window.add(v, 1, 2));
    expect(window.reading).toEqual({ mean: 5, ac: 2 });
  });
});

describe('readingWindow', () => {
  it('is whole periods, however fast the animation', () => {
    expect(readingWindow(0.02, 1e-6)).toBeCloseTo(0.02, 12);
    expect(readingWindow(1e-3, 1e-4)).toBeCloseTo(0.024, 12);
  });

  it('is a tenth of a second of animation without a period', () => {
    expect(readingWindow(null, 1e-4)).toBeCloseTo(0.024, 12);
  });
});

describe('slowestPeriod', () => {
  it('finds the slowest generator and ignores the steady ones', () => {
    const second: Part = { def: 'vsource', tag: 'V2', nets: ['x', '0'], props: { shape: 'sin', amplitude: '1', offset: '0', frequency: '10', phase: '0', duty: '50', spec: '' } };
    expect(slowestPeriod(circuitFromNets('t', [source(SINE), R('R1', 'in', '0', '1k'), second, R('R2', 'x', '0', '1k')]))).toBeCloseTo(0.1, 9);
    expect(slowestPeriod(circuitFromNets('t', [source({}), R('R1', 'in', '0', '1k')]))).toBeNull();
  });
});

describe('meterValue', () => {
  it('gives zero for what is left of a whole period and for noise', () => {
    expect(meterValue('vdc', { mean: 1e-5, ac: 7 })).toBe(0);
    expect(meterValue('vdc', { mean: 1e-7, ac: 0 })).toBe(0);
    expect(meterValue('adc', { mean: 1e-10, ac: 0 })).toBe(0);
    expect(meterValue('adc', { mean: 2e-6, ac: 0 })).toBe(2e-6);
  });

  it('has no value for a mode that does not exist', () => {
    expect(meterValue('ohm', { mean: 1, ac: 1 })).toBeNaN();
    expect(meterResistance('ohm')).toBeNull();
  });
});

describe('reading a circuit, against the formulas', () => {
  const divider = (m: Part, props = {}) => [source(props), R('R1', 'in', 'x', '1k'), R('R2', 'x', '0', '1k'), m];

  it('a voltage between two points that are not ground', () => {
    expect(read(divider(meter('in', 'x', 'vdc')), 'vdc')).toBeCloseTo(5, 3);
  });

  it('with the leads swapped, the sign changes', () => {
    expect(read(divider(meter('x', 'in', 'vdc')), 'vdc')).toBeCloseTo(-5, 3);
  });

  it('a sine: its RMS, and no continuous part', () => {
    expect(read(divider(meter('in', '0', 'vac'), SINE), 'vac')).toBeCloseTo(10 / Math.SQRT2, 2);
    expect(read(divider(meter('in', '0', 'vdc'), SINE), 'vdc')).toBe(0);
  });

  it('with an offset: each reads its own part', () => {
    const offset = { ...SINE, offset: '3' };
    expect(read(divider(meter('in', '0', 'vdc'), offset), 'vdc')).toBeCloseTo(3, 2);
    expect(read(divider(meter('in', '0', 'vac'), offset), 'vac')).toBeCloseTo(10 / Math.SQRT2, 2);
  });

  it('a current in series, with its sign', () => {
    const series = (a: string, b: string, mode: string, props = {}) => [source(props), meter(a, b, mode), R('R1', 'y', '0', '1k')];
    expect(read(series('in', 'y', 'adc'), 'adc')).toBeCloseTo(10e-3, 5);
    expect(read(series('y', 'in', 'adc'), 'adc')).toBeCloseTo(-10e-3, 5);
    expect(read(series('in', 'y', 'aac', SINE), 'aac')).toBeCloseTo(10e-3 / Math.SQRT2, 5);
  });

  it('holds at other speeds and frequencies', () => {
    const sine = { ...SINE, frequency: '1k' };
    expect(read(divider(meter('in', '0', 'vac'), sine), 'vac', 0.02, 1e-3 / 2400)).toBeCloseTo(10 / Math.SQRT2, 2);
    expect(read(divider(meter('in', '0', 'vac'), sine), 'vac', 0.2, 5e-3 / 2400)).toBeCloseTo(10 / Math.SQRT2, 2);
  });
});

describe('it does not disturb what it measures', () => {
  it('as a voltmeter, on a divider of a megaohm', () => {
    const parts = [source({}), R('R1', 'in', 'x', '1meg'), R('R2', 'x', '0', '1meg'), meter('x', '0', 'vdc')];
    expect(Math.abs(read(parts, 'vdc') - 5) / 5).toBeLessThan(1e-3);
  });

  it('as an ammeter, in series with a kiloohm', () => {
    const parts = [source({}), meter('in', 'y', 'adc'), R('R1', 'y', '0', '1k')];
    expect(Math.abs(read(parts, 'adc') - 10e-3) / 10e-3).toBeLessThan(1e-5);
  });
});

describe('in the precise analysis', () => {
  it('is the same resistance, and gives the same values', async () => {
    const circuit = circuitFromNets('t', [source({}), meter('in', 'y', 'adc'), R('R1', 'y', '0', '1k'), { ...meter('y', '0', 'vdc'), tag: 'MM2' }]);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    expect(netlist.text).toMatch(/^RMM1 \S+ \S+ 0\.001$/m);
    expect(netlist.text).toMatch(/^RMM2 \S+ \S+ 1000000000$/m);
    const result = await runTransient(netlist.text);
    const r1 = circuit.elements.find((el) => el.tag === 'R1')!;
    expect(result.voltages.get(netlist.nodeOf.get(terminalKey(r1.id, 'a'))!)![result.time.length - 1]).toBeCloseTo(10, 3);
  });

  it('refuses a mode that does not exist', () => {
    const circuit = circuitFromNets('t', [source({}), meter('in', '0', 'ohm'), R('R1', 'in', '0', '1k')]);
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).errors).toEqual(['MM1: misura non valida "ohm"']);
  });
});
