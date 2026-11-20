import blink from './blink/blink.hex?raw';
import pulsante from './pulsante/pulsante.hex?raw';
import potenziometro from './potenziometro/potenziometro.hex?raw';
import termometro from './termometro/termometro.hex?raw';

/** The example sketches, compiled for the Uno by scripts/build-sketches.sh from the .ino beside each. */
/** With the pins each one uses, in its name and in a line under the choice: not the Blink of the IDE, which is D13 alone. */
export const SKETCHES: { value: string; label: string; pins: string; hex: string }[] = [
  { value: 'blink', label: 'Blink (D13 e D12)', pins: 'Accende e spegne insieme, ogni secondo, il LED L della scheda su D13 e un LED esterno su D12.', hex: blink },
  { value: 'pulsante', label: 'Pulsante (D2 e D12)', pins: 'Un pulsante fra D2 e massa, con il pull-up interno, tiene acceso il LED su D12 finché è premuto.', hex: pulsante },
  { value: 'potenziometro', label: 'Potenziometro e PWM (A0 e D9)', pins: 'La tensione su A0 regola con il PWM la luminosità del LED su D9; i valori nel Monitor seriale.', hex: potenziometro },
  { value: 'termometro', label: 'Termometro LM35 (A0)', pins: "L'uscita di un LM35 su A0, 10 mV per grado; la temperatura nel Monitor seriale.", hex: termometro },
];

/** The value of the sketch choice that takes the program from a loaded .hex file. */
export const CUSTOM_SKETCH = 'custom';

/** The program of a board: an example, or the file loaded in it; null if there is none. */
export function sketchHex(sketch: unknown, hex: unknown): string | null {
  if (sketch === CUSTOM_SKETCH) return String(hex ?? '').trim() || null;
  return SKETCHES.find((s) => s.value === sketch)?.hex ?? null;
}
