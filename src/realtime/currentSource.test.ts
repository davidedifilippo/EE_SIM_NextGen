import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { circuitFromNets, Part } from './testCircuits';

const I = (a: string, b: string, value: string): Part => ({ def: 'isource', tag: 'I1', nets: [a, b], props: { value } });
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });
const C = (tag: string, a: string, b: string, value: string): Part => ({ def: 'capacitor', tag, nets: [a, b], props: { value } });

const start = (parts: Part[]) => {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const devices = compiled.compiled.devices;
  const voltage = (tag: string) => {
    const index = compiled.compiled.elementIds.indexOf(tag);
    const d = devices[index];
    return engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b);
  };
  return { engine, voltage, index: compiled.compiled.elementIds.indexOf('i1') };
};

describe('the current source', () => {
  it('pushes its current in the direction of the arrow: from a through it to b', () => {
    expect(start([I('0', 'x', '10m'), R('R1', 'x', '0', '1k')]).voltage('r1')).toBeCloseTo(10, 4);
    expect(start([I('x', '0', '10m'), R('R1', 'x', '0', '1k')]).voltage('r1')).toBeCloseTo(-10, 4);
  });

  it('takes a negative value, against the arrow', () => {
    expect(start([I('0', 'x', '-10m'), R('R1', 'x', '0', '1k')]).voltage('r1')).toBeCloseTo(-10, 4);
  });

  it('keeps its current whatever the load', () => {
    for (const load of ['1', '100', '10k']) {
      const { engine, index } = start([I('0', 'x', '2m'), R('R1', 'x', '0', load)]);
      expect(engine.deviceCurrent(index)).toBe(2e-3);
    }
  });

  it('runs with an open end, as during drawing', () => {
    const { engine } = start([I('0', 'x', '1m')]);
    engine.step(1e-5);
    expect(Number.isFinite(engine.time)).toBe(true);
  });

  it('refuses a value that is not a number', () => {
    const circuit = circuitFromNets('t', [I('0', 'x', 'abc'), R('R1', 'x', '0', '1k')]);
    expect(compileCircuit(circuit)).toEqual({ ok: false, errors: ['I1: valore non valido "abc"'] });
    expect(generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u' }).errors).toEqual(['I1: valore non valido "abc"']);
  });

  it('gives the same values in ngspice, on a divider with a capacitor', async () => {
    const parts = [I('0', 'x', '5m'), R('R1', 'x', 'y', '1k'), R('R2', 'y', '0', '2k'), C('C1', 'y', '0', '1u')];
    const circuit = circuitFromNets('t', parts);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '10u', stop: '10m', maxStep: '10u' });
    expect(netlist.errors).toEqual([]);
    expect(netlist.text).toMatch(/^I1 \S+ \S+ DC 5m$/m);
    const spice = await runTransient(netlist.text);
    const series = spice.voltages.get(netlist.nodeOf.get(terminalKey('r2', 'a'))!)!;

    const { engine, voltage } = start(parts);
    for (let k = 0; k < 1000; k++) engine.step(10e-6);
    expect(voltage('r2')).toBeCloseTo(series[series.length - 1], 2);
    expect(voltage('r2')).toBeCloseTo(10, 2);
  });
});
