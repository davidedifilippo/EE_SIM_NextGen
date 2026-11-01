import { BjtParams, CompiledCircuit, CompiledDevice, DiodeParams } from './compile';
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
    const sq = Math.sqrt(Math.max(0, 1 + 4 * (p.oikf * cbe + p.oikr * cbc))) || 1;
    qb = (q1 * (1 + sq)) / 2;
    dqbdve = q1 * (qb * p.ovar + (p.oikf * gbe) / sq);
    dqbdvc = q1 * (qb * p.ovaf + (p.oikr * gbc) / sq);
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

  /** Per device: capacitor/inductor voltage and current at the last accepted point, diode or base-emitter junction voltage. */
  private readonly vPrev: Float64Array;
  private readonly iPrev: Float64Array;
  private readonly vIter: Float64Array;
  /** Base-collector junction voltage of a transistor. */
  private readonly vIterBc: Float64Array;

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
    this.vIterBc = new Float64Array(devices.length);
    this.vCrit = new Float64Array(devices.length);
    devices.forEach((d, i) => {
      if (d.kind === 'diode') this.vCrit[i] = criticalVoltage(d.params.is, d.params.nvt);
      else if (d.kind === 'bjt') this.vCrit[i] = criticalVoltage(d.params.is, d.params.vt);
    });
    this.isNonlinear = devices.some((d) => d.kind === 'diode' || d.kind === 'bjt');
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
        case 'bjt':
          if (d.params.rc > 0) this.addG(d.a, d.cp, 1 / d.params.rc);
          if (d.params.rb > 0) this.addG(d.base, d.bp, 1 / d.params.rb);
          if (d.params.re > 0) this.addG(d.b, d.ep, 1 / d.params.re);
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

  /** Adds the linearized diodes and transistors to the LU copy of the matrix and to the right-hand side. */
  private stampNonlinear(): boolean {
    const { lu, rhs, n } = this;
    let limited = false;
    this.compiled.devices.forEach((d, i) => {
      if (d.kind === 'bjt' && this.stampBjt(i, d)) limited = true;
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
      const limited = this.stampNonlinear();
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
    this.vIterBc.fill(0);
    if (!this.solve(this.time, 0, 1)) {
      // Source stepping: bring the sources up gradually, each solution seeding the next
      this.x.fill(0);
      this.vIter.fill(0);
      this.vIterBc.fill(0);
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
    this.vIterBc.set(previous.vIterBc);
  }

  /** Advances by h, splitting the step if Newton does not converge. */
  step(h: number, depth = 0) {
    this.start.set(this.x);
    const startIter = this.vIter.slice();
    const startIterBc = this.vIterBc.slice();
    if (this.solve(this.time + h, h, 1)) {
      this.commit(h);
      this.time += h;
      return;
    }
    if (depth >= MAX_HALVINGS) throw new SolverError('La simulazione non converge');
    this.x.set(this.start);
    this.vIter.set(startIter);
    this.vIterBc.set(startIterBc);
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
        return diodeOperatingPoint(v, d.params).i + GMIN * v;
      }
      case 'bjt':
        return this.terminalCurrents(index)[0];
    }
  }

  /** Current entering each terminal: first and second for two terminals, collector, base and emitter for a transistor. */
  terminalCurrents(index: number): number[] {
    const d = this.compiled.devices[index];
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
