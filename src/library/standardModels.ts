import { SpiceModel } from '../model/types';

/**
 * The common parts of the lessons, with models made here from the typical values of their datasheets:
 * the parameters are worked out below from those values, nothing is copied from a model library. Each
 * model is checked against the values it comes from in standardModels.test.ts.
 */

/** Thermal voltage at 27 °C, the temperature SPICE assumes. */
const VT = 0.025865;
const fmt = (x: number) => Number(x.toPrecision(4)).toString();

/** A point of a datasheet: a current, and the voltage it takes. */
export type VI = [current: number, volts: number];

/**
 * IS, N and RS of a junction through three points of its forward curve: V - I·RS = N·VT·ln(I/IS), the
 * series resistance found where the three agree.
 */
export function fitJunction([[i1, v1], [i2, v2], [i3, v3]]: [VI, VI, VI]): { is: number; n: number; rs: number } {
  const nOf = (rs: number) => (v2 - i2 * rs - (v1 - i1 * rs)) / (VT * Math.log(i2 / i1));
  const isOf = (rs: number) => i1 / Math.exp((v1 - i1 * rs) / (nOf(rs) * VT));
  const miss = (rs: number) => nOf(rs) * VT * Math.log(i3 / isOf(rs)) + i3 * rs - v3;
  let [low, high] = [0, (v3 - v1) / (i3 - i1)];
  for (let k = 0; k < 200; k++) {
    const mid = (low + high) / 2;
    if (miss(low) * miss(mid) <= 0) high = mid;
    else low = mid;
  }
  const rs = (low + high) / 2;
  return { is: isOf(rs), n: nOf(rs), rs };
}

export interface DiodeSheet {
  name: string;
  /** Three points of the typical forward curve. */
  forward: [VI, VI, VI];
  /** Repetitive reverse voltage, and the reverse current at it. */
  bv: number;
  ibv: number;
  /** Junction capacitance at zero volts, and the reverse recovery time. */
  cjo: number;
  tt: number;
}

export function diodeCard(d: DiodeSheet): string {
  const { is, n, rs } = fitJunction(d.forward);
  return `.model ${d.name} D(IS=${fmt(is)} N=${fmt(n)} RS=${fmt(rs)} BV=${d.bv} IBV=${fmt(d.ibv)} CJO=${fmt(d.cjo)} M=0.4 VJ=0.7 TT=${fmt(d.tt)})`;
}

export const DIODE_SHEETS: DiodeSheet[] = [
  // 1 A, 1000 V rectifier: about 0.68 V at 10 mA, 0.78 V at 0.1 A, 0.93 V at 1 A
  { name: '1N4007', forward: [[0.01, 0.68], [0.1, 0.78], [1, 0.93]], bv: 1000, ibv: 5e-6, cjo: 15e-12, tt: 3e-6 },
  // 3 A, 1000 V rectifier: about 0.70 V at 0.1 A, 0.83 V at 1 A, 0.93 V at 3 A
  { name: '1N5408', forward: [[0.1, 0.7], [1, 0.83], [3, 0.93]], bv: 1000, ibv: 10e-6, cjo: 30e-12, tt: 3e-6 },
  // 1 A, 40 V Schottky: about 0.22 V at 10 mA, 0.32 V at 0.1 A, 0.48 V at 1 A; fast, no stored charge
  { name: '1N5819', forward: [[0.01, 0.22], [0.1, 0.32], [1, 0.48]], bv: 40, ibv: 1e-3, cjo: 110e-12, tt: 0 },
];

export interface ZenerSheet {
  name: string;
  /** Zener voltage at the test current, and the impedance there. */
  vz: number;
  izt: number;
  zzt: number;
}

/** The forward side of the 1 W zeners: about 0.72 V at 10 mA, 0.82 V at 0.1 A, 0.87 V at 0.2 A. */
const ZENER_FORWARD = fitJunction([[0.01, 0.72], [0.1, 0.82], [0.2, 0.87]]);

/**
 * The slope of the breakdown: what gives the impedance Zzt with the series resistance. SPICE scales the
 * breakdown current by IS, so the knee must stay well inside Vz: NBV·VT·ln(Izt/IS) at most 60% of it,
 * or the zener would conduct at zero volts. Below about 7 V the knee of a real zener is softer than
 * that allows: there the model has a lower impedance than the datasheet.
 */
export const zenerNbv = (z: ZenerSheet) => Math.max(Math.min(((z.zzt - ZENER_FORWARD.rs) * z.izt) / VT, (0.6 * z.vz) / (VT * Math.log(z.izt / ZENER_FORWARD.is))), 0.5);

/** The impedance the model has at the test current. */
export const zenerImpedance = (z: ZenerSheet) => ZENER_FORWARD.rs + (zenerNbv(z) * VT) / z.izt;

/**
 * A zener from its test point: the breakdown takes IBV = Izt at BV, so that with the series resistance it
 * gives Vz there; its slope NBV gives the impedance Zzt with that resistance.
 */
export function zenerCard(z: ZenerSheet): string {
  const { is, n, rs } = ZENER_FORWARD;
  const nbv = zenerNbv(z);
  return `.model ${z.name} D(IS=${fmt(is)} N=${fmt(n)} RS=${fmt(rs)} BV=${fmt(z.vz - rs * z.izt)} IBV=${fmt(z.izt)} NBV=${fmt(nbv)} CJO=100p M=0.4 VJ=0.7)`;
}

/** The 1N47xxA series of 1 W zeners: Vz, Izt and Zzt as the datasheets give them. */
export const ZENER_SHEETS: ZenerSheet[] = [
  { name: '1N4728A', vz: 3.3, izt: 0.076, zzt: 10 },
  { name: '1N4732A', vz: 4.7, izt: 0.053, zzt: 8 },
  { name: '1N4733A', vz: 5.1, izt: 0.049, zzt: 7 },
  { name: '1N4735A', vz: 6.2, izt: 0.041, zzt: 2 },
  { name: '1N4739A', vz: 9.1, izt: 0.028, zzt: 5 },
  { name: '1N4742A', vz: 12, izt: 0.021, zzt: 9 },
  { name: '1N4744A', vz: 15, izt: 0.017, zzt: 14 },
];

export interface BjtSheet {
  name: string;
  type: 'NPN' | 'PNP';
  /** Typical gain at a collector current and voltage, and the base-emitter voltage there. */
  hfe: number;
  ic: number;
  vce: number;
  vbe: number;
  /** Where the gain falls with current, and the Early voltage: estimated from the curves. */
  ikf: number;
  vaf: number;
  /** Series resistances of base, collector and emitter: estimated for the size of the part. */
  rb: number;
  rc: number;
  re: number;
  /** Output capacitance and transition frequency. */
  cob: number;
  ft: number;
  vceo: number;
}

/**
 * Gummel-Poon parameters from the typical point: the high injection factor qb at that current, then BF
 * from the gain and IS from the base-emitter voltage, with the drops on the series resistances.
 */
export function bjtCard(b: BjtSheet): string {
  const early = 1 + (b.vce - b.vbe) / b.vaf;
  const qb = (1 + Math.sqrt(1 + (4 * b.ic) / b.ikf)) / 2;
  const bf = (b.hfe * qb) / early;
  const inner = b.vbe - (b.ic / b.hfe) * b.rb - b.ic * (1 + 1 / b.hfe) * b.re;
  const is = (b.ic * qb) / (early * Math.exp(inner / VT));
  const cje = 3 * b.cob;
  const tf = 1 / (2 * Math.PI * b.ft);
  return `.model ${b.name} ${b.type}(IS=${fmt(is)} BF=${fmt(bf)} VAF=${b.vaf} IKF=${b.ikf} BR=4 RB=${b.rb} RC=${b.rc} RE=${b.re} CJE=${fmt(cje)} CJC=${fmt(b.cob)} TF=${fmt(tf)})`;
}

export const BJT_SHEETS: BjtSheet[] = [
  // Small signal, gain group B: hFE 290 and VBE 0.66 V at 2 mA and 5 V
  { name: 'BC547B', type: 'NPN', hfe: 290, ic: 2e-3, vce: 5, vbe: 0.66, ikf: 0.15, vaf: 100, rb: 10, rc: 1, re: 0.5, cob: 2e-12, ft: 300e6, vceo: 45 },
  { name: 'BC557B', type: 'PNP', hfe: 290, ic: 2e-3, vce: 5, vbe: 0.66, ikf: 0.15, vaf: 60, rb: 10, rc: 1, re: 0.5, cob: 3e-12, ft: 150e6, vceo: 45 },
  // Medium current switches: hFE about 150 and VBE about 0.75 V at 150 mA and 10 V
  { name: '2N2222A', type: 'NPN', hfe: 150, ic: 0.15, vce: 10, vbe: 0.75, ikf: 0.5, vaf: 100, rb: 10, rc: 0.3, re: 0.2, cob: 8e-12, ft: 300e6, vceo: 40 },
  { name: '2N2907A', type: 'PNP', hfe: 150, ic: 0.15, vce: 10, vbe: 0.75, ikf: 0.5, vaf: 100, rb: 10, rc: 0.3, re: 0.2, cob: 8e-12, ft: 200e6, vceo: 60 },
  // Medium power: hFE about 100 and VBE about 0.7 V at 150 mA and 2 V
  { name: 'BD139', type: 'NPN', hfe: 100, ic: 0.15, vce: 2, vbe: 0.7, ikf: 1, vaf: 100, rb: 5, rc: 0.1, re: 0.05, cob: 25e-12, ft: 190e6, vceo: 80 },
  { name: 'BD140', type: 'PNP', hfe: 100, ic: 0.15, vce: 2, vbe: 0.7, ikf: 1, vaf: 100, rb: 5, rc: 0.1, re: 0.05, cob: 35e-12, ft: 190e6, vceo: 80 },
  // Power: hFE about 50 and VBE about 0.85 V at 1 A and 4 V
  { name: 'TIP31C', type: 'NPN', hfe: 50, ic: 1, vce: 4, vbe: 0.85, ikf: 2, vaf: 100, rb: 2, rc: 0.05, re: 0.05, cob: 60e-12, ft: 3e6, vceo: 100 },
  { name: 'TIP32C', type: 'PNP', hfe: 50, ic: 1, vce: 4, vbe: 0.85, ikf: 2, vaf: 100, rb: 2, rc: 0.05, re: 0.05, cob: 100e-12, ft: 3e6, vceo: 100 },
];

/** How smooth the threshold of a VDMOS is, in volts: the default of ngspice. */
const SUBTHRESHOLD = 0.1;

export interface MosSheet {
  name: string;
  type: 'NMOS' | 'PMOS';
  /** VDMOS for the power parts, level 1 for the small ones. */
  isPower: boolean;
  /** Typical threshold at its test current (VGS = VDS), and on resistance at a gate voltage. */
  vth: number;
  ithTest: number;
  rdson: number;
  vgsOn: number;
  /** Of the on resistance, what is in the drain and source themselves: estimated. */
  rSeries: number;
  /** The body diode: about vsd at isd. */
  vsd: number;
  isd: number;
  bv: number;
  ciss: number;
  crss: number;
}

/**
 * Shichman-Hodges from the on resistance: Rds(on) = rSeries + 1/(KP·(VGS - VTO)); VTO a little below
 * the threshold of the datasheet, which is taken at a small current, not at zero.
 */
export function mosCard(m: MosSheet): string {
  const sign = m.type === 'NMOS' ? 1 : -1;
  // First guess of the threshold, then KP from the on resistance, then the threshold again at the test
  // current. A VDMOS smooths its threshold as k·ln(1 + exp((VGS - VTO)/k)): VTO is found through that
  let vto = m.vth;
  let kp = 1;
  for (let k = 0; k < 20; k++) {
    kp = 1 / ((m.rdson - m.rSeries) * (m.vgsOn - vto));
    const vgst = Math.sqrt((2 * m.ithTest) / kp);
    vto = m.vth - (m.isPower ? SUBTHRESHOLD * Math.log(Math.expm1(vgst / SUBTHRESHOLD)) : vgst);
  }
  // The body diode: N of 1.2 on a VDMOS; a level 1 part knows no N, so its IS is found with N of 1
  const bodyN = m.isPower ? 1.2 : 1;
  const diodeIs = m.isd / Math.exp((m.vsd - 0.01 * m.isd) / (bodyN * VT));
  if (m.isPower) {
    const pchan = m.type === 'PMOS' ? 'pchan ' : '';
    return `.model ${m.name} VDMOS(${pchan}VTO=${fmt(sign * vto)} KP=${fmt(kp)} RD=${fmt(m.rSeries * 0.75)} RS=${fmt(m.rSeries * 0.25)} RB=0.01 IS=${fmt(diodeIs)} N=1.2 BV=${m.bv} CGDMAX=${fmt(m.crss * 3)} CGDMIN=${fmt(m.crss / 3)} CGS=${fmt(m.ciss - m.crss)} KSUBTHRES=${SUBTHRESHOLD})`;
  }
  return `.model ${m.name} ${m.type}(VTO=${fmt(sign * vto)} KP=${fmt(kp)} RD=${fmt(m.rSeries / 2)} RS=${fmt(m.rSeries / 2)} IS=${fmt(diodeIs)} CGSO=${fmt((m.ciss - m.crss) / 100e-6)} CGDO=${fmt(m.crss / 100e-6)})`;
}

export const MOS_SHEETS: MosSheet[] = [
  // Small signal: threshold 2.1 V at 1 mA, 1.2 ohm at 10 V
  { name: '2N7000', type: 'NMOS', isPower: false, vth: 2.1, ithTest: 1e-3, rdson: 1.2, vgsOn: 10, rSeries: 0.2, vsd: 0.88, isd: 0.2, bv: 60, ciss: 20e-12, crss: 4e-12 },
  { name: 'BS170', type: 'NMOS', isPower: false, vth: 2.1, ithTest: 1e-3, rdson: 1.2, vgsOn: 10, rSeries: 0.2, vsd: 0.85, isd: 0.2, bv: 60, ciss: 24e-12, crss: 5e-12 },
  // Power: thresholds at 250 µA; on resistances near the maximum, as typical values are seldom given
  { name: 'IRF540N', type: 'NMOS', isPower: true, vth: 3, ithTest: 250e-6, rdson: 0.037, vgsOn: 10, rSeries: 0.02, vsd: 0.9, isd: 16, bv: 100, ciss: 1960e-12, crss: 40e-12 },
  { name: 'IRF9540N', type: 'PMOS', isPower: true, vth: 3, ithTest: 250e-6, rdson: 0.1, vgsOn: 10, rSeries: 0.05, vsd: 0.95, isd: 11, bv: 100, ciss: 1300e-12, crss: 140e-12 },
  // Logic level, for an Arduino pin: threshold 1.5 V, 25 milliohm at 5 V
  { name: 'IRLZ44N', type: 'NMOS', isPower: true, vth: 1.5, ithTest: 250e-6, rdson: 0.025, vgsOn: 5, rSeries: 0.015, vsd: 0.9, isd: 25, bv: 55, ciss: 1700e-12, crss: 140e-12 },
];

const named = (name: string, card: string): SpiceModel => ({ name, card });

/** Every model of the library, in the order of the menus. */
export const STANDARD_MODELS: SpiceModel[] = [
  ...DIODE_SHEETS.map((d) => named(d.name, diodeCard(d))),
  ...ZENER_SHEETS.map((z) => named(z.name, zenerCard(z))),
  ...BJT_SHEETS.map((b) => named(b.name, bjtCard(b))),
  ...MOS_SHEETS.map((m) => named(m.name, mosCard(m))),
];
