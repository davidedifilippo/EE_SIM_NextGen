import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from './compile';
import { RealtimeEngine, SolverError } from './engine';
import { circuitFromNets, Part } from './testCircuits';

const battery = (rint: string | undefined): Part => ({ def: 'battery', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: '9', ...(rint === undefined ? {} : { rint }) } });
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });

function realtime(parts: Part[]) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  return { engine, current: (id: string) => engine.deviceCurrent(compiled.compiled.elementIds.indexOf(id)) };
}

describe('internal resistance of a source', () => {
  it('lets a battery in short circuit give E/r', () => {
    // A 1 milliohm resistor stands for the wire of the short
    const { current } = realtime([battery('1'), R('RS', 'p', '0', '1m')]);
    expect(Math.abs(current('rs'))).toBeCloseTo(9 / 1.001, 3);
  });

  it('drops the voltage on a load as a divider would', async () => {
    const parts = [battery('1'), R('RL', 'p', '0', '9')];
    const { current } = realtime(parts);
    expect(Math.abs(current('rl')) * 9).toBeCloseTo(9 * (9 / 10), 6);

    const circuit = circuitFromNets('t', parts);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u', maxStep: '1u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    const load = result.voltages.get(netlist.nodeOf.get(terminalKey('rl', 'a'))!)!;
    expect(load[load.length - 1]).toBeCloseTo(8.1, 4);
  });

  it('is ideal when empty or 0, as in circuits saved before it existed', () => {
    for (const rint of [undefined, '0', '']) {
      const { current } = realtime([battery(rint), R('RL', 'p', '0', '9')]);
      expect(Math.abs(current('rl'))).toBeCloseTo(1, 6);
    }
  });

  it('refuses a negative or unreadable value', () => {
    for (const rint of ['-1', 'abc']) {
      expect(compileCircuit(circuitFromNets('t', [battery(rint), R('RL', 'p', '0', '9')]))).toMatchObject({ ok: false, errors: [expect.stringContaining('resistenza interna non valida')] });
    }
  });

  it('says what to do when an ideal source is shorted', () => {
    const compiled = compileCircuit(circuitFromNets('t', [{ def: 'dcsupply', tag: 'V1', nets: ['0', '0'], props: { shape: 'dc', amplitude: '12', rint: '0' } }, R('RL', '0', '0', '1k')]));
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    expect(() => engine.initialize()).toThrow(SolverError);
    expect(() => engine.initialize()).toThrow(/resistenza interna/);
  });
});
