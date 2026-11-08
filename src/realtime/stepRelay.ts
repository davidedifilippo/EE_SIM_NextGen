/**
 * A step relay of the Finder series 27, from its datasheet (X-2021): each time the coil pulls the armature
 * in, the contacts move on to the next of their sequences. A1/1/3 is common to the coil and the contacts.
 */

export type StepVersion = '27.01' | '27.05' | '27.06';

export interface StepRelaySpec {
  version: StepVersion;
  /** Rated coil voltage, RMS, 50 Hz. */
  volts: number;
  vMax: number;
  coilResistance: number;
  coilInductance: number;
  /** The losses of the iron, across the inductance: where the energy of the coil goes when it is let go. */
  coilLoss: number;
  /** Peak coil currents at which the armature is pulled in, and let go. */
  pickup: number;
  dropout: number;
  /** For each sequence, whether the contact to 2 and the one to 4 are closed. */
  sequences: [boolean, boolean][];
}

const OMEGA = 2 * Math.PI * 50;

/** From the datasheet: resistance and current at the rated voltage, and the range of operation. */
const COILS = {
  '110': { volts: 110, vMin: 88, vMax: 121, resistance: 1400, current: 0.042 },
  '230': { volts: 230, vMin: 184, vMax: 253, resistance: 6500, current: 0.0175 },
} as const;

export const COIL_OPTIONS = [
  { value: '230', label: '230 V AC' },
  { value: '110', label: '110 V AC' },
];

/** The sequences of each version, as the table of the datasheet draws them: the contact to 2, then to 4. */
const SEQUENCES: Record<StepVersion, [boolean, boolean][]> = {
  '27.01': [
    [false, false],
    [true, false],
  ],
  '27.05': [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ],
  '27.06': [
    [false, false],
    [false, true],
    [true, true],
  ],
};

export const VERSION_OPTIONS: { value: StepVersion; label: string; def: string }[] = [
  { value: '27.01', label: '27.01: 1 NA, 2 sequenze', def: 'finder27_01' },
  { value: '27.05', label: '27.05: 2 NA, 4 sequenze', def: 'finder27_05' },
  { value: '27.06', label: '27.06: 2 NA, 3 sequenze', def: 'finder27_06' },
];

/**
 * Estimated: the losses of the iron, across the inductance. Without them a coil opened by its button would
 * keep its energy, and its voltage would ring step after step.
 */
const COIL_LOSS = 100e3;

/**
 * The inductance that, behind the resistance and with the losses across it, takes the current of the
 * datasheet at the rated voltage: |R + (jωL ∥ Rp)| = U / I.
 */
function coilInductance(resistance: number, impedance: number, loss: number): number {
  const size = (l: number) => {
    const x = OMEGA * l;
    const d = loss * loss + x * x;
    return Math.hypot(resistance + (loss * x * x) / d, (loss * loss * x) / d);
  };
  let [low, high] = [1e-3, 1e3];
  for (let k = 0; k < 100; k++) {
    const mid = Math.sqrt(low * high);
    if (size(mid) < impedance) low = mid;
    else high = mid;
  }
  return Math.sqrt(low * high);
}

/** Estimated: the armature lets go below this share of the rated voltage. */
const DROPOUT_SHARE = 0.15;
/** Estimated: how fast the armature forgets the current once it stops, as its shading ring holds it through each zero. */
export const STEP_HOLD_TAU = 0.02;
export const CONTACT_MAX_PEAK = 20;
export const CONTACT_RATED = 10;

export function stepRelaySpec(version: StepVersion, coil: string | number | undefined): StepRelaySpec {
  const c = COILS[String(coil) === '110' ? '110' : '230'];
  const impedance = c.volts / c.current;
  const peakCurrentAt = (volts: number) => (volts * Math.SQRT2) / impedance;
  return {
    version,
    volts: c.volts,
    vMax: c.vMax,
    coilResistance: c.resistance,
    coilInductance: coilInductance(c.resistance, impedance, COIL_LOSS),
    coilLoss: COIL_LOSS,
    // Pulled in at the bottom of the range of operation; let go well below it
    pickup: peakCurrentAt(c.vMin),
    dropout: peakCurrentAt(DROPOUT_SHARE * c.volts),
    sequences: SEQUENCES[version],
  };
}

export interface StepRelayState {
  envelope: number;
  isPulled: boolean;
  step: number;
}

/**
 * After a step of h with the coil current i: the envelope follows the peaks and fades between them, the
 * armature is pulled in above the pick-up and let go below the drop-out, and each pull moves the sequence on.
 */
export function nextStepRelay(spec: StepRelaySpec, state: StepRelayState, current: number, h: number): StepRelayState {
  const envelope = Math.max(Math.abs(current), state.envelope * Math.exp(-h / STEP_HOLD_TAU));
  const isPulled = state.isPulled ? envelope >= spec.dropout : envelope > spec.pickup;
  const step = isPulled && !state.isPulled ? (state.step + 1) % spec.sequences.length : state.step;
  return { envelope, isPulled, step };
}

export interface StepRelayStatus {
  step: number;
  count: number;
  isPulled: boolean;
  contacts: [boolean, boolean];
  warnings: string[];
}

/** By the RMS voltage of the coil: what it opens with for a moment is no fault of the supply. */
export function stepRelayWarnings(spec: StepRelaySpec, coilRms: number, contactPeak: number, contactRms: number): string[] {
  return [
    ...(coilRms > spec.vMax ? [`Bobina oltre ${spec.vMax} V`] : []),
    ...(contactPeak > CONTACT_MAX_PEAK ? [`Contatto oltre ${CONTACT_MAX_PEAK} A di picco`] : contactRms > CONTACT_RATED ? [`Contatto oltre ${CONTACT_RATED} A`] : []),
  ];
}
