import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { EXAMPLES } from '../samples/examples';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { CTR_CLASSES } from './opto';
import { circuitFromNets, Part } from './testCircuits';

const current = (tag: string, into: string, amps: number): Part => ({ def: 'isource', tag, nets: ['0', into], props: { value: String(amps) } });
const source = (tag: string, net: string, volts: number): Part => ({ def: 'vsource', tag, nets: [net, '0'], props: { shape: 'dc', amplitude: String(volts), offset: '0', frequency: '50', phase: '0', duty: '50', spec: '', rint: '0' } });
const opto = (ctr = 'none', [a, k, c, e] = ['a', '0', 'c', '0']): Part => ({ def: 'pc817', tag: 'U1', nets: [a, k, c, e], props: { ctr } });

function operate(parts: Part[]) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const index = compiled.compiled.elementIds.indexOf('u1');
  const [led, , collector] = engine.terminalCurrents(index);
  const d = compiled.compiled.devices[index];
  return { engine, index, led, collector, vf: engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b), vce: engine.deviceCurrent(index) * 0 + (d.kind === 'opto' ? engine.nodeVoltage(d.c) - engine.nodeVoltage(d.e) : NaN) };
}

/** A pin voltage in ngspice at the end of a short run. */
async function ngspice(parts: Part[], terminal: string): Promise<number> {
  const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '1u', stop: '10u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const node = netlist.nodeOf.get(terminalKey('u1', terminal))!;
  const values = result.voltages.get(node)!;
  return node === '0' ? 0 : values[values.length - 1];
}

describe('the PC817 against its datasheet', () => {
  it('the LED: 1.2 V at 20 mA, in both engines', async () => {
    const parts = [current('IF', 'a', 20e-3), opto()];
    const { vf } = operate(parts);
    expect(vf).toBeCloseTo(1.2, 1);
    expect(Math.abs(vf - 1.2)).toBeLessThan(0.04);
    expect(await ngspice(parts, 'A')).toBeCloseTo(vf, 3);
  });

  it.each(CTR_CLASSES.map((c) => [c.value, c.ctr] as const))('class %s: the collector takes CTR times the LED current at 5 mA and 5 V', async (ctr, expected) => {
    // The collector at 5 V through 1 ohm, to read its current in ngspice too
    const parts = [current('IF', 'a', 5e-3), source('VC', 'p', 5), { def: 'resistor', tag: 'RS', nets: ['p', 'c'], props: { value: '1' } } as Part, opto(ctr)];
    const { collector } = operate(parts);
    expect(collector / 5e-3).toBeCloseTo(expected, 2);
    const vc = await ngspice(parts, 'C');
    expect((5 - vc) / 5e-3).toBeCloseTo(expected, 2);
  });

  it('saturates at about 0.1 V with 20 mA in the LED and 1 mA asked of the collector, in both engines', async () => {
    const parts = [current('IF', 'a', 20e-3), source('VC', 'p', 5), { def: 'resistor', tag: 'RL', nets: ['p', 'c'], props: { value: '5k' } } as Part, opto()];
    const { vce, collector } = operate(parts);
    expect(collector).toBeCloseTo(1e-3, 4);
    expect(vce).toBeGreaterThan(0.03);
    expect(vce).toBeLessThan(0.2);
    expect(await ngspice(parts, 'C')).toBeCloseTo(vce, 3);
  });

  it('with the LED off, the output gives only its dark current', () => {
    const { collector } = operate([source('VC', 'c', 20), opto()]);
    expect(Math.abs(collector)).toBeLessThan(100e-9);
  });

  it('says so beyond the absolute maxima', () => {
    const { engine, index } = operate([current('IF', 'a', 60e-3), source('VC', 'c', 5), opto()]);
    expect(engine.optoStatus(index)).toEqual(['LED oltre 50 mA', 'Uscita oltre 50 mA']);
  });
});

describe('the example', () => {
  const run = (closed: string) => {
    const circuit = EXAMPLES.find((e) => e.id === 'opto')!.build();
    circuit.elements = circuit.elements.map((el) => (el.id === 's1' ? { ...el, props: { ...el.props, closed } } : el));
    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    return engine.deviceCurrent(compiled.compiled.elementIds.indexOf('d1'));
  };

  it('the switch on one side lights the LED on the other', () => {
    expect(run('1')).toBeGreaterThan(5e-3);
    expect(Math.abs(run('0'))).toBeLessThan(1e-6);
  });
});
