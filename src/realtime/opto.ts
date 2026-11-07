import { fitJunction } from '../library/standardModels';

/**
 * An optocoupler as the PC817 datasheet gives it: an infrared LED, and a phototransistor whose collector
 * current is CTR times the LED current, less what saturation takes. Input and output share nothing.
 */
export interface OptoSpec {
  name: string;
  /** The LED: three points of its forward curve. */
  led: [[number, number], [number, number], [number, number]];
  /** Absolute maxima: LED current, collector current, collector-emitter voltage. */
  ifMax: number;
  icMax: number;
  vceo: number;
}

/** Sharp PC817: VF 1.2 V typical at 20 mA; IF and IC at most 50 mA; VCEO 35 V. */
export const PC817: OptoSpec = { name: 'PC817', led: [[1e-3, 1.04], [10e-3, 1.15], [50e-3, 1.27]], ifMax: 0.05, icMax: 0.05, vceo: 35 };

/** The CTR classes of the PC817, at IF = 5 mA and VCE = 5 V, each at the geometric middle of its range. */
export const CTR_CLASSES = [
  { value: 'none', label: 'Senza classe (50–600%)', ctr: 1.75 },
  { value: 'A', label: 'A (80–160%)', ctr: 1.15 },
  { value: 'B', label: 'B (130–260%)', ctr: 1.85 },
  { value: 'C', label: 'C (200–400%)', ctr: 2.85 },
  { value: 'D', label: 'D (300–600%)', ctr: 4.25 },
];

export const ctrOf = (value: unknown) => (CTR_CLASSES.find((c) => c.value === value) ?? CTR_CLASSES[0]).ctr;

export const ledParams = (spec: OptoSpec) => fitJunction(spec.led);

/** Thermal voltage at 27 °C, the temperature SPICE assumes. */
const VT = 0.025865;
/**
 * The saturation of the phototransistor, from Ebers-Moll with the base current fixed by the light: with
 * x = IC/(CTR·IF), VCE = VT·ln((A + B·x)/(1 - x)), A = (1 + BR)/BR and B = BF/BR. A large ratio BF/BR
 * gives the 0.1 V or so of saturation of the datasheet; inverted, x = (1 - A·e)/(1 + B·e), e = exp(-VCE/VT).
 */
const SAT_A = 2;
const SAT_B = 1000;
/** Below this the exponential is kept from growing: a reverse voltage only gives a small reverse current. */
const VCE_FLOOR = -1;

/** The share of CTR·IF the collector takes at a collector-emitter voltage, and its slope. */
export function saturation(vce: number): { x: number; dx: number } {
  const v = Math.max(vce, VCE_FLOOR);
  const e = Math.exp(-v / VT);
  const x = (1 - SAT_A * e) / (1 + SAT_B * e);
  const dx = vce < VCE_FLOOR ? 0 : ((SAT_A + SAT_B) * e) / (VT * (1 + SAT_B * e) ** 2);
  return { x, dx };
}

/** The same for ngspice, on the expression of the collector-emitter voltage. */
export const saturationExpression = (vce: string) => `((1-${SAT_A}*exp(-max(${vce},${VCE_FLOOR})/${VT}))/(1+${SAT_B}*exp(-max(${vce},${VCE_FLOOR})/${VT})))`;

/** The dark current of the phototransistor, as a conductance from collector to emitter: 100 nA at most at 20 V. */
export const OPTO_DARK = 1e-9;
