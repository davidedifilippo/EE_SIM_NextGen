import { formatEngineering } from '../ui/chartMath';
import { parseSpiceValue } from './values';

export type SourceShape = 'sin' | 'square' | 'dc' | 'custom';
type SourceProps = Record<string, string | number>;

/** Square edges, as a fraction of the period. Both engines then start from the low level. */
const SQUARE_EDGE = 1e-4;
export const MIN_DUTY = 1;
export const MAX_DUTY = 99;

/** An element with a raw spec and no shape is an advanced source. */
export function sourceShape(props: SourceProps): SourceShape {
  const { shape } = props;
  if (shape === 'sin' || shape === 'square' || shape === 'dc' || shape === 'custom') return shape;
  return props.spec !== undefined ? 'custom' : 'sin';
}

const field = (props: SourceProps, key: string) => parseSpiceValue(String(props[key] ?? ''));

/** Fields that may be left empty count as 0. */
const optionalField = (props: SourceProps, key: string) => (String(props[key] ?? '').trim() === '' ? 0 : field(props, key));

/** Duty cycle in percent, 50 if left empty, or null if out of range. */
export function dutyCycle(props: SourceProps): number | null {
  if (String(props.duty ?? '').trim() === '') return 50;
  const duty = field(props, 'duty');
  return duty !== null && duty >= MIN_DUTY && duty <= MAX_DUTY ? duty : null;
}

/** Text of an advanced source. It must stay on one line: anything else could inject extra SPICE commands. */
function customSpec(props: SourceProps): string | null {
  const spec = String(props.spec ?? '').trim();
  return spec && !/[\r\n]/.test(spec) ? spec : null;
}

/** The source as the engines read it, or null if a field is not valid. */
export function sourceSpec(props: SourceProps): string | null {
  const shape = sourceShape(props);
  if (shape === 'custom') return customSpec(props);

  const amplitude = field(props, 'amplitude');
  if (amplitude === null) return null;
  if (shape === 'dc') return `DC ${amplitude}`;

  const offset = optionalField(props, 'offset');
  const frequency = field(props, 'frequency');
  if (offset === null || frequency === null || frequency <= 0) return null;

  if (shape === 'square') {
    const duty = dutyCycle(props);
    if (duty === null) return null;
    const period = 1 / frequency;
    const edge = period * SQUARE_EDGE;
    // Measured at half height: the high time includes half of each edge
    return `PULSE(${offset - amplitude} ${offset + amplitude} 0 ${edge} ${edge} ${(period * duty) / 100 - edge} ${period})`;
  }

  const phase = optionalField(props, 'phase');
  if (phase === null) return null;
  return `SIN(${offset} ${amplitude} ${frequency}${phase !== 0 ? ` 0 0 ${phase}` : ''})`;
}

/** What the schematic shows next to the source. */
export function sourceLabel(props: SourceProps): string {
  const shape = sourceShape(props);
  const spec = sourceSpec(props);
  if (shape === 'custom') return spec ?? '?';
  if (spec === null) return '?';
  const amplitude = formatEngineering(field(props, 'amplitude')!, 'V');
  return shape === 'dc' ? amplitude : `${amplitude} · ${formatEngineering(field(props, 'frequency')!, 'Hz')}`;
}
