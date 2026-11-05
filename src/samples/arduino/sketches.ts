import blink from './blink/blink.hex?raw';
import pulsante from './pulsante/pulsante.hex?raw';
import potenziometro from './potenziometro/potenziometro.hex?raw';
import termometro from './termometro/termometro.hex?raw';

/** The example sketches, compiled for the Uno by scripts/build-sketches.sh from the .ino beside each. */
export const SKETCHES: { value: string; label: string; hex: string }[] = [
  { value: 'blink', label: 'Blink', hex: blink },
  { value: 'pulsante', label: 'Pulsante', hex: pulsante },
  { value: 'potenziometro', label: 'Potenziometro e PWM', hex: potenziometro },
  { value: 'termometro', label: 'Termometro LM35', hex: termometro },
];

/** The value of the sketch choice that takes the program from a loaded .hex file. */
export const CUSTOM_SKETCH = 'custom';

/** The program of a board: an example, or the file loaded in it; null if there is none. */
export function sketchHex(sketch: unknown, hex: unknown): string | null {
  if (sketch === CUSTOM_SKETCH) return String(hex ?? '').trim() || null;
  return SKETCHES.find((s) => s.value === sketch)?.hex ?? null;
}
