/**
 * A seven segment display with a common cathode: each segment is a LED from its pin to the common.
 * Its law is a smooth bend, the same in both engines: almost nothing below the forward voltage, then a
 * straight line through the series resistance. Smooth, so Newton never jumps from off to on.
 */

/** Series resistance of a segment. */
export const SEGMENT_RESISTANCE = 20;
/** How sharp the bend is, in volts: well below a tenth of a volt, as in a real LED. */
export const SEGMENT_KNEE = 0.05;
/** Keeps a segment's pin defined when nothing drives it. */
export const SEGMENT_LEAK = 1e9;

export const SEGMENT_COLORS: { value: string; label: string; forward: number; color: string }[] = [
  { value: 'rosso', label: 'Rosso', forward: 1.8, color: '#ef4444' },
  { value: 'verde', label: 'Verde', forward: 2.1, color: '#22c55e' },
  { value: 'blu', label: 'Blu', forward: 3, color: '#3b82f6' },
];

export const segmentColor = (value: unknown) => SEGMENT_COLORS.find((c) => c.value === value) ?? SEGMENT_COLORS[0];

/** Current through a segment for the voltage across it, and its slope. */
export function segmentPoint(v: number, forward: number): { i: number; g: number } {
  const x = (v - forward) / SEGMENT_KNEE;
  // softplus and its derivative, written so that neither overflows
  const softplus = x > 30 ? x : Math.log1p(Math.exp(x));
  const logistic = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  return { i: (SEGMENT_KNEE / SEGMENT_RESISTANCE) * softplus, g: logistic / SEGMENT_RESISTANCE };
}

/** The same law for ngspice, as the current of a B source from the segment pin to the common. */
export const segmentExpression = (vSegment: string, vCommon: string, forward: number) =>
  `${SEGMENT_KNEE / SEGMENT_RESISTANCE}*ln(1+exp((${vSegment}-${vCommon}-${forward})/${SEGMENT_KNEE}))`;

/** Where each segment a to g is drawn, inside the part: a digit 20 wide and 40 tall, slightly slanted. */
export const SEGMENT_LINES: [number, number, number, number][] = [
  [-2, -20, 16, -20],
  [17, -18, 15, -2],
  [15, 2, 13, 18],
  [-6, 20, 12, 20],
  [-5, 2, -7, 18],
  [-3, -18, -5, -2],
  [-4, 0, 14, 0],
];
