import { TimerSpec } from '../model/types';

/** Typical values of the TI datasheets, at 5 V and 25 °C. */
export const NE555: TimerSpec = { name: 'NE555', vMin: 4.5, vMax: 16, vAbsMax: 18, divider: 5e3, highDrop: 1.2, rHigh: 5, rLow: 8, rDischarge: 10, quiescent: 3e-3, resetLevel: 0.7, iMax: 0.2 };
export const TLC555: TimerSpec = { name: 'TLC555', vMin: 2, vMax: 15, vAbsMax: 18, divider: 100e3, highDrop: 0, rHigh: 150, rLow: 15, rDischarge: 30, quiescent: 170e-6, resetLevel: 1.1, iMax: 0.1 };
