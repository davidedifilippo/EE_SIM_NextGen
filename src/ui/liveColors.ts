type Rgb = [number, number, number];

// Diverging scale from the dataviz palette: blue and red poles around a neutral gray.
// The midpoint is darker than the palette's, because a wire at 0 V must stay visible on the sheet.
export const NEGATIVE: Rgb = [42, 120, 214];
export const NEUTRAL: Rgb = [120, 119, 114];
export const POSITIVE: Rgb = [227, 73, 72];

export const toCss = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Color for a voltage as a fraction of the scale, from -1 to 1. */
export function voltageColor(fraction: number): string {
  const clamped = Math.max(-1, Math.min(1, fraction));
  const pole = clamped < 0 ? NEGATIVE : POSITIVE;
  const u = Math.abs(clamped);
  return toCss([0, 1, 2].map((c) => Math.round(NEUTRAL[c] + (pole[c] - NEUTRAL[c]) * u)) as Rgb);
}
