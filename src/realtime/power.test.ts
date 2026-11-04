import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { EXAMPLES } from '../samples/examples';
import { Circuit } from '../model/types';
import { compileCircuit } from './compile';
import { ctTransformerParams } from './ctTransformer';
import { RealtimeEngine } from './engine';

/** Voltage of a terminal over time in both engines, sampled at the same instants. */
async function both(circuit: Circuit, id: string, terminal: string, stop: number, h: number) {
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const netlist = generateNetlist(circuit, { type: 'tran', step: String(h), stop: String(stop), maxStep: String(h) });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const name = netlist.nodeOf.get(terminalKey(id, terminal))!;
  const ng = result.voltages.get(name)!;
  // The first or second terminal of a two-terminal part
  const device = compiled.compiled.devices[compiled.compiled.elementIds.indexOf(id)];
  const node = terminal === 'a' ? device.a : device.b;
  const at = (t: number) => ng[result.time.findIndex((time) => time >= t - 1e-12)];
  const real: number[] = [];
  const steps = Math.round(stop / h);
  for (let k = 0; k < steps; k++) {
    engine.step(h);
    real.push(engine.nodeVoltage(node));
  }
  return { real: (t: number) => real[Math.round(t / h) - 1], ng: at };
}

describe('centre-tapped transformer', () => {
  it('is sized from its plate: 230 V, 12 + 12 V, 15 VA', () => {
    const params = ctTransformerParams('230', '12', '15')!;
    // About 112 H on the primary and 0.37 H for each half, so 13.2 V each with no load
    expect(params.inductances[0]).toBeCloseTo(112.3, 0);
    expect(Math.sqrt(params.inductances[1] / params.inductances[0]) * 230).toBeCloseTo(13.2, 2);
    expect(params.resistances[1]).toBeCloseTo(0.96, 2);
    // 6% of 15 VA, shared by the two halves: 0.45 W each at 13.2 V
    expect(params.coreResistance).toBeCloseTo(387.2, 1);
    expect(ctTransformerParams('230', '0', '15')).toBeNull();
  });
});

/** How often a trace changes direction: a few times a period for a clean wave, at nearly every step when it rings. */
const turns = (values: number[]) => values.slice(2).filter((v, i) => (v - values[i + 1]) * (values[i + 1] - values[i]) < 0).length;

describe('dual supply example', () => {
  it('shows no ringing on the secondary when the diodes turn off, in either engine', async () => {
    const circuit = EXAMPLES.find((e) => e.id === 'dual')!.build();
    const netlist = generateNetlist(circuit, { type: 'tran', step: '20u', stop: '100m', maxStep: '20u' });
    const result = await runTransient(netlist.text);
    // Five periods: a clean wave turns a few times in each, ringing turned at nearly every step
    expect(turns(result.voltages.get(netlist.nodeOf.get(terminalKey('t1', 's1'))!)!)).toBeLessThan(150);

    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const device = compiled.compiled.devices[compiled.compiled.elementIds.indexOf('t1')];
    if (device.kind !== 'ctransformer') throw new Error('not the transformer');
    const samples: number[] = [];
    for (let k = 0; k < 5000; k++) {
      engine.step(20e-6);
      samples.push(engine.nodeVoltage(device.starts[1]));
    }
    expect(turns(samples)).toBeLessThan(150);
  });

  it('gives about +17 V and -17 V, the same in both engines', async () => {
    const circuit = EXAMPLES.find((e) => e.id === 'dual')!.build();
    const positive = await both(circuit, 'rl1', 'a', 0.2, 20e-6);
    const negative = await both(circuit, 'rl2', 'b', 0.2, 20e-6);
    for (const t of [0.15, 0.17, 0.19]) {
      expect(positive.real(t)).toBeGreaterThan(15);
      expect(positive.real(t)).toBeLessThan(19);
      expect(positive.real(t)).toBeCloseTo(positive.ng(t), 0);
      expect(negative.real(t)).toBeLessThan(-15);
      expect(negative.real(t)).toBeCloseTo(negative.ng(t), 0);
    }
  });
});
