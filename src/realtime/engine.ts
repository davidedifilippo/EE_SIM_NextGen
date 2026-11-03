import { gateOutput, LOGIC_INPUT_RESISTANCE, LOGIC_OUTPUT_RESISTANCE, readLevel } from './logic';
import { REGULATOR_GAIN, REGULATOR_LEAK, RegulatorRegion, regulatorPoint, regulatorPower, THERMAL_RESTART, THERMAL_SHUTDOWN, THERMAL_STEPS } from './regulator';
import { BjtParams, CompiledCircuit, CompiledDevice, DiodeParams, MosParams } from './compile';
import { luFactor, luSolve } from './linear';
import { CURRENT_SOURCE_LEAK, OPAMP_GAIN, TRANSFORMER_WINDING_RESISTANCE } from '../netlist/generate';

/** Same default as SPICE: minimum conductance across a junction. */
const GMIN = 1e-12;
/** Conductance from every node to ground, so an unconnected node never makes the matrix singular. */
const NODE_SHUNT = 1e-12;
const VOLTAGE_ABSTOL = 1e-6;
const RELTOL = 1e-4;
const MAX_ITERATIONS = 60;
/** How far the output may pass a rail, or the target stay inside it, before an op amp changes state. */
const OPAMP_MARGIN = 1e-6;
/** Changes of state within one solution before calling it a failure, and trying a shorter step. */
const MAX_OPAMP_CHANGES = 24;
/** A short across an ideal source, or two of them in parallel, leaves the equations without a solution. */
const UNSOLVABLE = 'Circuito non risolvibile: un generatore ideale o un induttore è in cortocircuito, o in parallelo a un altro. Dai al generatore una resistenza interna';
/** Rounds of the logic at the operating point: more than the longest chain of gates in a lesson. */
const LOGIC_SETTLE_ROUNDS = 64;
const TRANSFORMER_LEAK_CONDUCTANCE = 1e-9;
/** A step short enough for any capacitor in a circuit to act as a short. */
const FIRST_INSTANT = 1e-9;
/** State of an ideal op amp: linear, or stuck on one of its rails. */
const LINEAR = 0;

/** A failed step is retried at half the size, up to this many times. */
const MAX_HALVINGS = 8;

export class SolverError extends Error {}

const exp = (x: number) => Math.exp(Math.min(x, 200));

/**
 * Keeps the Newton iteration from jumping along the exponential: a large voltage change becomes
 * the change that gives the same current on the tangent (junction limiting, Nagel's SPICE2).
 */
function limitJunction(v: number, vOld: number, nvt: number, vCrit: number): number {
  if (v <= vCrit || Math.abs(v - vOld) <= 2 * nvt) return v;
  if (vOld > 0) {
    const arg = 1 + (v - vOld) / nvt;
    return arg > 0 ? vOld + nvt * Math.log(arg) : vCrit;
  }
  return nvt * Math.log(v / nvt);
}

const criticalVoltage = (is: number, nvt: number) => nvt * Math.log(nvt / (Math.SQRT2 * is));

/** Breakdown is a junction seen from the other side: the limiter applies there too. */
function limitDiode(v: number, vOld: number, { breakdown, nvt, is }: DiodeParams, vCrit: number): number {
  if (breakdown && v < Math.min(0, -breakdown.voltage + 10 * breakdown.nvt)) {
    const seen = limitJunction(-(v + breakdown.voltage), -(vOld + breakdown.voltage), breakdown.nvt, criticalVoltage(is, breakdown.nvt));
    return -(seen + breakdown.voltage);
  }
  return limitJunction(v, vOld, nvt, vCrit);
}

/** SPICE junction: exponential forward, a smooth saturation below -3 n Vt. Writes into the shared result. */
const junctionResult = { i: 0, g: 0 };
function junction(v: number, is: number, nvt: number) {
  if (v >= -3 * nvt) {
    const e = exp(v / nvt);
    junctionResult.i = is * (e - 1);
    junctionResult.g = (is / nvt) * e;
  } else {
    const arg = Math.pow((3 * nvt) / (v * Math.E), 3);
    junctionResult.i = -is * (1 + arg);
    junctionResult.g = (is * 3 * arg) / v;
  }
  return junctionResult;
}

function diodeOperatingPoint(v: number, { is, nvt, breakdown }: DiodeParams) {
  if (breakdown && v < -breakdown.voltage) {
    const e = exp(-(breakdown.voltage + v) / breakdown.nvt);
    junctionResult.i = -is * e;
    junctionResult.g = (is * e) / breakdown.nvt;
    return junctionResult;
  }
  return junction(v, is, nvt);
}

/** Gummel-Poon currents and conductances at the given junction voltages, as in SPICE's BJT model. */
function bjtOperatingPoint(p: BjtParams, vbe: number, vbc: number) {
  const be = junction(vbe, p.is, p.nfVt);
  const [cbe, gbe] = [be.i, be.g];
  const bc = junction(vbc, p.is, p.nrVt);
  const [cbc, gbc] = [bc.i, bc.g];
  const leakBe = junction(vbe, p.ise, p.neVt);
  const [cben, gben] = [leakBe.i + GMIN * vbe, leakBe.g + GMIN];
  const leakBc = junction(vbc, p.isc, p.ncVt);
  const [cbcn, gbcn] = [leakBc.i + GMIN * vbc, leakBc.g + GMIN];

  const q1 = 1 / (1 - p.ovaf * vbc - p.ovar * vbe);
  let [qb, dqbdve, dqbdvc] = [q1, q1 * q1 * p.ovar, q1 * q1 * p.ovaf];
  if (p.oikf !== 0 || p.oikr !== 0) {
    const arg = Math.max(0, 1 + 4 * (p.oikf * cbe + p.oikr * cbc));
    const sq = arg !== 0 ? Math.pow(arg, p.nkf) : 1;
    // Derivative of arg^nkf over 2: at nkf = 0.5 this is 1/sqrt(arg), as in the original model
    const slope = arg !== 0 ? (2 * sq * p.nkf) / arg : 1;
    qb = (q1 * (1 + sq)) / 2;
    dqbdve = q1 * (qb * p.ovar + p.oikf * gbe * slope);
    dqbdvc = q1 * (qb * p.ovaf + p.oikr * gbc * slope);
  }

  const transport = cbe - cbc;
  const go = (gbc + (transport * dqbdvc) / qb) / qb;
  return {
    ic: transport / qb - cbc / p.br - cbcn,
    ib: cbe / p.bf + cben + cbc / p.br + cbcn,
    go,
    gm: (gbe - (transport * dqbdve) / qb) / qb - go,
    gpi: gbe / p.bf + gben,
    gmu: gbc / p.br + gbcn,
  };
}

/** Keeps a gate voltage from jumping across the threshold in one iteration, as SPICE's FETLIM does. */
function limitGate(next: number, old: number, vth: number): number {
  const high = Math.abs(2 * (old - vth)) + 2;
  const low = high / 2 + 2;
  const on = vth + 3.5;
  const delta = next - old;
  if (old >= vth) {
    if (old >= on) {
      if (delta <= 0) return next >= on ? (-delta > low ? old - low : next) : Math.max(next, vth + 2);
      return delta >= high ? old + high : next;
    }
    return delta <= 0 ? Math.max(next, vth - 0.5) : Math.min(next, vth + 4);
  }
  if (delta <= 0) return -delta > high ? old - high : next;
  const edge = vth + 0.5;
  return next <= edge ? (delta > low ? old + low : next) : edge;
}

/** Same for a drain voltage, as SPICE's LIMVDS does. */
function limitDrain(next: number, old: number): number {
  if (old >= 3.5) return next > old ? Math.min(next, 3 * old + 2) : next < 3.5 ? Math.max(next, 2) : next;
  return next > old ? Math.min(next, 4) : Math.max(next, -0.5);
}

/** Channel current and conductances, with drain and source exchanged when the drain goes below the source. */
function mosOperatingPoint(p: MosParams, vgs: number, vds: number) {
  const isReversed = vds < 0;
  const [vControl, vChannel] = isReversed ? [vgs - vds, -vds] : [vgs, vds];
  const lambda = isReversed && p.signedLambda ? -p.lambda : p.lambda;

  const over = vControl - p.vth;
  let [vgst, dVgst] = [over, 1];
  if (p.subthreshold > 0) {
    const arg = over / p.subthreshold;
    if (arg < 40) {
      const e = Math.exp(arg);
      vgst = p.subthreshold * Math.log1p(e);
      dVgst = e / (1 + e);
    }
  }

  let [id, gm, gds] = [0, 0, 0];
  if (vgst > 0) {
    const betap = p.beta * (1 + lambda * vChannel);
    const vEff = vChannel * p.mtriode;
    if (vgst <= vEff) {
      id = (betap * vgst * vgst) / 2;
      gm = betap * vgst * dVgst;
      gds = (lambda * p.beta * vgst * vgst) / 2;
    } else {
      id = betap * vEff * (vgst - vEff / 2);
      gm = betap * vEff * dVgst;
      gds = betap * p.mtriode * (vgst - vEff) + lambda * p.beta * vEff * (vgst - vEff / 2);
    }
  }
  return { id, gm, gds, isReversed };
}

/**
 * Modified nodal analysis with Newton-Raphson. Capacitors and inductors use trapezoidal
 * companion models, the default integration method of ngspice.
 */
const [REGULATOR_ACTIVE, REGULATOR_NOT_GIVING, REGULATOR_AT_LIMIT] = [0, 1, 2];

export class RealtimeEngine {
  time = 0;
  /** Node voltages followed by branch currents. */
  readonly x: Float64Array;

  private readonly n: number;
  private readonly base: Float64Array;
  private readonly lu: Float64Array;
  private readonly pivots: Int32Array;
  private readonly rhs: Float64Array;
  private readonly start: Float64Array;
  private readonly isNonlinear: boolean;
  private readonly vCrit: Float64Array;

  /** Per device: capacitor/inductor voltage and current at the last accepted point, diode or base-emitter junction voltage. */
  private readonly vPrev: Float64Array;
  private readonly iPrev: Float64Array;
  /** The same for the secondary of a transformer. */
  private readonly vPrev2: Float64Array;
  private readonly iPrev2: Float64Array;
  private readonly vIter: Float64Array;
  /** Base-collector junction voltage of a bipolar transistor, drain-source voltage of a MOSFET. */
  private readonly vIterBc: Float64Array;
  /** Body diode voltage of a MOSFET. */
  private readonly vIterBody: Float64Array;
  /** Per op amp: LINEAR, or +1 and -1 for its rails. */
  private readonly opAmpState: Int8Array;
  private readonly regulatorTj: Float64Array;
  private readonly regulatorIsOff: Uint8Array;
  private readonly regulatorState: Int8Array;
  /** Per logic part: its output level, and the level each input last read, one bit per input. */
  private readonly logicOut: Uint8Array;
  private readonly logicIn: Int32Array;
  private readonly unitRhs: Float64Array;
  private readonly opAmps: { index: number; device: Extract<CompiledDevice, { kind: 'opamp' }> }[] = [];
  private opAmpChanges = 0;
  private stepForOpAmps = 0;
  /** Set while asking whether a loop runs away, which does not depend on how fast it does. */
  private isProbingLoops = false;
  /** Op amps just sent to a rail: the last solution still assumes them linear, and says nothing about them. */
  private readonly opAmpsToHold = new Set<number>();

  /** Step the base matrix is stamped for; 0 means the DC operating point. */
  private stampedStep: number | null = null;
  private luValid = false;

  constructor(readonly compiled: CompiledCircuit) {
    const { size, devices } = compiled;
    this.n = size;
    this.x = new Float64Array(size);
    this.base = new Float64Array(size * size);
    this.lu = new Float64Array(size * size);
    this.pivots = new Int32Array(size);
    this.rhs = new Float64Array(size);
    this.start = new Float64Array(size);
    this.vPrev = new Float64Array(devices.length);
    this.iPrev = new Float64Array(devices.length);
    this.vPrev2 = new Float64Array(devices.length);
    this.iPrev2 = new Float64Array(devices.length);
    this.vIter = new Float64Array(devices.length);
    this.vIterBc = new Float64Array(devices.length);
    this.vIterBody = new Float64Array(devices.length);
    this.opAmpState = new Int8Array(devices.length);
    this.regulatorTj = Float64Array.from(devices, (d) => (d.kind === 'regulator' ? d.params.ambient : 0));
    this.regulatorIsOff = new Uint8Array(devices.length);
    this.regulatorState = new Int8Array(devices.length);
    this.logicOut = new Uint8Array(devices.length);
    this.logicIn = new Int32Array(devices.length);
    this.resetLogic();
    this.unitRhs = new Float64Array(size);
    this.vCrit = new Float64Array(devices.length);
    devices.forEach((d, i) => {
      if (d.kind === 'diode') this.vCrit[i] = criticalVoltage(d.params.is, d.params.nvt);
      else if (d.kind === 'mos') this.vCrit[i] = criticalVoltage(d.params.body.is, d.params.body.nvt);
      else if (d.kind === 'bjt') this.vCrit[i] = criticalVoltage(d.params.is, d.params.vt);
      else if (d.kind === 'opamp') this.opAmps.push({ index: i, device: d });
    });
    this.isNonlinear = devices.some((d) => d.kind === 'diode' || d.kind === 'bjt' || d.kind === 'mos' || d.kind === 'opamp' || d.kind === 'regulator');
  }

  private voltage(node: number): number {
    return node < 0 ? 0 : this.x[node];
  }

  private addG(a: number, b: number, g: number) {
    const { base, n } = this;
    if (a >= 0) base[a * n + a] += g;
    if (b >= 0) base[b * n + b] += g;
    if (a >= 0 && b >= 0) {
      base[a * n + b] -= g;
      base[b * n + a] -= g;
    }
  }

  private addBranchColumns(a: number, b: number, branch: number) {
    const { base, n } = this;
    if (a >= 0) {
      base[a * n + branch] += 1;
      base[branch * n + a] += 1;
    }
    if (b >= 0) {
      base[b * n + branch] -= 1;
      base[branch * n + b] -= 1;
    }
  }

  /** The part of the matrix that depends only on the step size. */
  private stampBase(h: number) {
    if (this.stampedStep === h) return;
    const { base, n } = this;
    base.fill(0);
    for (let i = 0; i < n; i++) base[i * n + i] = 0;

    this.compiled.devices.forEach((d) => {
      switch (d.kind) {
        case 'resistor':
          this.addG(d.a, d.b, d.g);
          break;
        case 'capacitor':
          if (h > 0) this.addG(d.a, d.b, (2 * d.c) / h);
          break;
        case 'inductor':
          this.addBranchColumns(d.a, d.b, d.branch);
          base[d.branch * n + d.branch] = h > 0 ? (-2 * d.l) / h : 0;
          break;
        case 'vsource':
          this.addBranchColumns(d.a, d.b, d.branch);
          // V(a) - V(b) - r*i = e, with i the current entering a: a battery sinks as it delivers
          base[d.branch * n + d.branch] = -d.r;
          break;
        case 'opamp':
          this.addBranchColumns(d.a, d.b, d.branch);
          break;
        case 'isource':
          this.addG(d.a, d.b, 1 / CURRENT_SOURCE_LEAK);
          break;
        case 'regulator':
          this.addG(d.a, d.base, 1 / REGULATOR_LEAK);
          this.addG(d.b, d.base, 1 / REGULATOR_LEAK);
          break;
        case 'transformer':
          this.addG(d.a, d.ap, 1 / TRANSFORMER_WINDING_RESISTANCE);
          this.addG(d.c, d.cp, 1 / TRANSFORMER_WINDING_RESISTANCE);
          // The same reference to ground that the netlist gives a winding isolated from it
          this.addG(d.a, -1, TRANSFORMER_LEAK_CONDUCTANCE);
          this.addG(d.c, -1, TRANSFORMER_LEAK_CONDUCTANCE);
          this.addBranchColumns(d.ap, d.b, d.branch);
          this.addBranchColumns(d.cp, d.d, d.branch2);
          if (h > 0) {
            // Each winding sees its own inductance and the mutual one, in the trapezoidal companion
            base[d.branch * n + d.branch] = (-2 * d.l1) / h;
            base[d.branch * n + d.branch2] = (-2 * d.m) / h;
            base[d.branch2 * n + d.branch] = (-2 * d.m) / h;
            base[d.branch2 * n + d.branch2] = (-2 * d.l2) / h;
          }
          break;
        case 'diode':
          if (d.params.rs > 0) this.addG(d.a, d.junction, 1 / d.params.rs);
          break;
        case 'logic':
          this.addG(d.a, -1, 1 / LOGIC_OUTPUT_RESISTANCE);
          for (const input of d.inputs) this.addG(input, -1, 1 / LOGIC_INPUT_RESISTANCE);
          break;
        case 'bjt':
          if (d.params.rc > 0) this.addG(d.a, d.cp, 1 / d.params.rc);
          if (d.params.rb > 0) this.addG(d.base, d.bp, 1 / d.params.rb);
          if (d.params.re > 0) this.addG(d.b, d.ep, 1 / d.params.re);
          break;
        case 'mos':
          if (d.params.rd > 0) this.addG(d.a, d.dp, 1 / d.params.rd);
          if (d.params.rs > 0) this.addG(d.b, d.sp, 1 / d.params.rs);
          if (d.params.rb > 0) this.addG(d.a, d.bodyNode, 1 / d.params.rb);
          break;
      }
    });

    const branchStart = this.branchStart();
    for (let i = 0; i < branchStart; i++) base[i * n + i] += NODE_SHUNT;
    this.stampedStep = h;
    this.luValid = false;
  }

  private branchStart(): number {
    let first = this.n;
    for (const d of this.compiled.devices) {
      if ((d.kind === 'inductor' || d.kind === 'vsource' || d.kind === 'opamp' || d.kind === 'transformer') && d.branch < first) first = d.branch;
    }
    return first;
  }

  private stampRhs(t: number, h: number, sourceScale: number) {
    const { rhs } = this;
    rhs.fill(0);
    this.compiled.devices.forEach((d, i) => {
      switch (d.kind) {
        case 'capacitor':
          if (h > 0) {
            const ieq = ((2 * d.c) / h) * this.vPrev[i] + this.iPrev[i];
            if (d.a >= 0) rhs[d.a] += ieq;
            if (d.b >= 0) rhs[d.b] -= ieq;
          }
          break;
        case 'inductor':
          rhs[d.branch] = h > 0 ? ((-2 * d.l) / h) * this.iPrev[i] - this.vPrev[i] : 0;
          break;
        case 'vsource':
          rhs[d.branch] = d.wave(t) * sourceScale;
          break;
        case 'isource':
          if (d.a >= 0) rhs[d.a] -= d.current * sourceScale;
          if (d.b >= 0) rhs[d.b] += d.current * sourceScale;
          break;
        case 'logic':
          // The output as the current source of its Norton equivalent
          if (d.a >= 0 && this.logicOut[i]) rhs[d.a] += (d.vdd / LOGIC_OUTPUT_RESISTANCE) * sourceScale;
          break;
        case 'transformer':
          if (h > 0) {
            rhs[d.branch] = ((-2 * d.l1) / h) * this.iPrev[i] + ((-2 * d.m) / h) * this.iPrev2[i] - this.vPrev[i];
            rhs[d.branch2] = ((-2 * d.m) / h) * this.iPrev[i] + ((-2 * d.l2) / h) * this.iPrev2[i] - this.vPrev2[i];
          }
          break;
      }
    });
  }

  private addLu(row: number, column: number, g: number) {
    if (row >= 0 && column >= 0) this.lu[row * this.n + column] += g;
  }

  private addRhs(row: number, value: number) {
    if (row >= 0) this.rhs[row] += value;
  }

  /** Adds the linearized transistor: the currents leaving its nodes are ic, ib and their opposite sum. */
  private stampBjt(i: number, d: Extract<CompiledDevice, { kind: 'bjt' }>): boolean {
    const { polarity, nfVt, nrVt } = d.params;
    const [vb, vc, ve] = [this.voltage(d.bp), this.voltage(d.cp), this.voltage(d.ep)];
    const [rawBe, rawBc] = [polarity * (vb - ve), polarity * (vb - vc)];
    const vbe = limitJunction(rawBe, this.vIter[i], nfVt, this.vCrit[i]);
    const vbc = limitJunction(rawBc, this.vIterBc[i], nrVt, this.vCrit[i]);
    this.vIter[i] = vbe;
    this.vIterBc[i] = vbc;

    const { ic, ib, gm, go, gpi, gmu } = bjtOperatingPoint(d.params, vbe, vbc);
    const icEq = polarity * (ic - (gm + go) * vbe + (go + gmu) * vbc);
    const ibEq = polarity * (ib - gpi * vbe - gmu * vbc);

    this.addLu(d.cp, d.bp, gm - gmu);
    this.addLu(d.cp, d.cp, go + gmu);
    this.addLu(d.cp, d.ep, -(gm + go));
    this.addLu(d.bp, d.bp, gpi + gmu);
    this.addLu(d.bp, d.cp, -gmu);
    this.addLu(d.bp, d.ep, -gpi);
    this.addLu(d.ep, d.bp, -(gm + gpi));
    this.addLu(d.ep, d.cp, -go);
    this.addLu(d.ep, d.ep, gm + go + gpi);
    this.addRhs(d.cp, -icEq);
    this.addRhs(d.bp, -ibEq);
    this.addRhs(d.ep, icEq + ibEq);
    return vbe !== rawBe || vbc !== rawBc;
  }

  /** Adds the linearized MOSFET and its body diode, which runs from source to drain on an N channel. */
  private stampMos(i: number, d: Extract<CompiledDevice, { kind: 'mos' }>): boolean {
    const { polarity, vth, body } = d.params;
    const [vg, vd, vs] = [this.voltage(d.base), this.voltage(d.dp), this.voltage(d.sp)];
    const [rawGs, rawDs] = [polarity * (vg - vs), polarity * (vd - vs)];
    const [oldGs, oldDs] = [this.vIter[i], this.vIterBc[i]];
    let [vgs, vds] = [rawGs, rawDs];
    if (oldDs >= 0) {
      vgs = limitGate(rawGs, oldGs, vth);
      vds = limitDrain(rawDs, oldDs);
    } else {
      // Below the source the drain acts as the source: the same limits, seen from there
      const vgd = limitGate(rawGs - rawDs, oldGs - oldDs, vth);
      // Recomputed only if limited: rounding would otherwise read as a change and Newton would never stop
      if (vgd !== rawGs - rawDs) vds = rawGs - vgd;
      vds = -limitDrain(-vds, -oldDs);
    }
    this.vIter[i] = vgs;
    this.vIterBc[i] = vds;

    const { id, gm, gds, isReversed } = mosOperatingPoint(d.params, vgs, vds);
    // Current into the drain, by terminal voltages: the two modes only exchange the roles of drain and source
    const [dVg, dVd, dVs] = isReversed ? [-gm, gm + gds, -gds] : [gm, gds, -(gm + gds)];
    const nodeCurrent = isReversed ? -id : id;
    const idEq = polarity * (nodeCurrent - dVg * vgs - dVd * vds);
    // Conductances against vgs and vds: vs does not appear because they are relative to the source
    this.addLu(d.dp, d.base, dVg);
    this.addLu(d.dp, d.dp, dVd);
    this.addLu(d.dp, d.sp, dVs);
    this.addLu(d.sp, d.base, -dVg);
    this.addLu(d.sp, d.dp, -dVd);
    this.addLu(d.sp, d.sp, -dVs);
    this.addRhs(d.dp, -idEq);
    this.addRhs(d.sp, idEq);

    const rawBody = polarity * (this.voltage(d.b) - this.voltage(d.bodyNode));
    const vBody = limitDiode(rawBody, this.vIterBody[i], body, this.vCrit[i]);
    this.vIterBody[i] = vBody;
    const point = diodeOperatingPoint(vBody, body);
    const g = point.g + GMIN;
    const iEq = polarity * (point.i + GMIN * vBody - g * vBody);
    this.addLu(d.b, d.b, g);
    this.addLu(d.b, d.bodyNode, -g);
    this.addLu(d.bodyNode, d.b, -g);
    this.addLu(d.bodyNode, d.bodyNode, g);
    this.addRhs(d.b, -iEq);
    this.addRhs(d.bodyNode, iEq);
    return vgs !== rawGs || vds !== rawDs || vBody !== rawBody;
  }

  /**
   * An op amp is piecewise linear, so its rows are exact in each state: Newton only has to find the
   * right state. Saying which one holds from the last solution ends, unlike a smooth curve at this
   * gain, where each iteration would throw the output from one rail to the other.
   */
  private regulatorVoltages(d: Extract<CompiledDevice, { kind: 'regulator' }>) {
    const { polarity } = d.params;
    const reference = this.voltage(d.base);
    return { input: polarity * (this.voltage(d.a) - reference), output: polarity * (this.voltage(d.b) - reference) };
  }

  private regulatorCurrent(i: number, d: Extract<CompiledDevice, { kind: 'regulator' }>): { i: number; region: RegulatorRegion } {
    if (this.regulatorIsOff[i]) return { i: 0, region: 'off' };
    const { input, output } = this.regulatorVoltages(d);
    return regulatorPoint(d.params, input, output);
  }

  /**
   * Linear in each state, with a straight line in the node voltages. The state only moves to the one
   * next to it: at the limit an output with a light load is computed far too high, and going straight
   * to off would then bring it back to zero, and to the limit again, without an end.
   */
  private stampRegulator(i: number, d: Extract<CompiledDevice, { kind: 'regulator' }>): boolean {
    const { polarity, vNominal, dropout, iq, iMax } = d.params;
    const { input, output } = this.regulatorVoltages(d);
    const isDropout = input - dropout < vNominal;
    const wanted = REGULATOR_GAIN * ((isDropout ? input - dropout : vNominal) - output);
    let state = this.regulatorState[i];
    if (this.regulatorIsOff[i]) state = REGULATOR_NOT_GIVING;
    else if (state === REGULATOR_ACTIVE) state = wanted <= 0 ? REGULATOR_NOT_GIVING : wanted >= iMax ? REGULATOR_AT_LIMIT : REGULATOR_ACTIVE;
    else if (state === REGULATOR_NOT_GIVING ? wanted > 0 : wanted < iMax) state = REGULATOR_ACTIVE;
    const hasChanged = state !== this.regulatorState[i];
    this.regulatorState[i] = state;

    const g = polarity * REGULATOR_GAIN;
    // The current leaving the input is polarity * (i + iq), and the same i enters the output
    let constant = state === REGULATOR_AT_LIMIT ? iMax : 0;
    const slopes: [number, number][] = [];
    if (state === REGULATOR_ACTIVE && !isDropout) {
      constant = REGULATOR_GAIN * vNominal;
      slopes.push([d.b, -g], [d.base, g]);
    } else if (state === REGULATOR_ACTIVE) {
      constant = -REGULATOR_GAIN * dropout;
      slopes.push([d.a, g], [d.b, -g]);
    }
    for (const [node, slope] of slopes) {
      this.addLu(d.a, node, polarity * slope);
      this.addLu(d.b, node, -polarity * slope);
    }
    this.addRhs(d.a, -polarity * (constant + iq));
    this.addRhs(d.b, polarity * constant);
    this.addRhs(d.base, polarity * iq);
    return hasChanged;
  }

  private stampOpAmp(i: number, d: Extract<CompiledDevice, { kind: 'opamp' }>): boolean {
    const { lu, rhs, n } = this;
    const target = OPAMP_GAIN * (this.voltage(d.plus) - this.voltage(d.minus));
    const output = this.voltage(d.a);
    let state = this.opAmpState[i];
    if (this.opAmpsToHold.delete(i)) {
      // Keeps the state
    } else if (state === LINEAR) {
      if (output > d.high + OPAMP_MARGIN) state = 1;
      else if (output < d.low - OPAMP_MARGIN) state = -1;
    } else if ((state === 1 && target < d.high - OPAMP_MARGIN) || (state === -1 && target > d.low + OPAMP_MARGIN)) {
      state = LINEAR;
    }
    const hasChanged = state !== this.opAmpState[i];
    if (hasChanged) {
      this.opAmpState[i] = state;
      this.opAmpChanges++;
    }

    if (state === LINEAR) {
      // With a limited bandwidth the output follows the drive through a pole, integrated as the capacitors are
      const k = d.tau > 0 && this.stepForOpAmps > 0 && !this.isProbingLoops ? this.stepForOpAmps / (2 * d.tau) : 0;
      const hasPole = k > 0;
      const gain = hasPole ? k * OPAMP_GAIN : OPAMP_GAIN;
      if (d.plus >= 0) lu[d.branch * n + d.plus] -= gain;
      if (d.minus >= 0) lu[d.branch * n + d.minus] += gain;
      if (hasPole) {
        if (d.a >= 0) lu[d.branch * n + d.a] += k;
        rhs[d.branch] = (1 - k) * this.vPrev[i] + k * this.iPrev[i];
      }
    } else {
      rhs[d.branch] = state === 1 ? d.high : d.low;
    }
    return hasChanged;
  }

  /**
   * With positive feedback the linear solution exists but cannot last: a real output runs away from
   * it. It shows in the sign of the closed loop, and the output then goes to the rail it was heading to.
   */
  private leaveUnstableOpAmps(): boolean {
    let changed = false;
    for (const { index, device: d } of this.opAmps) {
      if (this.opAmpState[index] !== LINEAR || !this.isUnstable(d)) continue;
      this.opAmpState[index] = this.voltage(d.plus) - this.voltage(d.minus) >= 0 ? 1 : -1;
      this.opAmpsToHold.add(index);
      this.opAmpChanges++;
      changed = true;
    }
    return changed;
  }

  private isUnstable(d: Extract<CompiledDevice, { kind: 'opamp' }>): boolean {
    if (d.a < 0) return false;
    this.unitRhs.fill(0);
    this.unitRhs[d.branch] = 1;
    luSolve(this.lu, this.n, this.pivots, this.unitRhs);
    return this.unitRhs[d.a] < 0;
  }

  /**
   * Op amps resting where they cannot stay, as seen by the first instants: an oscillator is stable
   * at the operating point, with its capacitor open, and only runs away once time passes.
   */
  unstableOpAmps(): string[] {
    this.isProbingLoops = true;
    this.stampBase(FIRST_INSTANT);
    this.lu.set(this.base);
    this.stampNonlinear();
    this.isProbingLoops = false;
    if (!luFactor(this.lu, this.n, this.pivots)) return [];
    return this.opAmps.filter(({ index, device }) => this.opAmpState[index] === LINEAR && this.isUnstable(device)).map(({ device }) => this.compiled.elementIds[device.element]);
  }

  /** Adds the linearized diodes and transistors to the LU copy of the matrix and to the right-hand side. */
  private stampNonlinear(): boolean {
    const { lu, rhs, n } = this;
    let limited = false;
    this.compiled.devices.forEach((d, i) => {
      if (d.kind === 'bjt' && this.stampBjt(i, d)) limited = true;
      if (d.kind === 'mos' && this.stampMos(i, d)) limited = true;
      if (d.kind === 'opamp' && this.stampOpAmp(i, d)) limited = true;
      if (d.kind === 'regulator' && this.stampRegulator(i, d)) limited = true;
      if (d.kind !== 'diode') return;
      const raw = this.voltage(d.junction) - this.voltage(d.b);
      const v = limitDiode(raw, this.vIter[i], d.params, this.vCrit[i]);
      if (v !== raw) limited = true;
      this.vIter[i] = v;

      const point = diodeOperatingPoint(v, d.params);
      const g = point.g + GMIN;
      const ieq = point.i + GMIN * v - g * v;
      const [j, b] = [d.junction, d.b];
      if (j >= 0) {
        lu[j * n + j] += g;
        rhs[j] -= ieq;
      }
      if (b >= 0) {
        lu[b * n + b] += g;
        rhs[b] += ieq;
      }
      if (j >= 0 && b >= 0) {
        lu[j * n + b] -= g;
        lu[b * n + j] -= g;
      }
    });
    return limited;
  }

  /** Solves the system at time t; false means no convergence. */
  private solve(t: number, h: number, sourceScale: number): boolean {
    const { n, x, rhs, lu, base, pivots } = this;
    this.stampBase(h);
    this.stepForOpAmps = h;

    if (!this.isNonlinear) {
      this.stampRhs(t, h, sourceScale);
      if (!this.luValid) {
        lu.set(base);
        if (!luFactor(lu, n, pivots)) throw new SolverError(UNSOLVABLE);
        this.luValid = true;
      }
      luSolve(lu, n, pivots, rhs);
      x.set(rhs);
      return true;
    }

    this.opAmpChanges = 0;
    this.opAmpsToHold.clear();
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      this.stampRhs(t, h, sourceScale);
      lu.set(base);
      const limited = this.stampNonlinear();
      if (!luFactor(lu, n, pivots)) throw new SolverError(UNSOLVABLE);
      luSolve(lu, n, pivots, rhs);
      // At the operating point time does not pass, so nothing can run away: the transient decides
      const hasLeft = h > 0 && this.leaveUnstableOpAmps();
      if (this.opAmpChanges > MAX_OPAMP_CHANGES) return false;

      let converged = !limited && !hasLeft && iter > 0;
      for (let i = 0; i < n; i++) {
        const value = rhs[i];
        if (!Number.isFinite(value)) return false;
        if (converged && Math.abs(value - x[i]) > VOLTAGE_ABSTOL + RELTOL * Math.abs(value)) converged = false;
        x[i] = value;
      }
      if (converged) return true;
    }
    return false;
  }

  /** Records the accepted point as the history of the companion models. */
  private commit(h: number) {
    this.compiled.devices.forEach((d: CompiledDevice, i) => {
      if (d.kind === 'capacitor') {
        const v = this.voltage(d.a) - this.voltage(d.b);
        this.iPrev[i] = h > 0 ? ((2 * d.c) / h) * (v - this.vPrev[i]) - this.iPrev[i] : 0;
        this.vPrev[i] = v;
      } else if (d.kind === 'inductor') {
        this.vPrev[i] = h > 0 ? this.voltage(d.a) - this.voltage(d.b) : 0;
        this.iPrev[i] = this.x[d.branch];
      } else if (d.kind === 'transformer') {
        this.vPrev[i] = h > 0 ? this.voltage(d.ap) - this.voltage(d.b) : 0;
        this.vPrev2[i] = h > 0 ? this.voltage(d.cp) - this.voltage(d.d) : 0;
        this.iPrev[i] = this.x[d.branch];
        this.iPrev2[i] = this.x[d.branch2];
      } else if (d.kind === 'regulator' && h > 0) {
        const { input, output } = this.regulatorVoltages(d);
        const heat = regulatorPower(d.params, input, output, this.regulatorCurrent(i, d).i);
        this.regulatorTj[i] += (d.params.ambient + heat * d.params.rth - this.regulatorTj[i]) / THERMAL_STEPS;
        if (this.regulatorTj[i] > THERMAL_SHUTDOWN) this.regulatorIsOff[i] = 1;
        else if (this.regulatorTj[i] < THERMAL_RESTART) this.regulatorIsOff[i] = 0;
      } else if (d.kind === 'opamp') {
        this.vPrev[i] = this.voltage(d.a);
        this.iPrev[i] = OPAMP_GAIN * (this.voltage(d.plus) - this.voltage(d.minus));
      }
    });
  }

  /** Outputs as the parts would give them with every input at 0. */
  private resetLogic() {
    this.compiled.devices.forEach((d, i) => {
      if (d.kind !== 'logic') return;
      this.logicIn[i] = 0;
      this.logicOut[i] = gateOutput(d.gate, d.inputs.map(() => false), d.state) ? 1 : 0;
    });
  }

  /**
   * Reads the inputs of the logic parts at the accepted point, and sets their outputs for the next
   * step: a delay of one step, which keeps every step linear. True if an output changed.
   */
  private updateLogic(): boolean {
    let hasChanged = false;
    this.compiled.devices.forEach((d, i) => {
      if (d.kind !== 'logic') return;
      let bits = 0;
      const levels = d.inputs.map((node, k) => {
        const level = readLevel(this.voltage(node), d.vdd, (this.logicIn[i] & (1 << k)) !== 0);
        if (level) bits |= 1 << k;
        return level;
      });
      this.logicIn[i] = bits;
      const out = gateOutput(d.gate, levels, d.state) ? 1 : 0;
      if (out !== this.logicOut[i]) {
        this.logicOut[i] = out;
        hasChanged = true;
      }
    });
    return hasChanged;
  }

  /** Level of the output, then of each input, of a logic part. */
  logicLevels(index: number): number[] {
    const d = this.compiled.devices[index];
    if (d.kind !== 'logic') return [];
    return [this.logicOut[index], ...d.inputs.map((_, k) => (this.logicIn[index] >> k) & 1)];
  }

  /** DC operating point at the current time, with capacitors open and inductors shorted. */
  initialize() {
    this.x.fill(0);
    this.vIter.fill(0);
    this.vIterBc.fill(0);
    this.vIterBody.fill(0);
    this.opAmpState.fill(LINEAR);
    this.regulatorIsOff.fill(0);
    this.regulatorState.fill(REGULATOR_ACTIVE);
    this.resetLogic();
    if (!this.solve(this.time, 0, 1)) {
      // Source stepping: bring the sources up gradually, each solution seeding the next
      this.x.fill(0);
      this.vIter.fill(0);
      this.vIterBc.fill(0);
      this.vIterBody.fill(0);
      this.opAmpState.fill(LINEAR);
      this.regulatorState.fill(REGULATOR_ACTIVE);
      for (let scale = 0.1; scale < 1.05; scale += 0.1) {
        if (!this.solve(this.time, 0, Math.min(scale, 1))) throw new SolverError('Punto di lavoro non trovato');
      }
    }
    // Gates feeding gates settle in as many rounds as the longest chain. A loop that never settles,
    // as a ring of inverters, is left as it is: the animation then shows it running
    for (let round = 0; round < LOGIC_SETTLE_ROUNDS && this.updateLogic(); round++) {
      if (!this.solve(this.time, 0, 1)) throw new SolverError('Punto di lavoro non trovato');
    }
    this.commit(0);
    // With a pole, a loop that cannot rest would still rest on an exact zero, since nothing moves it:
    // it gets the same push the first instant gives an ideal op amp
    if (this.opAmps.some(({ device }) => device.tau > 0)) {
      const stuck = new Set(this.unstableOpAmps());
      for (const { index, device } of this.opAmps) {
        if (device.tau > 0 && stuck.has(this.compiled.elementIds[device.element])) this.opAmpState[index] = 1;
      }
    }
  }

  /** Takes over voltages, currents and time from an engine running the same topology. */
  adoptState(previous: RealtimeEngine) {
    this.time = previous.time;
    this.x.set(previous.x);
    this.vPrev.set(previous.vPrev);
    this.iPrev.set(previous.iPrev);
    this.vPrev2.set(previous.vPrev2);
    this.iPrev2.set(previous.iPrev2);
    this.vIter.set(previous.vIter);
    this.vIterBc.set(previous.vIterBc);
    this.vIterBody.set(previous.vIterBody);
    this.opAmpState.set(previous.opAmpState);
    this.regulatorTj.set(previous.regulatorTj);
    this.regulatorIsOff.set(previous.regulatorIsOff);
    this.regulatorState.set(previous.regulatorState);
    this.logicOut.set(previous.logicOut);
    this.logicIn.set(previous.logicIn);
    // An input switched by hand gives its new level at once
    this.compiled.devices.forEach((d, i) => {
      if (d.kind === 'logic' && d.gate === 'input') this.logicOut[i] = d.state ? 1 : 0;
    });
    // With another model the old junction voltage can sit far up the new exponential, where
    // Newton has nothing to hold on to: from zero, the limiter walks there safely
    this.compiled.devices.forEach((d, i) => {
      const before = previous.compiled.devices[i];
      if ((d.kind === 'diode' || d.kind === 'bjt' || d.kind === 'mos') && before.kind === d.kind && JSON.stringify(before.params) !== JSON.stringify(d.params)) {
        this.vIter[i] = 0;
        this.vIterBc[i] = 0;
        this.vIterBody[i] = 0;
      }
    });
  }

  /** Advances by h, splitting the step if Newton does not converge. */
  step(h: number, depth = 0) {
    this.start.set(this.x);
    const startIter = this.vIter.slice();
    const startIterBc = this.vIterBc.slice();
    const startIterBody = this.vIterBody.slice();
    const startOpAmpState = this.opAmpState.slice();
    const startRegulatorState = this.regulatorState.slice();
    if (this.solve(this.time + h, h, 1)) {
      this.commit(h);
      this.updateLogic();
      this.time += h;
      return;
    }
    if (depth >= MAX_HALVINGS) throw new SolverError('La simulazione non converge');
    this.x.set(this.start);
    this.vIter.set(startIter);
    this.vIterBc.set(startIterBc);
    this.vIterBody.set(startIterBody);
    this.opAmpState.set(startOpAmpState);
    this.regulatorState.set(startRegulatorState);
    this.step(h / 2, depth + 1);
    this.step(h / 2, depth + 1);
  }

  nodeVoltage(node: number): number {
    return this.voltage(node);
  }

  /** Current through each device, from its first terminal to its second. */
  deviceCurrent(index: number): number {
    const d = this.compiled.devices[index];
    switch (d.kind) {
      case 'resistor':
        return d.g * (this.voltage(d.a) - this.voltage(d.b));
      case 'capacitor':
        return this.iPrev[index];
      case 'isource':
        return d.current;
      case 'inductor':
      case 'vsource':
      case 'opamp':
      case 'transformer':
        return this.x[d.branch];
      case 'diode': {
        const v = this.voltage(d.junction) - this.voltage(d.b);
        return diodeOperatingPoint(v, d.params).i + GMIN * v;
      }
      case 'bjt':
      case 'mos':
      case 'regulator':
      case 'logic':
        return this.terminalCurrents(index)[0];
    }
  }

  /** What a regulator is doing, for the display. */
  regulatorStatus(index: number): { power: number; temperature: number; region: RegulatorRegion | 'thermal' } {
    const d = this.compiled.devices[index];
    if (d.kind !== 'regulator') return { power: 0, temperature: 0, region: 'off' };
    const { input, output } = this.regulatorVoltages(d);
    const { i, region } = this.regulatorCurrent(index, d);
    return { power: regulatorPower(d.params, input, output, i), temperature: this.regulatorTj[index], region: this.regulatorIsOff[index] ? 'thermal' : region };
  }

  /** Current entering each terminal: first and second for two terminals, collector, base and emitter for a transistor. */
  terminalCurrents(index: number): number[] {
    const d = this.compiled.devices[index];
    if (d.kind === 'mos') {
      const { polarity, body } = d.params;
      const vs = this.voltage(d.sp);
      const { id, isReversed } = mosOperatingPoint(d.params, polarity * (this.voltage(d.base) - vs), polarity * (this.voltage(d.dp) - vs));
      const vBody = polarity * (this.voltage(d.b) - this.voltage(d.bodyNode));
      const diode = diodeOperatingPoint(vBody, body).i + GMIN * vBody;
      const drain = polarity * ((isReversed ? -id : id) - diode);
      return [drain, 0, -drain];
    }
    if (d.kind === 'regulator') {
      const { polarity, iq } = d.params;
      const { i } = this.regulatorCurrent(index, d);
      return [polarity * (i + iq), -polarity * i, -polarity * iq];
    }
    if (d.kind === 'opamp') return [this.x[d.branch], 0, 0];
    if (d.kind === 'logic') {
      const out = (this.voltage(d.a) - (this.logicOut[index] ? d.vdd : 0)) / LOGIC_OUTPUT_RESISTANCE;
      return [out, ...d.inputs.map((node) => this.voltage(node) / LOGIC_INPUT_RESISTANCE)];
    }
    if (d.kind === 'transformer') return [this.x[d.branch], -this.x[d.branch], this.x[d.branch2], -this.x[d.branch2]];
    if (d.kind !== 'bjt') {
      const current = this.deviceCurrent(index);
      return [current, -current];
    }
    const { polarity } = d.params;
    const vb = this.voltage(d.bp);
    const { ic, ib } = bjtOperatingPoint(d.params, polarity * (vb - this.voltage(d.ep)), polarity * (vb - this.voltage(d.cp)));
    return [polarity * ic, polarity * ib, -polarity * (ic + ib)];
  }
}
