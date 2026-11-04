import { Element, SensorSpec, SpiceDef } from '../model/types';
import { parseSpiceValue } from '../netlist/values';

export interface RegulatorParams {
  vNominal: number;
  polarity: 1 | -1;
  iq: number;
  iMax: number;
  dropout: number;
  rth: number;
  ambient: number;
  /** For a temperature sensor: where its supply must stay. */
  sensor?: SensorSpec;
}

/** How hard the output holds its voltage: 10 mV from no load to 1 A. Shared with the netlist. */
export const REGULATOR_GAIN = 100;
/** Keeps the nodes defined when the output has nothing to give, and in the netlist too. Small enough not to weigh on the ADJ pin. */
export const REGULATOR_LEAK = 1e8;
/** Volts per ampere beyond the limits of the current, in the netlist: enough to hold them within microamperes. */
export const REGULATOR_STIFFNESS = 1e6;
export const THERMAL_SHUTDOWN = 150;
export const THERMAL_RESTART = 125;
/**
 * Steps for the junction to get most of the way to its final temperature: about 2 s of animation
 * at any speed. A real one takes seconds of real time, which at a slow speed would mean minutes.
 */
export const THERMAL_STEPS = 4800;

export function regulatorParams(el: Element, s: Extract<SpiceDef, { kind: 'regulator' }>): RegulatorParams | null {
  if (s.sensor) {
    const temperature = parseSpiceValue(String(el.props[s.sensor.tempProp] ?? ''));
    if (temperature === null) return null;
    const { offset, slope, iMax, dropout } = s.sensor;
    return { vNominal: offset + slope * temperature, polarity: 1, iq: s.iq, iMax, dropout, rth: 0, ambient: 25, sensor: s.sensor };
  }
  const [iMax, dropout, rth, ambient] = ['imax', 'dropout', 'rth', 'ta'].map((key) => parseSpiceValue(String(el.props[key] ?? '')));
  if (iMax === null || dropout === null || rth === null || ambient === null || iMax <= 0 || dropout < 0 || rth < 0) return null;
  return { vNominal: s.vNominal, polarity: s.polarity, iq: s.iq, iMax, dropout, rth, ambient };
}

export type RegulatorRegion = 'regulating' | 'dropout' | 'limit' | 'off';

/** The supply of a sensor: within its range, outside it but still giving, too low to give, or past the absolute maximum. */
export type SensorSupply = 'ok' | 'high' | 'low' | 'damaged';

export function sensorSupply(sensor: SensorSpec, input: number, wasDamaged: boolean): SensorSupply {
  if (wasDamaged || input > sensor.vAbsMax) return 'damaged';
  if (input < sensor.vMin) return 'low';
  return input > sensor.vMax ? 'high' : 'ok';
}

/** Whether a sensor gives a valid output with this supply: the same condition in the netlist. */
export const sensorGives = (supply: SensorSupply) => supply === 'ok' || supply === 'high';

/**
 * Current given to the output, for voltages seen from the reference with the polarity taken out.
 * Linear in each region: this is what lets Newton find its way.
 */
export function regulatorPoint(p: RegulatorParams, input: number, output: number): { i: number; region: RegulatorRegion } {
  const isDropout = input - p.dropout < p.vNominal;
  const i = REGULATOR_GAIN * ((isDropout ? input - p.dropout : p.vNominal) - output);
  if (i <= 0) return { i: 0, region: 'off' };
  if (i >= p.iMax) return { i: p.iMax, region: 'limit' };
  return { i, region: isDropout ? 'dropout' : 'regulating' };
}

/** Heat in the part: the voltage it drops times the current through it, and its own consumption. */
export const regulatorPower = (p: RegulatorParams, input: number, output: number, i: number) => Math.max(0, (input - output) * i + input * p.iq);
