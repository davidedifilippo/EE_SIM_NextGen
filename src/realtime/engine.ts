import { CompiledCircuit, CompiledDevice, DiodeParams } from './compile';
import { luFactor, luSolve } from './linear';

/** Same default as SPICE: minimum conductance across a junction. */
const GMIN = 1e-12;
/** Conductance from every node to ground, so an unconnected node never makes the matrix singular. */
const NODE_SHUNT = 1e-12;
const VOLTAGE_ABSTOL = 1e-6;
const RELTOL = 1e-4;
const MAX_ITERATIONS = 60;
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

const criticalVoltage = ({ is, nvt }: DiodeParams) => nvt * Math.log(nvt / (Math.SQRT2 * is));

/**
 * Modified nodal analysis with Newton-Raphson. Capacitors and inductors use trapezoidal
 * companion models, the default integration method of ngspice.
 */
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

  /** Per device: capacitor/inductor voltage and current at the last accepted point, diode junction voltage. */
  private readonly vPrev: Float64Array;
  private readonly iPrev: Float64Array;
  private readonly vIter: Float64Array;

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
    this.vIter = new Float64Array(devices.length);
    this.vCrit = new Float64Array(devices.length);
    devices.forEach((d, i) => {
      if (d.kind === 'diode') this.vCrit[i] = criticalVoltage(d.params);
    });
    this.isNonlinear = devices.some((d) => d.kind === 'diode');
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
          break;
        case 'diode':
          if (d.params.rs > 0) this.addG(d.a, d.junction, 1 / d.params.rs);
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
      if ((d.kind === 'inductor' || d.kind === 'vsource') && d.branch < first) first = d.branch;
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
      }
    });
  }

  /** Adds the linearized diodes to the LU copy of the matrix and to the right-hand side. */
  private stampDiodes(): boolean {
    const { lu, rhs, n } = this;
    let limited = false;
    this.compiled.devices.forEach((d, i) => {
      if (d.kind !== 'diode') return;
      const { is, nvt } = d.params;
      const raw = this.voltage(d.junction) - this.voltage(d.b);
      const v = limitJunction(raw, this.vIter[i], nvt, this.vCrit[i]);
      if (v !== raw) limited = true;
      this.vIter[i] = v;

      const e = exp(v / nvt);
      const g = (is / nvt) * e + GMIN;
      const ieq = is * (e - 1) + GMIN * v - g * v;
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

    if (!this.isNonlinear) {
      this.stampRhs(t, h, sourceScale);
      if (!this.luValid) {
        lu.set(base);
        if (!luFactor(lu, n, pivots)) throw new SolverError('Circuito non risolvibile: controlla generatori e induttori in parallelo o in cortocircuito');
        this.luValid = true;
      }
      luSolve(lu, n, pivots, rhs);
      x.set(rhs);
      return true;
    }

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      this.stampRhs(t, h, sourceScale);
      lu.set(base);
      const limited = this.stampDiodes();
      if (!luFactor(lu, n, pivots)) throw new SolverError('Circuito non risolvibile: controlla generatori e induttori in parallelo o in cortocircuito');
      luSolve(lu, n, pivots, rhs);

      let converged = !limited && iter > 0;
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
      }
    });
  }

  /** DC operating point at the current time, with capacitors open and inductors shorted. */
  initialize() {
    this.x.fill(0);
    this.vIter.fill(0);
    if (!this.solve(this.time, 0, 1)) {
      // Source stepping: bring the sources up gradually, each solution seeding the next
      this.x.fill(0);
      this.vIter.fill(0);
      for (let scale = 0.1; scale < 1.05; scale += 0.1) {
        if (!this.solve(this.time, 0, Math.min(scale, 1))) throw new SolverError('Punto di lavoro non trovato');
      }
    }
    this.commit(0);
  }

  /** Takes over voltages, currents and time from an engine running the same topology. */
  adoptState(previous: RealtimeEngine) {
    this.time = previous.time;
    this.x.set(previous.x);
    this.vPrev.set(previous.vPrev);
    this.iPrev.set(previous.iPrev);
    this.vIter.set(previous.vIter);
  }

  /** Advances by h, splitting the step if Newton does not converge. */
  step(h: number, depth = 0) {
    this.start.set(this.x);
    const startIter = this.vIter.slice();
    if (this.solve(this.time + h, h, 1)) {
      this.commit(h);
      this.time += h;
      return;
    }
    if (depth >= MAX_HALVINGS) throw new SolverError('La simulazione non converge');
    this.x.set(this.start);
    this.vIter.set(startIter);
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
      case 'inductor':
      case 'vsource':
        return this.x[d.branch];
      case 'diode': {
        const v = this.voltage(d.junction) - this.voltage(d.b);
        return d.params.is * (exp(v / d.params.nvt) - 1) + GMIN * v;
      }
    }
  }
}
