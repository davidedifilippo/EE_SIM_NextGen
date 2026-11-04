import { parseSpiceValue } from '../netlist/values';

/**
 * A small mains transformer with a centre tap, built from what its plate says: primary voltage,
 * voltage of each half of the secondary at the rated load, rated power. The rest follows from what is
 * typical of such parts, round numbers for lessons rather than the data of a maker.
 */

/** The output drops this much from no load to the rated load: 10%, usual for a few tens of VA. */
export const CT_REGULATION = 0.1;
/** Current with no load, as a fraction of the rated primary current. */
export const CT_MAGNETIZING = 0.1;
export const CT_COUPLING = 0.999;
/**
 * Iron losses, as a fraction of the rated power: about 6% in a transformer of a few tens of VA. As a
 * resistance on each half of the secondary they also damp the leakage inductance when a diode turns
 * off, as the iron does in a real part; without them the solver would ring at every step.
 */
export const CT_CORE_LOSS = 0.06;
export const MAINS_FREQUENCY = 50;

export interface CtTransformerParams {
  /** Inductances of the primary, the upper half and the lower half of the secondary. */
  inductances: [number, number, number];
  /** Series resistance of each winding, in the same order. */
  resistances: [number, number, number];
  /** Across each half of the secondary, for the iron losses. */
  coreResistance: number;
  coupling: number;
}

export function ctTransformerParams(primary: unknown, secondaryHalf: unknown, power: unknown): CtTransformerParams | null {
  const [vp, vs, va] = [primary, secondaryHalf, power].map((v) => parseSpiceValue(String(v ?? '')));
  if (vp === null || vs === null || va === null || vp <= 0 || vs <= 0 || va <= 0) return null;
  // The magnetizing current sets the primary inductance; the turns give the no load voltage of each half
  const lp = (vp * vp) / (CT_MAGNETIZING * va * 2 * Math.PI * MAINS_FREQUENCY);
  const openHalf = vs * (1 + CT_REGULATION);
  const ls = lp * (openHalf / vp) ** 2;
  // The copper drops the regulation at the rated current, half on the primary and half on the secondary
  const ratedSecondary = va / (2 * vs);
  const total = (CT_REGULATION * 2 * vs) / ratedSecondary;
  const rs = total / 4;
  const rp = (total / 2) * (vp / (2 * openHalf)) ** 2;
  const coreResistance = (openHalf * openHalf) / ((CT_CORE_LOSS * va) / 2);
  return { inductances: [lp, ls, ls], resistances: [rp, rs, rs], coupling: CT_COUPLING, coreResistance };
}
