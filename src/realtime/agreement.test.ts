import { describe, expect, it } from 'vitest';
import { getDevice } from '../library/devices';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { runTransient } from '../engine/ngspice';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { AGREEMENT_CASES, BJT_BIAS, circuitFromNets, TestCase } from './testCircuits';

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
  circuit.models.push(...(testCase.models ?? []));
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
    const terminal = getDevice(part.def)!.terminals[part.nets.indexOf(net)].id;
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

  it('gives the same DC voltages and transistor currents', async () => {
    const circuit = circuitFromNets('polarizzazione', BJT_BIAS);
    const netlist = generateNetlist(circuit, { type: 'tran', step: '10u', stop: '1m', maxStep: '10u' });
    const spice = await runTransient(netlist.text);
    const last = (node: string) => {
      const values = spice.voltages.get(netlist.nodeOf.get(terminalKey('q1', node))!)!;
      return values[values.length - 1];
    };
    const [vc, vb] = [last('collector'), last('base')];
    const spiceIc = (10 - vc) / 1e3;
    const spiceIb = (10 - vb) / 10e3 - vb / 10e3;

    const compiled = compileCircuit(circuit);
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const engine = new RealtimeEngine(compiled.compiled);
    engine.initialize();
    const { netOf } = computeConnectivity(circuit);
    const voltage = (terminal: string) => engine.nodeVoltage(compiled.compiled.netIndex.get(netOf.get(terminalKey('q1', terminal))!)!);
    const [ic, ib] = engine.terminalCurrents(compiled.compiled.devices.findIndex((d) => d.kind === 'bjt'));

    console.info(`Polarizzazione: Vb ${voltage('base').toFixed(4)} / ${vb.toFixed(4)} V, Vc ${voltage('collector').toFixed(4)} / ${vc.toFixed(4)} V, Ic ${(ic * 1e3).toFixed(4)} / ${(spiceIc * 1e3).toFixed(4)} mA, Ib ${(ib * 1e6).toFixed(3)} / ${(spiceIb * 1e6).toFixed(3)} uA`);
    expect(Math.abs(voltage('base') - vb) / vb).toBeLessThan(TOLERANCE);
    expect(Math.abs(voltage('collector') - vc) / Math.max(vc, 0.1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(ic - spiceIc) / spiceIc).toBeLessThan(TOLERANCE);
    expect(Math.abs(ib - spiceIb) / spiceIb).toBeLessThan(TOLERANCE);
  });
});
