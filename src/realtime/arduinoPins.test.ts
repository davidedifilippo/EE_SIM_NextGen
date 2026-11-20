import { expect, it } from 'vitest';
import { getDevice } from '../library/devices';
import { compileCircuit } from './compile';
import { LiveSimulation } from './liveSimulation';
import { circuitFromNets, Part } from './testCircuits';

/**
 * A PWM on D9 into the base of a transistor through 4.7 kΩ: about 0.9 mA, far from the 40 mA of a pin, also in
 * the first frame after an edit of the circuit, before any step.
 */
it('reads no false overcurrent on a pin right after the circuit is edited', () => {
  const ids = getDevice('arduino_uno')!.terminals.map((t) => t.id);
  const net: Record<string, string> = { '5V': 'vcc', GND: '0', A0: 'a0', D9: 'd9' };
  const parts = [
    { def: 'arduino_uno', tag: 'A1', nets: ids.map((id) => net[id] ?? `nc_${id}`), props: { sketch: 'potenziometro', hex: '', hexName: '', resets: '0' } },
    { def: 'resistor', tag: 'RA', nets: ['vcc', 'a0'], props: { value: '10k' } },
    { def: 'resistor', tag: 'RB', nets: ['a0', '0'], props: { value: '10k' } },
    { def: 'resistor', tag: 'R1', nets: ['d9', 'b'], props: { value: '4.7k' } },
    { def: 'npn', tag: 'Q1', nets: ['c', 'b', '0'], props: { model: 'BC547B' } },
    { def: 'led', tag: 'D1', nets: ['k', 'c'], props: { model: 'LED_ROSSO' } },
    { def: 'resistor', tag: 'R2', nets: ['vcc', 'k'], props: { value: '180' } },
  ] as unknown as Part[];
  const c = circuitFromNets('t', parts);
  const compiled = compileCircuit(c);
  if (!compiled.ok) throw new Error(compiled.errors.join());
  const a = compiled.compiled.elementIds.indexOf('a1');
  const sim = new LiveSimulation();
  expect(sim.load(c)).toEqual({ ok: true });
  const seen = new Map<string, number>();
  let max = 0;
  for (let k = 0; k < 400; k++) {
    sim.advance(10, 1 / 2400, 1e6);
    const f = sim.frame()!;
    for (const w of f.mcus[a]?.warnings ?? []) seen.set(w, (seen.get(w) ?? 0) + 1);
    max = Math.max(max, Math.abs(f.deviceCurrent[compiled.compiled.elementIds.indexOf('r1')]));
  }
  expect([...seen]).toEqual([]);
  expect(max).toBeCloseTo(0.0009, 4);
  // An edit that changes the topology, as a wire drawn: a resistor on a free pin
  const edited = circuitFromNets('t', [...parts, { def: 'resistor', tag: 'R9', nets: ['nc_D2', '0'], props: { value: '1k' } } as unknown as Part]);
  expect(sim.load(edited)).toEqual({ ok: true });
  expect(sim.frame()!.mcus[a]?.warnings).toEqual([]);
});
