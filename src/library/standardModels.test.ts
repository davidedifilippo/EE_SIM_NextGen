import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { compileCircuit } from '../realtime/compile';
import { RealtimeEngine } from '../realtime/engine';
import { circuitFromNets, Part } from '../realtime/testCircuits';
import { Circuit } from '../model/types';
import { BJT_SHEETS, DIODE_SHEETS, MOS_SHEETS, STANDARD_MODELS, ZENER_SHEETS, zenerImpedance } from './standardModels';
import { fitsModelType, modelsOfType } from './models';

const current = (tag: string, from: string, into: string, amps: number): Part => ({ def: 'isource', tag, nets: [from, into], props: { value: String(amps) } });
const source = (tag: string, net: string, volts: number): Part => ({ def: 'vsource', tag, nets: [net, '0'], props: { shape: 'dc', amplitude: String(volts), offset: '0', frequency: '50', phase: '0', duty: '50', spec: '', rint: '0' } });

/** The circuit at its operating point in the animation, and a reader of its node voltages. */
function operate(parts: Part[]) {
  const circuit = circuitFromNets('t', parts);
  const compiled = compileCircuit(circuit);
  if (!compiled.ok) throw new Error(compiled.errors.join('; '));
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  const volts = (net: string) => {
    const index = compiled.compiled.netIndex.get([...compiled.compiled.netIndex.keys()].find((k) => circuitNet(circuit, k) === net) ?? '');
    return index === undefined || index < 0 ? 0 : engine.nodeVoltage(index);
  };
  return { engine, compiled: compiled.compiled, circuit, volts };
}

/** Which net of circuitFromNets a connectivity net is: the bus wire it holds is named after it. */
const circuitNet = (circuit: Circuit, net: string) => (net === `wire:bus_${net.replace(/^wire:bus_/, '')}` ? net.replace(/^wire:bus_/, '') : null);

/** The same circuit in ngspice: the voltage of a terminal at the end of a short run. */
async function ngspiceAt(parts: Part[], id: string, terminal: string): Promise<number> {
  const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '1u', stop: '10u' });
  expect(netlist.errors).toEqual([]);
  const result = await runTransient(netlist.text);
  const node = netlist.nodeOf.get(terminalKey(id, terminal))!;
  const values = result.voltages.get(node);
  return node === '0' || !values ? 0 : values[values.length - 1];
}

const near = (value: number, target: number, share: number) => expect(Math.abs(value - target) / Math.abs(target), `${value} against ${target}`).toBeLessThan(share);

describe('the library of standard models', () => {
  it('every model is in the menu of its kind of part, and an own model of the same name comes first', () => {
    for (const m of STANDARD_MODELS) {
      const type = /\.model \S+ (VDMOS\(pchan|VDMOS|\w+)/.exec(m.card)![1];
      const kind = type === 'VDMOS(pchan' ? 'PMOS' : type === 'VDMOS' ? 'NMOS' : type;
      expect(fitsModelType(m.card, kind as 'D')).toBe(true);
    }
    const own = { name: 'BC547B', card: '.model BC547B NPN(BF=123)' };
    const empty: Circuit = { title: 't', elements: [], wires: [], models: [] };
    expect(modelsOfType(empty, 'NPN', [own]).find((m) => m.name === 'BC547B')).toEqual(own);
  });
});

describe('diodes against their datasheets', () => {
  it.each(DIODE_SHEETS.map((d) => [d.name, d] as const))('%s: the forward voltage at three currents, in both engines', async (name, sheet) => {
    for (const [amps, expected] of sheet.forward) {
      const parts = [current('I1', '0', 'a', amps), { def: 'diode', tag: 'D1', nets: ['a', '0'], props: { model: name } } as Part];
      const { volts } = operate(parts);
      near(volts('a'), expected, 0.02);
      near(await ngspiceAt(parts, 'd1', 'anode'), volts('a'), 0.005);
    }
  });
});

/** Maximum reverse current of each zener, at its test voltage, from the datasheets. */
const REVERSE: Record<string, [number, number]> = {
  '1N4728A': [1, 100e-6],
  '1N4732A': [1, 10e-6],
  '1N4733A': [1, 10e-6],
  '1N4735A': [3, 10e-6],
  '1N4739A': [7, 10e-6],
  '1N4742A': [9.1, 5e-6],
  '1N4744A': [11.4, 5e-6],
};

describe('zeners against their datasheets', () => {
  it.each(ZENER_SHEETS.map((z) => [z.name, z] as const))('%s: Vz at the test current, and the impedance there', async (name, sheet) => {
    const at = (amps: number) => {
      const parts = [current('I1', '0', 'k', amps), { def: 'zener', tag: 'D1', nets: ['0', 'k'], props: { model: name } } as Part];
      return { parts, v: operate(parts).volts('k') };
    };
    const test = at(sheet.izt);
    near(test.v, sheet.vz, 0.02);
    const impedance = (at(sheet.izt * 1.1).v - at(sheet.izt * 0.9).v) / (0.2 * sheet.izt);
    near(impedance, zenerImpedance(sheet), 0.1);
    // The impedance of the datasheet, but where the knee had to be kept from conducting at zero volts
    if (zenerImpedance(sheet) > 0.9 * sheet.zzt) near(impedance, sheet.zzt, 0.2);
    // Below the knee, no more than the maximum reverse current of the datasheet at its test voltage
    const [vr, irMax] = REVERSE[name];
    const leak: Part[] = [source('VR', 'k', vr), { def: 'zener', tag: 'D1', nets: ['0', 'k'], props: { model: name } }];
    const { engine, compiled } = operate(leak);
    expect(Math.abs(engine.deviceCurrent(compiled.elementIds.indexOf('d1')))).toBeLessThan(irMax);
    near(await ngspiceAt(test.parts, 'd1', 'cathode'), test.v, 0.005);
  });
});

describe('transistors against their datasheets', () => {
  it.each(BJT_SHEETS.map((b) => [b.name, b] as const))('%s: hFE and VBE at the typical point, in both engines', async (name, sheet) => {
    const sign = sheet.type === 'NPN' ? 1 : -1;
    // The base current that gives the collector current of the datasheet, at its collector voltage
    const at = (ib: number) => {
      const parts: Part[] = [source('VC', 'c', sign * sheet.vce), sign > 0 ? current('IB', '0', 'b', ib) : current('IB', 'b', '0', ib), { def: sign > 0 ? 'npn' : 'pnp', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: name } }];
      const { engine, compiled, volts } = operate(parts);
      return { parts, ic: Math.abs(engine.terminalCurrents(compiled.elementIds.indexOf('q1'))[0]), vbe: Math.abs(volts('b')) };
    };
    let [low, high] = [sheet.ic / sheet.hfe / 10, (sheet.ic / sheet.hfe) * 10];
    for (let k = 0; k < 50; k++) {
      const mid = Math.sqrt(low * high);
      if (at(mid).ic < sheet.ic) low = mid;
      else high = mid;
    }
    const ib = Math.sqrt(low * high);
    const point = at(ib);
    near(point.ic / ib, sheet.hfe, 0.1);
    near(point.vbe, sheet.vbe, 0.03);
    near(Math.abs(await ngspiceAt(point.parts, 'q1', 'base')), point.vbe, 0.005);
  });
});

describe('MOSFETs against their datasheets', () => {
  /** Rds(on) is read at a tenth of the test current of the datasheet, where the drop is small. */
  const ON_CURRENT: Record<string, number> = { '2N7000': 0.05, BS170: 0.02, IRF540N: 1.6, IRF9540N: 1.1, IRLZ44N: 1.7 };

  it.each(MOS_SHEETS.map((m) => [m.name, m] as const))('%s: threshold and on resistance, in both engines', async (name, sheet) => {
    const sign = sheet.type === 'NMOS' ? 1 : -1;
    const def = sign > 0 ? 'nmos' : 'pmos';
    // Threshold: gate and drain together, the test current into them
    const threshold: Part[] = [sign > 0 ? current('I1', '0', 'd', sheet.ithTest) : current('I1', 'd', '0', sheet.ithTest), { def, tag: 'M1', nets: ['d', 'd', '0'], props: { model: name } }];
    const vth = Math.abs(operate(threshold).volts('d'));
    near(vth, sheet.vth, 0.1);
    near(Math.abs(await ngspiceAt(threshold, 'm1', 'drain')), vth, 0.01);
    // On resistance: the gate at its voltage, a small current into the drain
    const id = ON_CURRENT[name];
    const on: Part[] = [source('VG', 'g', sign * sheet.vgsOn), sign > 0 ? current('I1', '0', 'd', id) : current('I1', 'd', '0', id), { def, tag: 'M1', nets: ['d', 'g', '0'], props: { model: name } }];
    const rds = Math.abs(operate(on).volts('d')) / id;
    near(rds, sheet.rdson, 0.1);
    near(Math.abs(await ngspiceAt(on, 'm1', 'drain')) / id, rds, 0.01);
  });
});
