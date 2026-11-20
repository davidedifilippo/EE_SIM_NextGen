import { Element, SpiceDef } from '../model/types';
import { parseSpiceValue } from './values';

type Passive = Extract<SpiceDef, { kind: 'passive' }>;

/**
 * The value of a resistor, capacitor or inductor; for a load given by its rating, as an oven of 500 W at
 * 230 V, the resistance that takes that power at that voltage: V²/P. Null when it is not a positive number.
 */
export function passiveValue(el: Element, s: Passive): number | null {
  if (s.rated) {
    const power = parseSpiceValue(String(el.props[s.rated.powerProp] ?? ''));
    const volts = parseSpiceValue(String(el.props[s.rated.voltsProp] ?? ''));
    return power && power > 0 && volts && volts > 0 ? (volts * volts) / power : null;
  }
  const value = parseSpiceValue(String(el.props[s.valueProp] ?? ''));
  return value !== null && value > 0 ? value : null;
}

/** What is wrong with it, for the list of errors. */
export const passiveProblem = (el: Element, s: Passive) =>
  s.rated ? `${el.tag}: potenza o tensione nominale non valida` : `${el.tag}: valore non valido "${el.props[s.valueProp] ?? ''}"`;
