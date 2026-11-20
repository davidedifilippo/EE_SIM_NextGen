/** The rated forward current of a LED when its properties give none: the 20 mA of the common 5 mm ones. */
export const LED_RATED_MA = 20;

/** The rated current of a LED, in amperes, from its property in milliamperes; the common 20 mA otherwise. */
export function ledRated(value: unknown): number {
  const ma = Number(String(value ?? '').replace(',', '.'));
  return (Number.isFinite(ma) && ma > 0 ? ma : LED_RATED_MA) / 1000;
}

/** The mean current as a share of the rated one, in percent: 100 at the rated current, more beyond it. */
export const ledPercent = (current: number, rated: number) => Math.max(0, (current / rated) * 100);

/**
 * How bright it is drawn, from 0 to 1: the square root of the share of its rated current, so that a PWM at a
 * quarter still shows half the light, and every step of it shows a change; full at the rated current.
 */
export const ledLight = (current: number, rated: number) => Math.min(1, Math.sqrt(Math.max(0, current / rated)));
