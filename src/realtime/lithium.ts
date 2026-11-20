/**
 * A lithium pack of cells in series, LiPo or Li-ion: 3.7 V each, 4.2 V full and 3.0 V empty. Its open circuit
 * voltage follows its charge along a typical curve at 0.2C, behind a resistance that falls with its size; a
 * protection (BMS) opens its output when it is empty, until it is charged again. Its charge may run faster than
 * the rest of the circuit: an hour of battery for a second, while a DC circuit stays much as it was.
 */

/** Charge from 0 to 1, and the open circuit voltage of one cell there: a typical LiPo at 0.2C, estimated. */
const CURVE: [charge: number, volts: number][] = [
  [0, 3.0],
  [0.05, 3.45],
  [0.1, 3.58],
  [0.2, 3.67],
  [0.3, 3.72],
  [0.4, 3.76],
  [0.5, 3.8],
  [0.6, 3.85],
  [0.7, 3.91],
  [0.8, 3.98],
  [0.9, 4.08],
  [1, 4.2],
];

/** The open circuit voltage of one cell at a charge, along the curve. */
export function cellVoltage(charge: number): number {
  const c = Math.min(1, Math.max(0, charge));
  const k = CURVE.findIndex(([at]) => at >= c);
  if (k <= 0) return CURVE[0][1];
  const [[c0, v0], [c1, v1]] = [CURVE[k - 1], CURVE[k]];
  return v0 + ((v1 - v0) * (c - c0)) / (c1 - c0);
}

/** Estimated: about 50 mΩ for a cell of 1 Ah, less for a bigger one, never under 5 mΩ. */
export const cellResistance = (ampHours: number) => Math.max(0.005, 0.05 / ampHours);

export const CELL_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}S, ${(3.7 * n).toFixed(1).replace('.', ',')} V` }));
export const CAPACITY_OPTIONS = ['0.5', '1', '1.5', '2', '2.2', '3', '4', '5', '6', '8', '10'].map((value) => ({ value, label: `${value.replace('.', ',')} Ah` }));
/** Seconds of battery for each real second; real follows the time of the simulation. */
export const PACE_OPTIONS = [
  { value: 'real', label: 'Reale, come la simulazione' },
  { value: '60', label: '1 minuto al secondo' },
  { value: '600', label: '10 minuti al secondo' },
  { value: '3600', label: "1 ora al secondo" },
];

export interface LithiumSpec {
  cells: number;
  ampHours: number;
  /** Seconds of battery for a real second, or null to follow the simulation. */
  pace: number | null;
}

export function lithiumSpec(cells: unknown, capacity: unknown, pace: unknown): LithiumSpec | null {
  const n = Number(cells);
  const ah = Number(capacity);
  if (!Number.isInteger(n) || n < 1 || n > 5 || !Number.isFinite(ah) || ah <= 0 || ah > 10) return null;
  const p = Number(pace);
  return { cells: n, ampHours: ah, pace: pace === 'real' || !Number.isFinite(p) || p <= 0 ? null : p };
}

/** The pack: its open circuit voltage at a charge, and its resistance. */
export const packVoltage = (spec: LithiumSpec, charge: number) => spec.cells * cellVoltage(charge);
export const packResistance = (spec: LithiumSpec) => spec.cells * cellResistance(spec.ampHours);

/**
 * How many seconds of battery pass in a second of simulation: 1 to follow it, else the pace of the battery over
 * how fast the simulation runs against real time.
 */
export const batterySecondsPerSimSecond = (spec: LithiumSpec, simPerReal: number) => (spec.pace === null || simPerReal <= 0 ? 1 : spec.pace / simPerReal);

/** The charge after a step of h seconds of simulation with a current out of the positive pole, from 0 to 1. */
export function nextCharge(spec: LithiumSpec, charge: number, delivered: number, h: number, simPerReal: number): number {
  const used = (delivered * h * batterySecondsPerSimSecond(spec, simPerReal)) / (spec.ampHours * 3600);
  return Math.min(1, Math.max(0, charge - used));
}

export interface BatteryStatus {
  /** From 0 to 1. */
  charge: number;
  /** Opened by its protection, empty. */
  isCut: boolean;
  /** Seconds of battery left at the present current, or null when it is not delivering. */
  autonomy: number | null;
}
