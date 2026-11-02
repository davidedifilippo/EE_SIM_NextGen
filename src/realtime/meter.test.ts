import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { LiveSimulation } from './liveSimulation';
import { canRotate, createElement, elementSymbol, getDevice } from '../library/devices';
import { parseCircuitFile, serializeCircuit } from '../storage/circuitFile';
import { MeterWindow, meterResistance, meterText, meterValue, readingWindow, slowestPeriod } from './meter';
import { circuitFromNets, Part } from './testCircuits';

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const meter = (a: string, b: string, mode: string): Part => ({ def: 'multimeter', tag: 'MM1', nets: [a, b], props: { mode } });
const source = (props: Record<string, string>): Part => ({ def: 'vsource', tag: 'V1', nets: ['in', '0'], props: { shape: 'dc', amplitude: '10', offset: '0', frequency: '50', phase: '0', duty: '50', spec: '', ...props } });
const SINE = { shape: 'sin', amplitude: '10' };
const V_SOURCE = source({});

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
    expect(meterValue('xyz', { mean: 1, ac: 1 })).toBeNaN();
    expect(meterResistance('xyz')).toBeNull();
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

describe('as an ohmmeter', () => {
  const ohms = (parts: Part[]) => {
    const circuit = circuitFromNets('t', parts);
    const simulation = new LiveSimulation();
    expect(simulation.load(circuit)).toEqual({ ok: true });
    simulation.advance(2400, 1e-5, 1e9);
    const frame = simulation.frame()!;
    const index = circuit.elements.filter((el) => el.def !== 'ground').findIndex((el) => el.def === 'multimeter');
    return { mean: frame.meterMean[index], ac: frame.meterAc[index] };
  };
  const format = (value: number, unit: string) => `${value.toPrecision(3)} ${unit}`;

  it.each([
    ['one resistor', [R('R1', 'x', '0', '1k')], 1000],
    ['two in series', [R('R1', 'x', 'y', '4.7k'), R('R2', 'y', '0', '1k')], 5700],
    ['two in parallel', [R('R1', 'x', '0', '1k'), R('R2', 'x', '0', '1k')], 500],
  ] as [string, Part[], number][])('reads %s', (_, parts, expected) => {
    const reading = ohms([meter('x', '0', 'ohm'), ...parts]);
    expect(meterValue('ohm', reading)).toBeCloseTo(expected, 0);
  });

  it('says OL with nothing connected', () => {
    expect(meterText('ohm', ohms([meter('x', '0', 'ohm')]), format)).toBe('OL');
  });

  it('writes the value with its unit otherwise', () => {
    expect(meterText('ohm', ohms([meter('x', '0', 'ohm'), R('R1', 'x', '0', '1k')]), format)).toBe('1.00e+3 Ω');
  });

  it('gives the same voltage in ngspice, from the red socket', async () => {
    const circuit = circuitFromNets('t', [meter('x', '0', 'ohm'), R('R1', 'x', '0', '1k')]);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    expect(result.voltages.get(netlist.nodeOf.get(terminalKey('r1', 'a'))!)![result.time.length - 1]).toBeCloseTo(1, 3);
  });
});

describe('the compact one', () => {
  const pair = (def: 'multimeter' | 'multimetercompact', mode: string, nets: [string, string]): Part => ({ def, tag: 'MM1', nets, props: { mode } });
  const readWith = (def: 'multimeter' | 'multimetercompact', mode: string, nets: [string, string], source: Record<string, string>) => {
    const circuit = circuitFromNets('t', [source.none ? R('R9', 'in', '0', '1k') : { ...V_SOURCE, props: { ...V_SOURCE.props, ...source } }, R('R1', 'in', 'x', '1k'), R('R2', 'x', '0', '1k'), pair(def, mode, nets)]);
    const simulation = new LiveSimulation();
    expect(simulation.load(circuit)).toEqual({ ok: true });
    const h = 20e-3 / 2400;
    simulation.advance(Math.round(0.2 / h), h, 1e9);
    const frame = simulation.frame()!;
    const index = circuit.elements.filter((el) => el.def !== 'ground').findIndex((el) => el.tag === 'MM1');
    return meterValue(mode, { mean: frame.meterMean[index], ac: frame.meterAc[index] });
  };

  it.each([
    ['vdc', ['x', '0'], {}],
    ['vac', ['x', '0'], { shape: 'sin' }],
    ['ohm', ['x', '0'], { none: '1' }],
  ] as [string, [string, string], Record<string, string>][])('reads %s like the full instrument', (mode, nets, source) => {
    expect(readWith('multimetercompact', mode, nets, source)).toBeCloseTo(readWith('multimeter', mode, nets, source), 3);
  });

  it('can rotate, and has its pins on the sides', () => {
    const def = getDevice('multimetercompact')!;
    expect(canRotate(def)).toBe(true);
    expect(canRotate(getDevice('multimeter'))).toBe(false);
    expect(def.terminals.map((t) => t.y)).toEqual([0, 0]);
    expect(elementSymbol(def, { id: 'm', def: def.id, x: 0, y: 0, rot: 0, tag: 'MM1', props: { mode: 'ohm' } })).toBe(def.symbol);
  });
});

describe('the instrument', () => {
  const symbol = (mode: string) => JSON.stringify(elementSymbol(getDevice('multimeter')!, { id: 'm', def: 'multimeter', x: 0, y: 0, rot: 0, tag: 'MM1', props: { mode } }));

  it('moves the pointer of the dial with the mode', () => {
    expect(symbol('vdc')).not.toBe(symbol('ohm'));
  });

  it('does not rotate, when placed or read from a file', () => {
    const empty = { title: 't', elements: [], wires: [], models: [] };
    const placed = createElement(getDevice('multimeter')!, { x: 0, y: 0 }, 90, empty, 'm');
    expect(placed.rot).toBe(0);
    expect(createElement(getDevice('resistor')!, { x: 0, y: 0 }, 90, empty, 'r').rot).toBe(90);
    const saved = serializeCircuit({ ...empty, elements: [{ ...placed, rot: 90 }] });
    expect(parseCircuitFile(saved).elements[0].rot).toBe(0);
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
    const circuit = circuitFromNets('t', [source({}), meter('in', '0', 'xyz'), R('R1', 'in', '0', '1k')]);
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).errors).toEqual(['MM1: misura non valida "xyz"']);
  });
});
