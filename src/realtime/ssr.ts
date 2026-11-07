/**
 * A solid state relay of the Panasonic AQ-G series, from its catalogue: an input circuit, and a triac with
 * its snubber at the output. The version is chosen as its part number does: load current, zero-cross or
 * random turn-on, control voltage.
 */
export interface SsrSpec {
  partNumber: string;
  isZeroCross: boolean;
  /** Input: the impedance, and the voltages at which the control becomes active and lets go. */
  inputResistance: number;
  pickup: number;
  dropout: number;
  controlMax: number;
  reverseMax: number;
  /** Output: the triac on, as a resistance that gives the maximum drop at the rated current. */
  onResistance: number;
  ratedCurrent: number;
  surgeCurrent: number;
  /** The triac goes off when its current falls below this: the minimum load current of the catalogue. */
  holdCurrent: number;
  loadVoltageMax: number;
  /** The snubber across the output. */
  snubberR: number;
  snubberC: number;
  /** A zero-cross type turns on only with the output voltage inside this window. */
  zeroWindow: number;
}

/** From the catalogue: control voltage range and input impedance of each version. */
const CONTROLS = {
  '05': { min: 4, max: 6, impedance: 300 },
  '12': { min: 9.6, max: 14.4, impedance: 800 },
  '24': { min: 19.2, max: 28.8, impedance: 1600 },
} as const;

export const CURRENT_OPTIONS = [
  { value: '1', label: '1 A' },
  { value: '2', label: '2 A' },
];
export const TYPE_OPTIONS = [
  { value: '1', label: 'Zero-cross' },
  { value: '2', label: 'Random' },
];
export const CONTROL_OPTIONS = [
  { value: '05', label: '5 V (4–6 V DC)' },
  { value: '12', label: '12 V (9,6–14,4 V DC)' },
  { value: '24', label: '24 V (19,2–28,8 V DC)' },
];

/** The version as the properties give it: load current, type, control voltage. */
export type SsrVersion = Partial<Record<'current' | 'type' | 'control', string | number>>;

const controlOf = (version: SsrVersion): keyof typeof CONTROLS => {
  const control = String(version.control ?? '05');
  return control in CONTROLS ? (control as keyof typeof CONTROLS) : '05';
};

/** The part number of a version, as AQG 1 2 2 05: current, load voltage, type, control voltage. */
export const ssrPartNumber = (version: SsrVersion) => `AQG${String(version.current) === '2' ? 2 : 1}2${String(version.type) === '2' ? 2 : 1}${controlOf(version)}`;

export function ssrSpecOf(version: SsrVersion): SsrSpec {
  const control = CONTROLS[controlOf(version)];
  const isTwoAmps = String(version.current) === '2';
  const ratedCurrent = isTwoAmps ? 2 : 1;
  return {
    partNumber: ssrPartNumber(version),
    isZeroCross: String(version.type) !== '2',
    inputResistance: control.impedance,
    pickup: control.min,
    dropout: 1,
    controlMax: control.max,
    reverseMax: 3,
    // Max. 1.6 V at the rated current
    onResistance: 1.6 / ratedCurrent,
    ratedCurrent,
    surgeCurrent: isTwoAmps ? 30 : 8,
    holdCurrent: 0.02,
    loadVoltageMax: 264,
    // Estimated: about 1.1 mA at 200 V rms and 60 Hz, under the 1.5 mA at most of the catalogue
    snubberR: 100,
    snubberC: 15e-9,
    zeroWindow: 15,
  };
}

/** The control after a step: active above the minimum control voltage, let go below the drop-out voltage. */
export const nextControl = (spec: SsrSpec, isActive: boolean, input: number) => (isActive ? input > spec.dropout : input >= spec.pickup);

/**
 * The triac after a step. On, it stays on while its current holds, whatever the control: it goes off only
 * at a zero of its current, below the holding current or past it within the step. Off, or let go, it turns
 * on with the control active: at once if random; a zero-cross type waits for the output voltage to come
 * inside its window, or to change sign within the step.
 */
export function nextTriac(spec: SsrSpec, isOn: boolean, isControlled: boolean, now: { current: number; voltage: number }, before: { current: number; voltage: number }): boolean {
  if (isOn && Math.abs(now.current) >= spec.holdCurrent && now.current * before.current >= 0) return true;
  if (!isControlled) return false;
  if (!spec.isZeroCross) return true;
  return Math.abs(now.voltage) <= spec.zeroWindow || now.voltage * before.voltage < 0;
}

/** The triac off: what the snubber leaves aside, as the leaks of the project. */
export const TRIAC_OFF = 1e9;

/** How fast the readings behind the warnings forget: the peak of the load voltage and of the current, and the mean square of the current. */
export const SSR_PEAK_TAU = 0.5;
export const SSR_RMS_TAU = 1;

export interface SsrStatus {
  isControlled: boolean;
  isOn: boolean;
  warnings: string[];
}

/** What is beyond the ratings of the catalogue, from the input voltage and the readings of the output. */
export function ssrWarnings(spec: SsrSpec, input: number, isControlled: boolean, peakVoltage: number, peakCurrent: number, rmsCurrent: number): string[] {
  return [
    ...(input > spec.controlMax ? [`Comando oltre ${String(spec.controlMax).replace('.', ',')} V`] : []),
    ...(input < -spec.reverseMax ? [`Inversa oltre ${spec.reverseMax} V`] : []),
    ...(peakVoltage > spec.loadVoltageMax * Math.SQRT2 ? [`Carico oltre ${spec.loadVoltageMax} V rms`] : []),
    ...(peakCurrent > spec.surgeCurrent ? [`Picco oltre ${spec.surgeCurrent} A`] : rmsCurrent > spec.ratedCurrent ? [`Oltre ${spec.ratedCurrent} A rms`] : []),
    ...(isControlled && rmsCurrent < spec.holdCurrent ? ['Carico sotto 20 mA'] : []),
  ];
}
