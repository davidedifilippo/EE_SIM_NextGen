import { parseSpiceValue } from '../netlist/values';

/** The colours of the code, digit by digit, then gold and silver for the multipliers below one. */
export const BAND_COLORS = ['#1c1917', '#78350f', '#dc2626', '#ea580c', '#facc15', '#16a34a', '#2563eb', '#7c3aed', '#9ca3af', '#f8fafc'];
const GOLD = '#d4a017';
const SILVER = '#cbd5e1';
export const BAND_NAMES = ['nero', 'marrone', 'rosso', 'arancio', 'giallo', 'verde', 'blu', 'viola', 'grigio', 'bianco'];

export interface Bands {
  colors: string[];
  names: string[];
}

/**
 * The four bands of a resistor: two digits, the multiplier, gold for 5%. A value with more figures keeps its
 * first two, as a real part of the E24 series would be the nearest. Null for a value that is not a number,
 * or out of the range of the code (0.1 Ω to 99 GΩ).
 */
export function resistorBands(value: string | number): Bands | null {
  const ohms = parseSpiceValue(String(value));
  if (ohms === null || !(ohms >= 0.1) || ohms >= 1e11) return null;
  let exponent = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exponent);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exponent++;
  }
  const [d1, d2] = [Math.floor(digits / 10), digits % 10];
  const multiplier = exponent >= 0 ? { color: BAND_COLORS[exponent], name: BAND_NAMES[exponent] } : exponent === -1 ? { color: GOLD, name: 'oro' } : { color: SILVER, name: 'argento' };
  return {
    colors: [BAND_COLORS[d1], BAND_COLORS[d2], multiplier.color, GOLD],
    names: [BAND_NAMES[d1], BAND_NAMES[d2], multiplier.name, 'oro'],
  };
}
