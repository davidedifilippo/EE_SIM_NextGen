import { describe, expect, it } from 'vitest';
import { formatSpiceValue, parseSpiceValue } from '../netlist/values';
import { terminalKey } from '../netlist/connectivity';
import { computeConnectivity } from '../netlist/connectivity';
import { compileCircuit, parseDiodeModel } from './compile';
import { RealtimeEngine, SolverError } from './engine';
import { circuitFromNets, Part } from './testCircuits';
import { parseWaveform } from './waveform';

const build = (parts: Part[]) => {
  const circuit = circuitFromNets('t', parts);
  const result = compileCircuit(circuit);
  if (!result.ok) throw new Error(result.errors.join());
  const { netOf } = computeConnectivity(circuit);
  const engine = new RealtimeEngine(result.compiled);
  const node = (tag: string, terminal: string) => result.compiled.netIndex.get(netOf.get(terminalKey(tag, terminal))!)!;
  return { engine, node, compiled: result.compiled, circuit };
};

const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const C = (tag: string, a: string, b: string, value: string): Part => ({ def: 'capacitor', tag, nets: [a, b], props: { value } });
const L = (tag: string, a: string, b: string, value: string): Part => ({ def: 'inductor', tag, nets: [a, b], props: { value } });
const V = (tag: string, a: string, b: string, spec: string): Part => ({ def: 'vsource', tag, nets: [a, b], props: { spec } });

describe('values', () => {
  it.each([
    ['1k', 1e3],
    ['4.7meg', 4.7e6],
    ['100u', 1e-4],
    ['1e3', 1e3],
    ['10m', 0.01],
    ['2.2nF', 2.2e-9],
  ])('parses %s', (text, value) => {
    expect(parseSpiceValue(text)).toBeCloseTo(value, 12);
  });

  it('rejects text that is not a number', () => {
    expect(parseSpiceValue('abc')).toBeNull();
    expect(parseSpiceValue('')).toBeNull();
  });

  it.each([
    [4700, '4.7k'],
    [1e-4, '100u'],
    [2.2e6, '2.2meg'],
    [0.5, '500m'],
    [1, '1'],
  ])('formats %d', (value, text) => {
    expect(formatSpiceValue(value)).toBe(text);
  });
});

describe('waveforms', () => {
  it('follows SPICE SIN, holding the value before the delay', () => {
    const w = parseWaveform('SIN(1 2 50 0.01)')!;
    expect(w(0)).toBeCloseTo(1, 9);
    expect(w(0.01 + 0.005)).toBeCloseTo(3, 9);
  });

  it('follows SPICE PULSE across edges and periods', () => {
    const w = parseWaveform('PULSE(0 5 1m 1m 1m 2m 10m)')!;
    expect(w(0)).toBe(0);
    expect(w(1.5e-3)).toBeCloseTo(2.5, 9);
    expect(w(3e-3)).toBe(5);
    expect(w(4.5e-3)).toBeCloseTo(2.5, 9);
    expect(w(8e-3)).toBe(0);
    expect(w(13e-3)).toBe(5);
  });

  it('reads DC specs and rejects unknown ones', () => {
    expect(parseWaveform('DC 5')!(1)).toBe(5);
    expect(parseWaveform('12')!(1)).toBe(12);
    expect(parseWaveform('foo(1)')).toBeNull();
    expect(parseWaveform('SIN(a b)')).toBeNull();
  });
});

describe('parseDiodeModel', () => {
  it('reads the DC parameters', () => {
    const p = parseDiodeModel('.model D D(IS=2.52n RS=0.568 N=1.752 BV=100)');
    expect(p.is).toBeCloseTo(2.52e-9, 15);
    expect(p.rs).toBeCloseTo(0.568, 9);
    expect(p.nvt).toBeCloseTo(1.752 * 0.025865, 9);
  });

  it('uses the SPICE defaults, without confusing similar names', () => {
    const p = parseDiodeModel('.model D D(IBV=1m)');
    expect(p.is).toBe(1e-14);
    expect(p.rs).toBe(0);
    expect(p.nvt).toBeCloseTo(0.025865, 9);
  });
});

describe('RealtimeEngine', () => {
  it('solves a divider, with the source current in SPICE sign', () => {
    const { engine, node, compiled } = build([V('V1', 'in', '0', 'DC 12'), R('R1', 'in', 'out', '1k'), R('R2', 'out', '0', '2k')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('r2', 'a'))).toBeCloseTo(8, 6);
    const source = compiled.devices.findIndex((d) => d.kind === 'vsource');
    expect(engine.deviceCurrent(source)).toBeCloseTo(-4e-3, 8);
  });

  it('charges an RC towards the exact exponential', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'PULSE(0 5 0 1n 1n 1 2)'), R('R1', 'in', 'out', '1k'), C('C1', 'out', '0', '1u')]);
    engine.initialize();
    for (let i = 0; i < 1000; i++) engine.step(1e-6);
    expect(engine.nodeVoltage(node('c1', 'a'))).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
  });

  it('builds current in an RL towards the exact exponential', () => {
    const { engine, compiled } = build([V('V1', 'in', '0', 'PULSE(0 5 0 1n 1n 1 2)'), R('R1', 'in', 'out', '100'), L('L1', 'out', '0', '100m')]);
    engine.initialize();
    for (let i = 0; i < 1000; i++) engine.step(1e-6);
    const inductor = compiled.devices.findIndex((d) => d.kind === 'inductor');
    expect(engine.deviceCurrent(inductor)).toBeCloseTo(0.05 * (1 - Math.exp(-1)), 3);
  });

  it('starts from the DC operating point: capacitor charged, inductor conducting', () => {
    const { engine, node, compiled } = build([V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'out', '100'), L('L1', 'out', 'c', '1m'), C('C1', 'c', '0', '1u'), R('R2', 'c', '0', '100')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('c1', 'a'))).toBeCloseTo(2.5, 6);
    const inductor = compiled.devices.findIndex((d) => d.kind === 'inductor');
    expect(engine.deviceCurrent(inductor)).toBeCloseTo(0.025, 8);
  });

  it('keeps the capacitor charge when a value changes while running', () => {
    const parts = [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'out', '1k'), C('C1', 'out', '0', '1u')];
    const { engine, node } = build(parts);
    engine.initialize();
    const before = engine.nodeVoltage(node('c1', 'a'));

    const changed = compileCircuit(circuitFromNets('t', [parts[0], R('R1', 'in', 'out', '10k'), parts[2]]));
    if (!changed.ok) throw new Error();
    expect(changed.compiled.signature).toBe(engine.compiled.signature);
    const next = new RealtimeEngine(changed.compiled);
    next.adoptState(engine);
    next.step(1e-6);
    expect(next.nodeVoltage(node('c1', 'a'))).toBeCloseTo(before, 3);
    expect(next.time).toBeCloseTo(1e-6, 12);
  });

  it('changes signature when the topology changes', () => {
    const a = compileCircuit(circuitFromNets('t', [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', '0', '1k')]));
    const b = compileCircuit(circuitFromNets('t', [V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'x', '1k'), R('R2', 'x', '0', '1k')]));
    if (!a.ok || !b.ok) throw new Error();
    expect(a.compiled.signature).not.toBe(b.compiled.signature);
  });

  it('survives a node left unconnected', () => {
    const { engine, node } = build([V('V1', 'in', '0', 'DC 5'), R('R1', 'in', 'open', '1k'), C('C1', 'open2', '0', '1u')]);
    engine.initialize();
    expect(engine.nodeVoltage(node('r1', 'b'))).toBeCloseTo(5, 3);
    expect(() => engine.step(1e-6)).not.toThrow();
  });

  it('reports two sources shorted together instead of producing NaN', () => {
    const { engine } = build([V('V1', 'a', '0', 'DC 5'), V('V2', 'a', '0', 'DC 3'), R('R1', 'a', '0', '1k')]);
    expect(() => engine.initialize()).toThrow(SolverError);
  });

  it('asks for a ground', () => {
    const circuit = circuitFromNets('t', [R('R1', 'a', '0', '1k')]);
    circuit.elements = circuit.elements.filter((e) => e.def !== 'ground');
    expect(compileCircuit(circuit)).toEqual({ ok: false, errors: ['Il circuito non ha una massa'] });
  });

  it('collects invalid values', () => {
    const result = compileCircuit(circuitFromNets('t', [R('R1', 'a', '0', 'abc'), V('V1', 'a', '0', 'boh')]));
    expect(result).toEqual({ ok: false, errors: ['R1: valore non valido "abc"', 'V1: sorgente non valida "boh"'] });
  });
});
