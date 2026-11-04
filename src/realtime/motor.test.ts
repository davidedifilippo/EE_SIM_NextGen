import { describe, expect, it } from 'vitest';
import { runTransient } from '../engine/ngspice';
import { terminalKey } from '../netlist/connectivity';
import { generateNetlist } from '../netlist/generate';
import { getDevice } from '../library/devices';
import { compileCircuit } from './compile';
import { RealtimeEngine } from './engine';
import { KGF_CM, motorParams, motorState } from './motor';
import { circuitFromNets, Part } from './testCircuits';

const supply = (volts: string): Part => ({ def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape: 'dc', amplitude: volts, offset: '0', frequency: '50', phase: '0', duty: '50', spec: '' } });
const motor = (def: 'motor_ig22' | 'motor_tt', load = '0'): Part => ({ def, tag: 'M1', nets: ['p', '0'], props: { load } });
const plateOf = (id: string) => {
  const spice = getDevice(id)!.spice;
  if (spice.kind !== 'motor') throw new Error('not a motor');
  return spice.plate;
};

function realtime(parts: Part[], steps = 0, h = 1e-4) {
  const compiled = compileCircuit(circuitFromNets('t', parts));
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const engine = new RealtimeEngine(compiled.compiled);
  engine.initialize();
  for (let k = 0; k < steps; k++) engine.step(h);
  const index = compiled.compiled.elementIds.indexOf('m1');
  return { engine, index, current: () => engine.deviceCurrent(index), rpm: () => engine.motorStatus(index)!.rpm };
}

describe('the plate gives back what it says', () => {
  it('IG22: resistance, no-load speed, stall torque', () => {
    const plate = plateOf('motor_ig22');
    const p = motorParams(plate, 0);
    expect(p.r).toBeCloseTo(5, 9);
    expect(p.kt / p.k).toBeCloseTo(0.737, 2);
    // At stall all the current but the friction goes into torque
    expect((p.kt * (plate.stallCurrent - plate.noLoadCurrent)) / KGF_CM).toBeCloseTo(2.2, 9);
  });

  it('IG22 at 12 V in the steady state: no load, rated load, stall', () => {
    const free = realtime([supply('12'), motor('motor_ig22')]);
    expect(free.rpm()).toBeCloseTo(789, -1);
    expect(free.current()).toBeCloseTo(0.2, 2);
    const rated = realtime([supply('12'), motor('motor_ig22', '0.3')]);
    // The datasheet: 639 rpm ± 15% and 620 mA; the fit from no load and stall gives a little less current
    expect(Math.abs(rated.rpm() - 639) / 639).toBeLessThan(0.15);
    expect(rated.current()).toBeCloseTo(0.5, 1);
    const stalled = realtime([supply('12'), motor('motor_ig22', '2.3')]);
    // The smooth sign of the friction lets it creep by a few turns a minute; the display shows 0
    expect(Math.abs(stalled.rpm())).toBeLessThan(5);
    expect(stalled.current()).toBeCloseTo(2.4, 1);
  });

  it('turns the other way with the supply reversed', () => {
    expect(realtime([supply('-12'), motor('motor_ig22')]).rpm()).toBeCloseTo(-789, -1);
  });

  it('TT at 6 V: 200 rpm with no load', () => {
    expect(realtime([supply('6'), motor('motor_tt')]).rpm()).toBeCloseTo(200, -1);
  });

  it('says when it is stalled or over its voltage', () => {
    const p = motorParams(plateOf('motor_ig22'), 0);
    expect(motorState(p, 12, 2.3, 0)).toBe('stalled');
    expect(motorState(p, 12, 0.2, 789)).toBe('running');
    expect(motorState(p, 14, 0.2, 900)).toBe('overvoltage');
  });
});

describe('a start in both engines', () => {
  it('gives the same inrush current and the same rise of speed', async () => {
    // A square wave from 0 to 12 V: the motor starts at the first edge
    const square: Part = { def: 'vsource', tag: 'V1', nets: ['p', '0'], props: { shape: 'square', amplitude: '6', offset: '6', frequency: '2', phase: '0', duty: '50', spec: '' } };
    const parts = [square, motor('motor_ig22', '0.3'), { def: 'resistor', tag: 'RS', nets: ['p', '0'], props: { value: '1meg' } } as Part];
    const h = 1e-5;
    const real = realtime(parts);
    const times = [0.001, 0.005, 0.02, 0.06, 0.2];
    const samples: number[] = [];
    let t = 0;
    for (const time of times) {
      while (t < time - h / 2) {
        real.engine.step(h);
        t += h;
      }
      samples.push(real.current());
    }
    const netlist = generateNetlist(circuitFromNets('t', parts), { type: 'tran', step: '10u', stop: '200m', maxStep: '10u' });
    expect(netlist.errors).toEqual([]);
    const result = await runTransient(netlist.text);
    // The current of the motor from ngspice: the drop on its winding resistance, up to the inner node
    const vp = result.voltages.get(netlist.nodeOf.get(terminalKey('m1', 'plus'))!)!;
    const vr = result.voltages.get('xrxm1');
    expect(vr).toBeDefined();
    const ng = times.map((time) => {
      const j = result.time.findIndex((x) => x >= time);
      return (vp[j] - vr![j]) / 5;
    });
    // Inrush near 12/5 = 2.4 A at the start, then down to the running current
    expect(samples[0]).toBeGreaterThan(1.5);
    expect(samples[4]).toBeCloseTo(0.5, 1);
    samples.forEach((value, k) => expect(value).toBeCloseTo(ng[k], 2));
  });
});
