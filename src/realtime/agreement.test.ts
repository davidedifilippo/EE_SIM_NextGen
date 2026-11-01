import { describe, expect, it } from 'vitest';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { runTransient } from '../engine/ngspice';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { AGREEMENT_CASES, circuitFromNets, TestCase } from './testCircuits';

/** Maximum allowed difference between the two engines, as a fraction of the signal's full scale. */
const TOLERANCE = 0.01;

function interpolate(time: number[], values: number[], t: number, cursor: { i: number }): number {
  while (cursor.i + 1 < time.length - 1 && time[cursor.i + 1] < t) cursor.i++;
  const [t0, t1] = [time[cursor.i], time[cursor.i + 1]];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return values[cursor.i] + u * (values[cursor.i + 1] - values[cursor.i]);
}

async function compare(testCase: TestCase) {
  const circuit = circuitFromNets(testCase.name, testCase.parts);
  const netlist = generateNetlist(circuit, { type: 'tran', step: String(testCase.dt), stop: String(testCase.stop), maxStep: String(testCase.dt) });
  expect(netlist.errors).toEqual([]);
  const spice = await runTransient(netlist.text);

  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();

  const { netOf } = computeConnectivity(circuit);
  const probes = testCase.probes.map((net) => {
    const part = testCase.parts.find((p) => p.nets.includes(net))!;
    const terminals = part.def === 'vsource' ? ['pos', 'neg'] : part.def === 'diode' ? ['anode', 'cathode'] : ['a', 'b'];
    const terminal = terminals[part.nets.indexOf(net)];
    const id = part.tag.toLowerCase();
    return {
      net,
      node: compiled.compiled.netIndex.get(netOf.get(terminalKey(id, terminal))!)!,
      spice: spice.voltages.get(netlist.nodeOf.get(terminalKey(id, terminal))!)!,
      cursor: { i: 0 },
      worst: 0,
      min: Infinity,
      max: -Infinity,
    };
  });

  const steps = Math.round(testCase.stop / testCase.dt);
  for (let k = 1; k <= steps; k++) {
    engine.step(testCase.dt);
    for (const p of probes) {
      const reference = interpolate(spice.time, p.spice, engine.time, p.cursor);
      p.worst = Math.max(p.worst, Math.abs(engine.nodeVoltage(p.node) - reference));
      p.min = Math.min(p.min, reference);
      p.max = Math.max(p.max, reference);
    }
  }
  return probes.map((p) => ({ net: p.net, error: p.worst, relative: p.worst / Math.max(p.max - p.min, Math.abs(p.max), 1e-9) }));
}

describe('real-time engine against ngspice', () => {
  it.each(AGREEMENT_CASES.map((c) => [c.name, c] as const))('%s', async (_, testCase) => {
    const results = await compare(testCase);
    for (const r of results) {
      console.info(`${testCase.name} / ${r.net}: errore massimo ${(r.error * 1000).toFixed(2)} mV, ${(r.relative * 100).toFixed(3)} %`);
      expect(r.relative).toBeLessThan(TOLERANCE);
    }
  }, 120_000);
});
