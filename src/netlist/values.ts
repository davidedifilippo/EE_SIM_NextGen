const VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|t|g|k|m|u|n|p|f)?[a-z]*$/i;

const SCALE: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  mil: 25.4e-6,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/** Parses a SPICE number ("4.7k", "100u", "1e3"). Trailing unit letters are ignored, as in SPICE. */
export function parseSpiceValue(text: string): number | null {
  const match = VALUE.exec(text.trim());
  if (!match) return null;
  const scale = match[2] ? SCALE[match[2].toLowerCase()] : 1;
  return Number(match[1]) * scale;
}

const FORMATS: [number, string][] = [
  [1e9, 'g'],
  [1e6, 'meg'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'u'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Formats a number as a SPICE value with 3 significant digits: 4700 -> "4.7k". */
export function formatSpiceValue(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const [scale, suffix] = FORMATS.find(([s]) => abs >= s * 0.9995) ?? FORMATS[FORMATS.length - 1];
  return `${Number((value / scale).toPrecision(3))}${suffix}`;
}
