import { Element, MotorPlate } from '../model/types';

export type { MotorPlate };
import { parseSpiceValue } from '../netlist/values';

/** The parts of the equivalent circuit, the same in both engines. */
export interface MotorParams {
  /** Winding resistance and inductance, in series between + and the inner node. */
  r: number;
  l: number;
  /** Back EMF per radian a second of the output shaft. */
  k: number;
  /** Torque at the output per ampere: k times the efficiency of the gears. */
  kt: number;
  /** The inertia, as a capacitor between the inner node and −: J/(η·K²). */
  c: number;
  /** The current that friction and load take, at any speed but zero. */
  iBrake: number;
  /** The back EMF over which that current reaches its full value: a smooth sign for Newton. */
  eSmooth: number;
  plate: MotorPlate;
}

export const KGF_CM = 0.0980665;
const RPM = (2 * Math.PI) / 60;
/**
 * The sign of the speed turns over in 0.2% of the no-load back EMF: narrow enough that a stalled motor
 * creeps by a few turns a minute at most, wide enough for Newton.
 */
const SMOOTH_SHARE = 0.002;
/** Keeps the inner node defined with the motor disconnected, in both engines. */
export const MOTOR_LEAK = 1e9;

/**
 * The equivalent circuit from the plate: R from the stall current, K from the no-load point, and the
 * torque per ampere from the stall torque, which takes in the losses of the gears. The no-load current
 * is the friction. The load is a braking torque, in kgf·cm, that always opposes the motion.
 */
export function motorParams(plate: MotorPlate, loadKgfCm: number): MotorParams {
  const r = plate.volts / plate.stallCurrent;
  const noLoadSpeed = plate.noLoadRpm * RPM;
  const k = (plate.volts - r * plate.noLoadCurrent) / noLoadSpeed;
  const kt = (plate.stallTorque * KGF_CM) / (plate.stallCurrent - plate.noLoadCurrent);
  return {
    r,
    l: plate.inductance,
    k,
    kt,
    c: plate.tauMech / r,
    iBrake: plate.noLoadCurrent + (Math.max(0, loadKgfCm) * KGF_CM) / kt,
    eSmooth: SMOOTH_SHARE * k * noLoadSpeed,
    plate,
  };
}

export function motorParamsOf(el: Element, plate: MotorPlate, loadProp: string): MotorParams | null {
  const load = parseSpiceValue(String(el.props[loadProp] ?? ''));
  if (load === null || load < 0) return null;
  return motorParams(plate, load);
}

/** The current friction and load take at a back EMF, and its slope for Newton. */
export function brakeCurrent(p: MotorParams, e: number): { i: number; g: number } {
  const t = Math.tanh(e / p.eSmooth);
  return { i: p.iBrake * t, g: (p.iBrake / p.eSmooth) * (1 - t * t) };
}

/** The speed of the output shaft, in turns a minute, from the back EMF. */
export const motorRpm = (p: MotorParams, e: number) => e / p.k / RPM;

export type MotorState = 'running' | 'stalled' | 'overvoltage';

/** Stalled when it barely turns while it draws more than at no load; over the voltage before that. */
export function motorState(p: MotorParams, volts: number, current: number, rpm: number): MotorState {
  if (Math.abs(volts) > p.plate.vMax) return 'overvoltage';
  if (Math.abs(rpm) < 0.02 * p.plate.noLoadRpm && Math.abs(current) > 1.5 * p.plate.noLoadCurrent) return 'stalled';
  return 'running';
}
