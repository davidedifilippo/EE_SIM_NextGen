import { Element, SpiceDef } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

/** The rating of a lamp, from its properties; null if either is not a positive number. */
export function lampRating(el: Element, s: Extract<SpiceDef, { kind: 'lamp' }>): { power: number; volts: number } | null {
  const power = parseSpiceValue(String(el.props[s.powerProp] ?? ''));
  const volts = parseSpiceValue(String(el.props[s.voltsProp] ?? ''));
  return power && power > 0 && volts && volts > 0 ? { power, volts } : null;
}

/** The resistance of the hot filament, at its rated voltage: V²/P. */
export const lampResistance = (rating: { power: number; volts: number }) => (rating.volts * rating.volts) / rating.power;

/** Cold, a tungsten filament has about a twelfth of its hot resistance: the inrush at switch-on. */
export const LAMP_COLD_RATIO = 1 / 12;
/** Tungsten resistance grows as the absolute temperature to about 1.2. */
const RESISTANCE_EXPONENT = 1.2;
/** The room, as a share of the working temperature of the filament: what gives the cold resistance. */
export const LAMP_AMBIENT = Math.pow(LAMP_COLD_RATIO, 1 / RESISTANCE_EXPONENT);
/**
 * Thermal capacity over rated power, times the working temperature: the time the filament would take
 * to reach it at its rated power with nothing radiated. Estimated for a small lamp: it warms in some
 * tens of milliseconds with the inrush, and cools in about a quarter of this.
 */
export const LAMP_THERMAL_TIME = 0.2;

export interface LampParams {
  hot: number;
  power: number;
  volts: number;
  tau: number;
}

export const lampParams = (rating: { power: number; volts: number }): LampParams => ({ hot: lampResistance(rating), power: rating.power, volts: rating.volts, tau: LAMP_THERMAL_TIME });

/** The resistance of the filament at a temperature, as a share of the working one. */
export const filamentResistance = (p: LampParams, t: number) => p.hot * Math.pow(Math.max(t, LAMP_AMBIENT), RESISTANCE_EXPONENT);

/** What it radiates, as a share of the rated power: T^4, less what the room gives back. */
const radiated = (t: number) => (Math.pow(t, 4) - Math.pow(LAMP_AMBIENT, 4)) / (1 - Math.pow(LAMP_AMBIENT, 4));

/** How fast the temperature moves, with the power taken and the power radiated. */
export const filamentRate = (p: LampParams, power: number, t: number) => (power / p.power - radiated(t)) / p.tau;

/** The temperature where a voltage keeps the filament: what it takes equals what it radiates. */
export function steadyTemperature(p: LampParams, volts: number): number {
  const share = (volts / p.volts) ** 2;
  let [low, high] = [LAMP_AMBIENT, 3];
  for (let k = 0; k < 60; k++) {
    const t = (low + high) / 2;
    if (share / Math.pow(t, RESISTANCE_EXPONENT) > radiated(t)) low = t;
    else high = t;
  }
  return (low + high) / 2;
}

/** The same for ngspice: the resistance on the node that holds the temperature, and what moves that node. */
export const filamentExpression = (p: LampParams, t: string) => `(${p.hot}*pow(max(${t},${LAMP_AMBIENT}),${RESISTANCE_EXPONENT}))`;
export const radiatedExpression = (t: string) => `(pow(max(${t},0),4)-${Math.pow(LAMP_AMBIENT, 4)})/${1 - Math.pow(LAMP_AMBIENT, 4)}`;

/** How bright it looks, from the power it takes against its rating: the eye sees more than the share of power at low light. */
export const lampBrightness = (power: number, rated: number) => Math.min(1, Math.pow(Math.max(power, 0) / rated, 0.6));

/** Over 110% of its rated voltage a real lamp would soon burn out. */
export const LAMP_OVERVOLTAGE = 1.1;
