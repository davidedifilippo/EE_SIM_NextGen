import { Circuit, Element, Pt, SpiceDef } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity } from '../netlist/connectivity';
import { localToWorld, ptKey } from '../utils/geometry';
import { CompiledCircuit, compileCircuit } from './compile';
import { METER_MODES, MeterWindow, readingWindow, slowestPeriod } from './meter';
import { RegulatorRegion } from './regulator';
import { RealtimeEngine, SolverError } from './engine';
import { buildWireGraph, solveWireCurrents, WireGraph } from './wireGraph';

export interface LiveDevice {
  elementId: string;
  /** World position of each terminal: first and second, or collector, base and emitter. */
  terminals: Pt[];
  /** Where its dots start in LiveLayout.dots and LiveFrame.dotCurrent. */
  firstDot: number;
}

/** A path of animated dots inside a device. Positive current flows from a to b. */
export interface DeviceDots {
  a: Pt;
  b: Pt;
}

/** What the animation draws. Main thread and worker build it from the same circuit, so indices match. */
export interface LiveLayout {
  graph: WireGraph;
  /** Node index of each wire edge, -1 for ground. */
  edgeNode: Int32Array;
  devices: LiveDevice[];
  dots: DeviceDots[];
}

export interface LiveFrame {
  time: number;
  edgeVoltage: Float64Array;
  edgeCurrent: Float64Array;
  deviceCurrent: Float64Array;
  /** Voltage across each device, first terminal minus second; collector minus emitter or drain minus source for a transistor. */
  deviceVoltage: Float64Array;
  /** Base minus emitter or gate minus source of a transistor, voltage of the secondary of a transformer, output of a regulator, 0 for the rest. */
  deviceVbe: Float64Array;
  dotCurrent: Float64Array;
  /** Reading of each device that is a multimeter, NaN for the rest and before the first step. */
  meterMean: Float64Array;
  meterAc: Float64Array;
  /** For each device that is a regulator: heat, junction temperature and what it is doing. */
  regulators: (RegulatorDisplay | null)[];
  /** Samples of the probes since the last frame. */
  scope: ScopeSamples | null;
}

/** What the oscilloscope follows: a node through one of its wires, or a quantity of a part. */
export type ScopeProbe =
  | { id: string; kind: 'node'; wireId: string }
  | { id: string; kind: 'voltage' | 'current' | 'vbe' | 'ib'; elementId: string };

export interface RegulatorDisplay {
  power: number;
  temperature: number;
  region: RegulatorRegion | 'thermal';
}

export interface ScopeSamples {
  probeRevision: number;
  time: Float64Array;
  /** One array per probe, in the order they were set. */
  values: Float64Array[];
}

/**
 * R, L and C have no polarity, so turning one must not flip what is read on it: voltage and
 * current count from its left or top end, wherever its terminals ended up. Parts with a polarity
 * of their own, such as a generator or a diode, keep it and turn with it.
 */
export function drawingSign(el: Element): 1 | -1 {
  return getDevice(el.def)?.spice.kind === 'passive' && el.rot >= 180 ? -1 : 1;
}

const terminalsOf = (s: Exclude<SpiceDef, { kind: 'ground' }>): string[] => {
  switch (s.kind) {
    case 'regulator':
      return [s.input, s.output, s.ref];
    case 'block':
      return s.pins;
    case 'passive':
    case 'meter':
    case 'isource':
      return [s.a, s.b];
    case 'vsource':
      return [s.pos, s.neg];
    case 'diode':
      return [s.anode, s.cathode];
    case 'bjt':
      return [s.collector, s.base, s.emitter];
    case 'mos':
      return [s.drain, s.gate, s.source];
    case 'opamp':
      return [s.out, s.plus, s.minus];
    case 'transformer':
      return [s.p1, s.p2, s.s1, s.s2];
  }
};

export function buildLiveLayout(circuit: Circuit, compiled: CompiledCircuit): LiveLayout {
  const terminals: Pt[] = [];
  const grounds: Pt[] = [];
  for (const el of circuit.elements) {
    const def = getDevice(el.def);
    for (const t of def?.terminals ?? []) {
      const pt = localToWorld(el.x, el.y, t, el.rot, el.flip);
      terminals.push(pt);
      if (def?.spice.kind === 'ground') grounds.push(pt);
    }
  }

  const byId = new Map(circuit.elements.map((el) => [el.id, el]));
  const dots: DeviceDots[] = [];
  const devices = compiled.elementIds.map((id): LiveDevice => {
    const el = byId.get(id)!;
    const def = getDevice(el.def)!;
    const at = (terminal: string) => localToWorld(el.x, el.y, def.terminals.find((t) => t.id === terminal)!, el.rot, el.flip);
    const points = terminalsOf(def.spice as Exclude<SpiceDef, { kind: 'ground' }>).map(at);
    const firstDot = dots.length;
    // Through a two-terminal device in one run; a transformer has one per winding; in a transistor, each lead meets at the center
    if (points.length === 2) dots.push({ a: points[0], b: points[1] });
    else if (points.length === 4) dots.push({ a: points[0], b: points[1] }, { a: points[2], b: points[3] });
    else points.forEach((p) => dots.push({ a: p, b: { x: el.x, y: el.y } }));
    return { elementId: id, terminals: points, firstDot };
  });

  const graph = buildWireGraph(circuit.wires, terminals, grounds);
  const { wireNet } = computeConnectivity(circuit);
  const edgeNode = Int32Array.from(graph.edges, (e) => compiled.netIndex.get(wireNet.get(e.wireId)!) ?? -1);
  return { graph, edgeNode, devices, dots };
}

/** The op amps of a circuit that start where they cannot stay, for the precise analysis to give them a push. */
export function opAmpsToKick(circuit: Circuit): Set<string> {
  if (!circuit.elements.some((el) => el.def === 'opamp')) return new Set();
  const result = compileCircuit(circuit);
  if (!result.ok) return new Set();
  try {
    const engine = new RealtimeEngine(result.compiled);
    engine.initialize();
    return new Set(engine.unstableOpAmps());
  } catch {
    return new Set();
  }
}

export type LoadResult = { ok: true } | { ok: false; errors: string[] };

/** The running simulation behind the animation, independent of how it is scheduled. */
export class LiveSimulation {
  private engine: RealtimeEngine | null = null;
  private layout: LiveLayout | null = null;
  /** Per device, the vertex index of each terminal, -1 if the terminal touches no wire. */
  private deviceVertices: number[][] = [];
  private injected = new Float64Array(0);
  /** Set after a solver failure: the circuit needs an edit before it can run again. */
  private failed = false;
  private probes: ScopeProbe[] = [];
  private probeRevision = 0;
  private readers: (() => number)[] = [];
  private sampleTimes: number[] = [];
  private sampleValues: number[][] = [];
  private lastCircuit: Circuit | null = null;
  private meters = new Map<string, { index: number; mode: unknown; window: MeterWindow; read: () => number }>();
  private period: number | null = null;

  /** Probes are sampled at every solver step: at frame rate, fast signals would show up as corners. */
  setProbes(probes: ScopeProbe[], revision: number) {
    this.probes = probes;
    this.probeRevision = revision;
    this.sampleTimes = [];
    this.sampleValues = probes.map(() => []);
    this.resolveProbes();
  }

  private resolveProbes() {
    const { engine, lastCircuit, probes } = this;
    this.readers = probes.map((probe): (() => number) => {
      if (!engine || !lastCircuit) return () => NaN;
      const { compiled } = engine;
      if (probe.kind === 'node') {
        const net = computeConnectivity(lastCircuit).wireNet.get(probe.wireId);
        const node = net === undefined ? undefined : compiled.netIndex.get(net);
        return node === undefined ? () => NaN : () => engine.nodeVoltage(node);
      }
      const index = compiled.elementIds.indexOf(probe.elementId);
      const device = compiled.devices[index];
      if (!device) return () => NaN;
      const element = lastCircuit.elements.find((el) => el.id === probe.elementId);
      const sign = element ? drawingSign(element) : 1;
      switch (probe.kind) {
        case 'voltage':
          return () => sign * (engine.nodeVoltage(device.a) - engine.nodeVoltage(device.b));
        case 'current':
          return () => sign * engine.deviceCurrent(index);
        case 'vbe':
          if (device.kind === 'regulator') return () => engine.nodeVoltage(device.b) - engine.nodeVoltage(device.base);
          if (device.kind === 'transformer') return () => engine.nodeVoltage(device.c) - engine.nodeVoltage(device.d);
          return device.kind === 'bjt' || device.kind === 'mos' ? () => engine.nodeVoltage(device.base) - engine.nodeVoltage(device.b) : () => NaN;
        case 'ib':
          if (device.kind === 'regulator') return () => -engine.terminalCurrents(index)[1];
          if (device.kind === 'transformer') return () => engine.terminalCurrents(index)[2];
          return device.kind === 'bjt' ? () => engine.terminalCurrents(index)[1] : () => NaN;
      }
    });
  }

  /** The display goes on showing its value through a change of the circuit, unless the instrument itself changed. */
  private resolveMeters() {
    const { engine, lastCircuit } = this;
    const previous = this.meters;
    this.meters = new Map();
    if (!engine || !lastCircuit) return;
    this.period = slowestPeriod(lastCircuit);
    engine.compiled.elementIds.forEach((id, index) => {
      const el = lastCircuit.elements.find((other) => other.id === id);
      const mode = METER_MODES.find((m) => m.value === el?.props.mode);
      if (!el || !mode || getDevice(el.def)?.spice.kind !== 'meter') return;
      const device = engine.compiled.devices[index];
      const read = mode.unit === 'V' ? () => engine.nodeVoltage(device.a) - engine.nodeVoltage(device.b) : () => engine.deviceCurrent(index);
      const kept = previous.get(id);
      const window = kept && kept.mode === mode.value ? kept.window : new MeterWindow();
      window.restart();
      this.meters.set(id, { index, mode: mode.value, window, read });
    });
  }

  private takeSamples(): ScopeSamples | null {
    if (this.probes.length === 0) return null;
    const samples = {
      probeRevision: this.probeRevision,
      time: Float64Array.from(this.sampleTimes),
      values: this.sampleValues.map((v) => Float64Array.from(v)),
    };
    this.sampleTimes = [];
    this.sampleValues = this.probes.map(() => []);
    return samples;
  }

  load(circuit: Circuit): LoadResult {
    const result = compileCircuit(circuit);
    if (!result.ok) {
      this.engine = null;
      this.resolveProbes();
      this.resolveMeters();
      return result;
    }
    const { compiled } = result;
    this.lastCircuit = circuit;

    this.layout = buildLiveLayout(circuit, compiled);
    const { graph, devices } = this.layout;
    this.deviceVertices = devices.map((d) => d.terminals.map((p) => graph.vertexOf.get(ptKey(p)) ?? -1));
    this.injected = new Float64Array(graph.vertexCount);

    const previous = this.engine;
    const next = new RealtimeEngine(compiled);
    this.failed = false;
    try {
      if (previous && previous.compiled.signature === compiled.signature) {
        next.adoptState(previous);
      } else {
        // New topology: a new operating point, but the sources carry on from the same time
        next.time = previous?.time ?? 0;
        next.initialize();
      }
    } catch (err) {
      this.engine = null;
      this.resolveProbes();
      this.resolveMeters();
      if (err instanceof SolverError) return { ok: false, errors: [err.message] };
      throw err;
    }
    this.engine = next;
    this.resolveProbes();
    this.resolveMeters();
    return { ok: true };
  }

  /** Runs up to the given number of steps within the time budget and returns how many were done. */
  advance(steps: number, h: number, budgetMs: number): number {
    if (!this.engine || this.failed) return 0;
    const start = performance.now();
    let done = 0;
    const window = readingWindow(this.period, h);
    while (done < steps) {
      this.engine.step(h);
      done++;
      this.meters.forEach((meter) => meter.window.add(meter.read(), h, window));
      if (this.readers.length > 0) {
        this.sampleTimes.push(this.engine.time);
        this.readers.forEach((read, i) => this.sampleValues[i].push(read()));
      }
      if ((done & 7) === 0 && performance.now() - start > budgetMs) break;
    }
    return done;
  }

  markFailed() {
    this.failed = true;
  }

  get time(): number {
    return this.engine?.time ?? 0;
  }

  frame(): LiveFrame | null {
    const { engine, layout, injected, deviceVertices } = this;
    if (!engine || !layout) return null;
    const { devices } = engine.compiled;

    const deviceCurrent = new Float64Array(devices.length);
    const deviceVoltage = new Float64Array(devices.length);
    const deviceVbe = new Float64Array(devices.length);
    const dotCurrent = new Float64Array(layout.dots.length);
    injected.fill(0);
    devices.forEach((d, i) => {
      const currents = engine.terminalCurrents(i);
      deviceCurrent[i] = currents[0];
      deviceVoltage[i] = engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b);
      if (d.kind === 'transformer') deviceVbe[i] = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.d);
      if (d.kind === 'bjt' || d.kind === 'mos') deviceVbe[i] = engine.nodeVoltage(d.base) - engine.nodeVoltage(d.b);
      if (d.kind === 'regulator') deviceVbe[i] = engine.nodeVoltage(d.b) - engine.nodeVoltage(d.base);
      const { firstDot } = layout.devices[i];
      if (currents.length === 2) dotCurrent[firstDot] = currents[0];
      else if (currents.length === 4) [dotCurrent[firstDot], dotCurrent[firstDot + 1]] = [currents[0], currents[2]];
      else currents.forEach((current, k) => (dotCurrent[firstDot + k] = current));
      // The wires give each terminal the current that enters it
      currents.forEach((current, k) => {
        const vertex = deviceVertices[i][k];
        if (vertex >= 0) injected[vertex] -= current;
      });
    });

    const edgeCurrent = new Float64Array(layout.graph.edges.length);
    solveWireCurrents(layout.graph, injected, edgeCurrent);
    const edgeVoltage = Float64Array.from(layout.edgeNode, (node) => engine.nodeVoltage(node));
    const meterMean = new Float64Array(devices.length).fill(NaN);
    const meterAc = new Float64Array(devices.length).fill(NaN);
    this.meters.forEach(({ index, window }) => {
      if (!window.reading) return;
      meterMean[index] = window.reading.mean;
      meterAc[index] = window.reading.ac;
    });
    const regulators = devices.map((d, i) => (d.kind === 'regulator' ? engine.regulatorStatus(i) : null));
    return { time: engine.time, edgeVoltage, edgeCurrent, deviceCurrent, deviceVoltage, deviceVbe, dotCurrent, meterMean, meterAc, regulators, scope: this.takeSamples() };
  }
}
