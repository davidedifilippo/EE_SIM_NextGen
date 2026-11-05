import { Circuit, Element, TimerSpec } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { parseSpiceValue } from '../netlist/values';

export type { TimerSpec };
export { NE555, TLC555 } from './timerSpecs';

/** Each input of a timer takes almost nothing: a path to ground that keeps an open pin defined, in both engines. */
export const TIMER_INPUT_RESISTANCE = 1e9;
/** RESET left open stays high: a weak pull-up, a simplification of what the chip does. */
export const TIMER_RESET_PULLUP = 100e3;
/** The discharge transistor off. */
export const TIMER_OFF_RESISTANCE = 1e9;

/** The resistance from VCC to GND that takes, with the divider, the current at rest of the datasheet. */
export const supplyResistance = (spec: TimerSpec) => 5 / (spec.quiescent - 5 / (3 * spec.divider));

/**
 * The flip-flop of the timer after a step, from the voltages to its GND: RESET low clears it before
 * all; TRIG below the lower reference sets it, even with THR high; THR above CTRL clears it.
 */
export function nextTimerState(spec: TimerSpec, state: boolean, v: { trig: number; thr: number; ctrl: number; lower: number; reset: number }): boolean {
  if (v.reset < spec.resetLevel) return false;
  if (v.trig < v.lower) return true;
  if (v.thr > v.ctrl) return false;
  return state;
}

export type TimerSupply = 'ok' | 'out' | 'over';

export function timerSupply(spec: TimerSpec, volts: number): TimerSupply {
  if (volts > spec.vAbsMax) return 'over';
  return volts < spec.vMin || volts > spec.vMax ? 'out' : 'ok';
}

export type TimerEstimate = { kind: 'astable'; frequency: number; duty: number } | { kind: 'monostable'; duration: number };

/**
 * What a 555 in one of the circuits of the books is expected to do. Astable: THR and TRIG together on a
 * capacitor to GND, R2 from DIS to them, R1 from VCC to DIS. Monostable: THR and DIS together, R from
 * VCC, C to GND, TRIG on its own. Null for anything else.
 */
export function timerEstimate(circuit: Circuit, el: Element): TimerEstimate | null {
  const spice = getDevice(el.def)?.spice;
  if (spice?.kind !== 'timer') return null;
  const { netOf } = computeConnectivity(circuit);
  const net = (terminal: string) => netOf.get(terminalKey(el.id, terminal));
  const [gnd, trig, thr, dis, vcc] = [net(spice.gnd), net(spice.trig), net(spice.thr), net(spice.dis), net(spice.vcc)];
  /** The value of a resistor or capacitor between two nets, if there is exactly one. */
  const between = (prefix: 'R' | 'C', a?: string, b?: string): number | null => {
    if (!a || !b || a === b) return null;
    const found = circuit.elements.flatMap((other) => {
      const s = getDevice(other.def)?.spice;
      if (s?.kind !== 'passive' || s.prefix !== prefix) return [];
      const ends = [netOf.get(terminalKey(other.id, s.a)), netOf.get(terminalKey(other.id, s.b))];
      const value = parseSpiceValue(String(other.props[s.valueProp] ?? ''));
      return value && value > 0 && ((ends[0] === a && ends[1] === b) || (ends[0] === b && ends[1] === a)) ? [value] : [];
    });
    return found.length === 1 ? found[0] : null;
  };
  if (trig === thr && thr !== dis) {
    const [c, r1, r2] = [between('C', thr, gnd), between('R', vcc, dis), between('R', dis, thr)];
    if (c && r1 && r2) return { kind: 'astable', frequency: 1 / (Math.LN2 * (r1 + 2 * r2) * c), duty: (r1 + r2) / (r1 + 2 * r2) };
  }
  if (thr === dis && trig !== thr) {
    const [c, r] = [between('C', thr, gnd), between('R', vcc, thr)];
    if (c && r) return { kind: 'monostable', duration: Math.log(3) * r * c };
  }
  return null;
}
