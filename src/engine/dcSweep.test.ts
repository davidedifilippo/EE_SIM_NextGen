import { describe, expect, it } from 'vitest';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { DcAnalysis, generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { circuitFromNets, Part } from '../realtime/testCircuits';
import { runDc, splitDcCurves } from './ngspice';

const dcSource = (tag: string, a: string, b: string, value = '0'): Part => ({ def: 'vsource', tag, nets: [a, b], props: { shape: 'dc', amplitude: value } });
const R = (tag: string, a: string, b: string, value: string): Part => ({ def: 'resistor', tag, nets: [a, b], props: { value } });

const sweep = async (parts: Part[], analysis: Omit<DcAnalysis, 'type'>) => {
  const circuit = circuitFromNets('t', parts);
  const netlist = generateNetlist(circuit, { type: 'dc', ...analysis });
  expect(netlist.errors).toEqual([]);
  const result = await runDc(netlist.text);
  return { circuit, netlist, result, node: (el: string, t: string) => result.voltages.get(netlist.nodeOf.get(terminalKey(el, t))!)! };
};

describe('splitDcCurves', () => {
  it('makes one curve per value of the second generator', () => {
    expect(splitDcCurves([0, 1, 2, 0, 1, 2], { a: [1, 2, 3, 4, 5, 6] })).toEqual({ x: [0, 1, 2], curves: { a: [[1, 2, 3], [4, 5, 6]] } });
  });

  it('leaves a single sweep as it is', () => {
    expect(splitDcCurves([0, 1, 2], { a: [1, 2, 3] })).toEqual({ x: [0, 1, 2], curves: { a: [[1, 2, 3]] } });
  });
});

describe('DC sweep against the formulas', () => {
  it('a divider follows the input in a straight line', async () => {
    const { node, result } = await sweep([dcSource('V1', 'in', '0'), R('R1', 'in', 'out', '1k'), R('R2', 'out', '0', '3k')], { source: 'v1', from: '0', to: '8', step: '2' });
    expect(result.x).toEqual([0, 2, 4, 6, 8]);
    node('r2', 'a')[0].forEach((v, i) => expect(v).toBeCloseTo(0.75 * result.x[i], 9));
  });

  it('gives the generator current as what it delivers', async () => {
    const { result } = await sweep([dcSource('V1', 'in', '0'), R('R1', 'in', '0', '1k')], { source: 'v1', from: '0', to: '10', step: '5' });
    expect(result.currents.get('V1')![0].map((i) => Number(i.toFixed(6)))).toEqual([0, 0.005, 0.01]);
  });

  it('a diode follows the Shockley equation', async () => {
    const IS = 1e-14;
    const parts: Part[] = [dcSource('V1', 'a', '0'), { def: 'diode', tag: 'D1', nets: ['a', '0'], props: { model: 'DX' } }];
    const circuit = circuitFromNets('t', parts);
    circuit.models.push({ name: 'DX', card: `.model DX D(IS=${IS})` });
    const netlist = generateNetlist(circuit, { type: 'dc', source: 'v1', from: '0.5', to: '0.7', step: '0.1' });
    const result = await runDc(netlist.text);
    result.x.forEach((v, i) => {
      const expected = IS * (Math.exp(v / 0.025865) - 1);
      expect(result.currents.get('V1')![0][i] / expected).toBeCloseTo(1, 2);
    });
  });

  it('a MOSFET draws its family of curves, with the square law in saturation', async () => {
    const { result } = await sweep(
      [dcSource('VDS', 'd', '0'), dcSource('VGS', 'g', '0'), { def: 'nmos', tag: 'M1', nets: ['d', 'g', '0'], props: { model: 'MN1' } }],
      { source: 'vds', from: '0', to: '10', step: '1', familySource: 'vgs', familyFrom: '2', familyTo: '5', familyStep: '1' },
    );
    const id = result.currents.get('VDS')!;
    expect(id).toHaveLength(4);
    expect(result.x).toHaveLength(11);
    // MN1 has VTO=2 KP=0.2 LAMBDA=0.01; at VDS=10, each VGS on the square law
    [2, 3, 4, 5].forEach((vgs, k) => {
      const over = vgs - 2;
      expect(id[k][10]).toBeCloseTo(0.5 * 0.2 * over * over * 1.1, 6);
    });
  });

  it('a BJT family has its gain on the flat part, and saturates near the origin', async () => {
    const { result } = await sweep(
      [dcSource('VCE', 'c', '0'), dcSource('VB', 'in', '0'), R('RB', 'in', 'b', '100k'), { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } }],
      { source: 'vce', from: '0', to: '10', step: '0.1', familySource: 'vb', familyFrom: '1', familyTo: '5', familyStep: '2' },
    );
    const ic = result.currents.get('VCE')!;
    expect(ic).toHaveLength(3);
    expect(ic[2][100]).toBeGreaterThan(ic[1][100]);
    expect(ic[1][100]).toBeGreaterThan(ic[0][100]);
    expect(ic[1][0]).toBeLessThan(ic[1][100] / 2);
  });

  it('an op amp shows its rails', async () => {
    const { result, node } = await sweep(
      [dcSource('V1', 'in', '0'), R('R1', 'in', 'n', '1k'), R('R2', 'n', 'out', '10k'), { def: 'opamp', tag: 'U1', nets: ['n', '0', 'out'], props: { high: '15', low: '-15' } }],
      { source: 'v1', from: '-5', to: '5', step: '1' },
    );
    const out = node('u1', 'out')[0];
    expect(out[0]).toBeCloseTo(15, 2);
    expect(out[out.length - 1]).toBeCloseTo(-15, 2);
    expect(out[result.x.indexOf(1)]).toBeCloseTo(-10, 3);
  });

  it('uses the offset of the other generators as their DC level', async () => {
    const { node } = await sweep(
      [dcSource('V1', 'a', '0'), { def: 'vsource', tag: 'V2', nets: ['b', '0'], props: { shape: 'sin', amplitude: '5', offset: '3', frequency: '50' } }, R('R1', 'a', 'b', '1k')],
      { source: 'v1', from: '0', to: '1', step: '1' },
    );
    expect(node('v2', 'pos')[0]).toEqual([3, 3]);
  });
});

describe('the real-time engine at each point of a sweep', () => {
  const pointsOf = async (build: (v: string, vg: string) => Part[], values: { v: number[]; vg: number[] }, probe: [string, string], source: string, family: string) => {
    const base = await sweep(build('0', '0'), { source, from: String(values.v[0]), to: String(values.v[values.v.length - 1]), step: String(values.v[1] - values.v[0]), familySource: family, familyFrom: String(values.vg[0]), familyTo: String(values.vg[values.vg.length - 1]), familyStep: String(values.vg[1] - values.vg[0]) });
    const spice = base.node(...probe);
    values.vg.forEach((vg, k) => {
      values.v.forEach((v, i) => {
        const circuit = circuitFromNets('t', build(String(v), String(vg)));
        const compiled = compileCircuit(circuit);
        if (!compiled.ok) throw new Error(compiled.errors.join());
        const engine = new RealtimeEngine(compiled.compiled);
        engine.initialize();
        const node = compiled.compiled.netIndex.get(computeConnectivity(circuit).netOf.get(terminalKey(...probe))!)!;
        expect(Math.abs(engine.nodeVoltage(node) - spice[k][i])).toBeLessThan(0.01);
      });
    });
  };

  it('agrees with ngspice on a transistor stage', async () => {
    await pointsOf(
      (v, vb) => [dcSource('VCC', 'vcc', '0', v), R('RC', 'vcc', 'c', '1k'), dcSource('VB', 'in', '0', vb), R('RB', 'in', 'b', '100k'), { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: '2N3904' } }],
      { v: [0, 3, 6, 9, 12], vg: [0, 2, 4] },
      ['q1', 'collector'],
      'vcc',
      'vb',
    );
  });

  it('agrees with ngspice on a MOSFET stage and a zener', async () => {
    await pointsOf(
      (v, vg) => [dcSource('VDD', 'vdd', '0', v), R('RD', 'vdd', 'd', '100'), dcSource('VG', 'g', '0', vg), { def: 'nmos', tag: 'M1', nets: ['d', 'g', '0'], props: { model: 'MN1' } }],
      { v: [0, 3, 6, 9, 12], vg: [0, 2, 4] },
      ['m1', 'drain'],
      'vdd',
      'vg',
    );
    await pointsOf(
      (v, vs) => [dcSource('V1', 'a', '0', v), R('R1', 'a', 'z', '1k'), dcSource('V2', 'b', '0', vs), R('R2', 'b', 'z', '10k'), { def: 'zener', tag: 'D1', nets: ['0', 'z'], props: { model: 'DZ5V1' } }],
      { v: [-5, 0, 5, 10], vg: [0, 5] },
      ['d1', 'cathode'],
      'v1',
      'v2',
    );
  });
});
