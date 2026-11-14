import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { circuitFromNets, Part } from '../realtime/testCircuits';

/**
 * The TIP120 against its datasheet (onsemi): hFE at least 1000 at 3 A and 3 V, VBE(on) at most 2.5 V there,
 * VCE(sat) at most 2 V at 3 A with 12 mA of base current; and a Darlington never saturates below the VBE of
 * its output transistor. The same in both engines.
 */
const dc = (volts: string) => ({ shape: 'dc', amplitude: volts, rint: '0' });

/** The collector held at a voltage through a load, the base fed with a current; the voltages at C and B. */
async function operatingPoint(supply: string, load: string, base: string) {
  const parts: Part[] = [
    { def: 'dcsupply', tag: 'V1', nets: ['vcc', '0'], props: dc(supply) },
    { def: 'resistor', tag: 'RL', nets: ['vcc', 'c'], props: { value: load } },
    { def: 'isource', tag: 'IB', nets: ['0', 'b'], props: { value: base } },
    { def: 'tip120', tag: 'Q1', nets: ['c', 'b', '0'], props: {} },
  ];
  const circuit = circuitFromNets('t', parts);
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const rl = compiled.compiled.devices[compiled.compiled.elementIds.indexOf('rl')];
  const real = { c: engine.nodeVoltage(rl.b), b: NaN };
  const netlist = generateNetlist(circuit, { type: 'tran', step: '1u', stop: '10u', maxStep: '1u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const last = (id: string, t: string) => {
    const v = result.voltages.get(netlist.nodeOf.get(terminalKey(id, t))!)!;
    return v[v.length - 1];
  };
  return { real, ng: { c: last('rl', 'b'), b: last('q1', 'B') } };
}

describe('the TIP120 Darlington', () => {
  it('gains at least 1000 at 3 A, with VBE within 2.5 V, in both engines', async () => {
    // 1 Ω from 6 V: 3 A leaves 3 V on the collector, as the datasheet measures; 2 mA into the base
    const { real, ng } = await operatingPoint('6', '1', '2m');
    for (const { c } of [real, ng]) {
      const ic = (6 - c) / 1;
      expect(ic / 2e-3).toBeGreaterThan(1000);
      expect(c).toBeGreaterThan(1.5);
    }
    expect(ng.b).toBeGreaterThan(1.2);
    expect(ng.b).toBeLessThan(2.5);
    expect(real.c).toBeCloseTo(ng.c, 0);
  });

  it('saturates at 3 A with 12 mA of base current between 0.7 and 2 V, never as low as one transistor', async () => {
    // 4 Ω from 12 V: up to 3 A
    const { real, ng } = await operatingPoint('12', '4', '12m');
    for (const { c } of [real, ng]) {
      expect(c).toBeGreaterThan(0.7);
      expect(c).toBeLessThan(2);
    }
    expect(real.c).toBeCloseTo(ng.c, 1);
  });
});
