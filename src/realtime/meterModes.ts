export type MeterMode = 'vdc' | 'vac' | 'adc' | 'aac' | 'ohm';

export const METER_MODES: { value: MeterMode; label: string; unit: 'V' | 'A' | 'Ω'; symbol: string; /** Where its mark stands around the dial. */ dial: { x: number; y: number } }[] = [
  { value: 'vdc', label: 'Tensione continua', unit: 'V', symbol: 'V ⎓', dial: { x: -31, y: -24 } },
  { value: 'vac', label: 'Tensione alternata (RMS)', unit: 'V', symbol: 'V ~', dial: { x: 31, y: -24 } },
  { value: 'adc', label: 'Corrente continua', unit: 'A', symbol: 'A ⎓', dial: { x: -35, y: 10 } },
  { value: 'aac', label: 'Corrente alternata (RMS)', unit: 'A', symbol: 'A ~', dial: { x: 35, y: 10 } },
  { value: 'ohm', label: 'Resistenza', unit: 'Ω', symbol: 'Ω', dial: { x: 0, y: 32 } },
];
