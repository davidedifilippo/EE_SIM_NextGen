export type MeterMode = 'vdc' | 'vac' | 'adc' | 'aac';

export const METER_MODES: { value: MeterMode; label: string; unit: 'V' | 'A'; symbol: string }[] = [
  { value: 'vdc', label: 'Tensione continua', unit: 'V', symbol: 'V ⎓' },
  { value: 'vac', label: 'Tensione alternata (RMS)', unit: 'V', symbol: 'V ~' },
  { value: 'adc', label: 'Corrente continua', unit: 'A', symbol: 'A ⎓' },
  { value: 'aac', label: 'Corrente alternata (RMS)', unit: 'A', symbol: 'A ~' },
];
