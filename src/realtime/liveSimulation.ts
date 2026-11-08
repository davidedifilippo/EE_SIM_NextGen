import { MotorState } from './motor';
import { Circuit, Element, Pt, SpiceDef } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity, terminalKey } from '../netlist/connectivity';
import { localToWorld, ptKey } from '../utils/geometry';
import { CompiledCircuit, compileCircuit } from './compile';
import { METER_MODES, MeterWindow, readingWindow, slowestPeriod } from './meter';
import { RegulatorRegion } from './regulator';
import { SsrStatus } from './ssr';
import { RealtimeEngine, SolverError } from './engine';
import { buildWireGraph, solveWireCurrents, WireGraph } from './wireGraph';
import { flattenBlocks, isInsideBlock } from '../library/blocks';

export interface LiveDevice {
  elementId: string;
  /** World position of each terminal: first and second, or collector, base and emitter. */
  terminals: Pt[];
  /** Where its dots start in LiveLayout.dots and LiveFrame.dotCurrent; -1 for a part inside a block, which is not drawn. */
  firstDot: number;
}

/** A pin of a block on the sheet, and the terminals inside the block on its node: what they take enters by the pin. */
export interface LiveBlockPin {
  at: Pt;
  /** Device index and terminal index, in the order of terminalCurrents. */
  inside: [number, number][];
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
  blockPins: LiveBlockPin[];
}

export interface LiveFrame {
  time: number;
  edgeVoltage: Float64Array;
  edgeCurrent: Float64Array;
  deviceCurrent: Float64Array;
  /** Voltage across each device, first terminal minus second; collector minus emitter or drain minus source for a transistor. */
  deviceVoltage: Float64Array;
  /**
   * Base minus emitter or gate minus source of a transistor, voltage of the secondary of a transformer,
   * output of a regulator, wiper to ground of a potentiometer, voltage across the contact of a relay, supply of a 555, collector to emitter of an optocoupler, 0 for the rest.
   */
  deviceVbe: Float64Array;
  dotCurrent: Float64Array;
  /** Reading of each device that is a multimeter, NaN for the rest and before the first step. */
  meterMean: Float64Array;
  meterAc: Float64Array;
  /** For each device that is a regulator: heat, junction temperature and what it is doing. */
  regulators: (RegulatorDisplay | null)[];
  /** Each motor: its speed at the output shaft and what it is doing. */
  motors: ({ rpm: number; state: MotorState } | null)[];
  /** Each Arduino: the LED L, what draws beyond its maximum current, and what it wrote on the serial port since the last frame. */
  mcus: ({ id: string; led: boolean; warnings: string[]; serial: string } | null)[];
  /**
   * What lights each LED and lamp, averaged since the last frame as the eye sees it under a PWM or on
   * alternating current: the current of a LED, the power of a lamp; NaN for the other parts.
   */
  glowMean: Float64Array;
  /** The RMS voltage of each lamp over the last two periods or so; NaN for the other parts. */
  lampRms: Float64Array;
  /** Each 555: whether its output is high, and what is beyond its limits. */
  timers: ({ isHigh: boolean; warnings: string[] } | null)[];
  /** Each optocoupler: what it takes beyond its absolute maxima. */
  optos: (string[] | null)[];
  /** Each solid state relay: whether its control is active and its triac on, and what is beyond its ratings. */
  ssrs: (SsrStatus | null)[];
  /** Each relay: whether its contact is closed. */
  relays: (boolean | null)[];
  /** For each logic part: the level of each output, then of each input. */
  logic: (number[] | null)[];
  /** Samples of the probes since the last frame. */
  scope: ScopeSamples | null;
}

/** What the oscilloscope follows: a node through one of its wires, or a quantity of a part. */
export type ScopeProbe =
  | { id: string; kind: 'node'; wireId: string }
  | { id: string; kind: 'pin'; elementId: string; terminal: string }
  | { id: string; kind: 'voltage' | 'current' | 'vbe' | 'ib'; elementId: string };

export interface RegulatorDisplay {
  power: number;
  temperature: number;
  region: RegulatorRegion | 'thermal' | 'supply' | 'damaged';
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
    case 'userblock':
      return [];
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
    case 'motor':
      return [s.plus, s.minus];
    case 'pot':
      return [s.a, s.b, s.wiper];
    case 'lamp':
      return [s.a, s.b];
    case 'opto':
      return [s.anode, s.cathode, s.collector, s.emitter];
    case 'ssr':
      return [s.plus, s.minus, s.out1, s.out2];
    case 'relay':
      return s.nc ? [s.coil1, s.coil2, s.c1, s.c2, s.nc] : [s.coil1, s.coil2, s.c1, s.c2];
    case 'mcu':
      return [...s.pins, s.vcc, s.gnd];
    case 'port':
      return [];
    case 'timer':
      return [s.gnd, s.trig, s.out, s.reset, s.ctrl, s.thr, s.dis, s.vcc];
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
    case 'logic':
      return [...s.outputs, ...s.inputs];
    case 'switch':
      return [s.common, ...s.ways];
    case 'display7':
      return [...s.segments, s.common];
    case 'bridge':
      return [s.ac1, s.ac2, s.plus, s.minus];
    case 'ctransformer':
      return [s.p1, s.p2, s.s1, s.ct, s.s2];
  }
};

/**
 * What the animation draws. The blocks are opened as for the engine, but the parts inside a block are not
 * on the sheet: they get no dots, and only the wires of the sheet are drawn.
 */
export function buildLiveLayout(circuit: Circuit, compiled: CompiledCircuit): LiveLayout {
  const opened = flattenBlocks(circuit);
  const onSheet = (id: string) => !isInsideBlock(id);
  const terminals: Pt[] = [];
  const grounds: Pt[] = [];
  for (const el of opened.elements) {
    if (!onSheet(el.id)) continue;
    const def = getDevice(el.def);
    for (const t of def?.terminals ?? []) {
      const pt = localToWorld(el.x, el.y, t, el.rot, el.flip);
      terminals.push(pt);
      if (def?.spice.kind === 'ground') grounds.push(pt);
    }
  }

  const byId = new Map(opened.elements.map((el) => [el.id, el]));
  const dots: DeviceDots[] = [];
  const devices = compiled.elementIds.map((id): LiveDevice => {
    if (!onSheet(id)) return { elementId: id, terminals: [], firstDot: -1 };
    const el = byId.get(id)!;
    const def = getDevice(el.def)!;
    const at = (terminal: string) => localToWorld(el.x, el.y, def.terminals.find((t) => t.id === terminal)!, el.rot, el.flip);
    const points = terminalsOf(def.spice as Exclude<SpiceDef, { kind: 'ground' }>).map(at);
    const firstDot = dots.length;
    // Through a two-terminal device in one run; a transformer has one per winding; in a transistor or a
    // gate, each lead meets at the center, where a gate takes its supply
    const isPerLead = def.spice.kind === 'logic' || def.spice.kind === 'display7' || def.spice.kind === 'bridge' || def.spice.kind === 'mcu';
    if (isPerLead) points.forEach((p) => dots.push({ a: p, b: { x: el.x, y: el.y } }));
    // One run per winding: the primary, and each half of the secondary to the centre tap
    else if (def.spice.kind === 'ctransformer') dots.push({ a: points[0], b: points[1] }, { a: points[2], b: points[3] }, { a: points[3], b: points[4] });
    // A changeover relay: through the coil, then from the common to each of its two ways
    else if (def.spice.kind === 'relay' && points.length === 5) dots.push({ a: points[0], b: points[1] }, { a: points[2], b: points[3] }, { a: points[2], b: points[4] });
    else if (points.length === 2) dots.push({ a: points[0], b: points[1] });
    else if (points.length === 4) dots.push({ a: points[0], b: points[1] }, { a: points[2], b: points[3] });
    else points.forEach((p) => dots.push({ a: p, b: { x: el.x, y: el.y } }));
    return { elementId: id, terminals: points, firstDot };
  });

  const { wireNet, netOf } = computeConnectivity(opened);
  // Each pin of a block takes what the terminals inside it on its node take
  const blockPins: LiveBlockPin[] = [];
  for (const el of opened.elements) {
    const def = getDevice(el.def);
    if (!onSheet(el.id) || def?.spice.kind !== 'userblock') continue;
    const prefix = `${el.id}/`;
    const claimed = new Set<string>();
    for (const t of def.terminals) {
      const net = netOf.get(terminalKey(el.id, t.id));
      const inside: [number, number][] = [];
      // Two pins on one node inside: the first takes it all
      if (net !== undefined && !claimed.has(net)) {
        claimed.add(net);
        compiled.elementIds.forEach((id, index) => {
          if (!id.startsWith(prefix)) return;
          const inner = byId.get(id)!;
          terminalsOf(getDevice(inner.def)!.spice as Exclude<SpiceDef, { kind: 'ground' }>).forEach((terminal, k) => {
            if (netOf.get(terminalKey(id, terminal)) === net) inside.push([index, k]);
          });
        });
      }
      blockPins.push({ at: localToWorld(el.x, el.y, t, el.rot, el.flip), inside });
    }
  }

  const graph = buildWireGraph(opened.wires.filter((w) => onSheet(w.id)), terminals, grounds);
  const edgeNode = Int32Array.from(graph.edges, (e) => compiled.netIndex.get(wireNet.get(e.wireId)!) ?? -1);
  return { graph, edgeNode, devices, dots, blockPins };
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

/** With no generator to give a period, how long the RMS voltage of a lamp takes to follow it, in seconds. */
const LAMP_RMS_TIME = 0.05;

/** The running simulation behind the animation, independent of how it is scheduled. */
export class LiveSimulation {
  private engine: RealtimeEngine | null = null;
  private layout: LiveLayout | null = null;
  /** Per device, the vertex index of each terminal, -1 if the terminal touches no wire. */
  private deviceVertices: number[][] = [];
  /** The vertex of each pin of a block, -1 if no wire reaches it. */
  private pinVertices: number[] = [];
  private injected = new Float64Array(0);
  /** Set after a solver failure: the circuit needs an edit before it can run again. */
  private failed = false;
  /** Whether the engine already started again on its own after a failure, since the last edit. */
  private hasRestarted = false;
  private probes: ScopeProbe[] = [];
  private probeRevision = 0;
  private readers: (() => number)[] = [];
  private sampleTimes: number[] = [];
  private sampleValues: number[][] = [];
  private lastCircuit: Circuit | null = null;
  private meters = new Map<string, { index: number; mode: unknown; window: MeterWindow; read: () => number }>();
  private period: number | null = null;
  /** The LEDs and lamps, by device, with the sum of their currents or powers over the steps since the last frame. */
  private leds: number[] = [];
  private lamps: number[] = [];
  private ledSum = new Float64Array(0);
  private lampSquares = new Float64Array(0);
  private ledSteps = 0;

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
      if (probe.kind === 'pin') {
        const net = computeConnectivity(lastCircuit).netOf.get(terminalKey(probe.elementId, probe.terminal));
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
          if (device.kind === 'ctransformer') return () => engine.nodeVoltage(device.starts[1]) - engine.nodeVoltage(device.ends[2]);
          if (device.kind === 'relay') return () => engine.nodeVoltage(device.c) - engine.nodeVoltage(device.d);
          if (device.kind === 'opto') return () => engine.nodeVoltage(device.c) - engine.nodeVoltage(device.e);
          if (device.kind === 'ssr') return () => engine.nodeVoltage(device.c) - engine.nodeVoltage(device.d);
          return device.kind === 'bjt' || device.kind === 'mos' ? () => engine.nodeVoltage(device.base) - engine.nodeVoltage(device.b) : () => NaN;
        case 'ib':
          if (device.kind === 'regulator') return () => -engine.terminalCurrents(index)[1];
          if (device.kind === 'transformer' || device.kind === 'relay' || device.kind === 'opto' || device.kind === 'ssr') return () => engine.terminalCurrents(index)[2];
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
      const read = mode.unit === 'A' ? () => engine.deviceCurrent(index) : () => engine.nodeVoltage(device.a) - engine.nodeVoltage(device.b);
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
    // Opened here once, so that the layout, the probes and the engine see the same parts
    const opened = flattenBlocks(circuit);
    const result = compileCircuit(opened);
    if (!result.ok) {
      this.engine = null;
      this.resolveProbes();
      this.resolveMeters();
      return result;
    }
    const { compiled } = result;
    this.lastCircuit = opened;

    this.layout = buildLiveLayout(opened, compiled);
    const { graph, devices, blockPins } = this.layout;
    this.deviceVertices = devices.map((d) => d.terminals.map((p) => graph.vertexOf.get(ptKey(p)) ?? -1));
    this.pinVertices = blockPins.map((pin) => graph.vertexOf.get(ptKey(pin.at)) ?? -1);
    this.injected = new Float64Array(graph.vertexCount);

    const previous = this.engine;
    const next = new RealtimeEngine(compiled);
    // After a step that did not converge, what the old engine holds is no solution: a new value starts
    // from a new operating point, rather than from that
    const canAdopt = previous !== null && !this.failed && previous.compiled.signature === compiled.signature;
    this.failed = false;
    this.hasRestarted = false;
    try {
      if (canAdopt) {
        next.adoptState(previous);
      } else {
        // New topology: a new operating point, but the sources carry on from the same time, and a
        // board with the same program goes on running it
        next.time = previous?.time ?? 0;
        next.initialize();
        if (previous) next.adoptMcus(previous);
      }
    } catch (err) {
      this.engine = null;
      this.resolveProbes();
      this.resolveMeters();
      if (err instanceof SolverError) return { ok: false, errors: [err.message] };
      throw err;
    }
    this.engine = next;
    const defOf = (id: string) => opened.elements.find((el) => el.id === id)?.def;
    this.leds = compiled.elementIds.flatMap((id, i) => (defOf(id) === 'led' ? [i] : []));
    this.lamps = compiled.elementIds.flatMap((id, i) => (defOf(id) === 'lamp' ? [i] : []));
    this.ledSum = new Float64Array(compiled.devices.length);
    this.lampSquares = new Float64Array(compiled.devices.length).fill(NaN);
    this.ledSteps = 0;
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
    // The square of each lamp voltage follows its mean over two periods of the slowest generator, however
    // fast the animation runs: on alternating current a frame can hold only a slice of a period
    const keep = Math.exp(-h / (2 * (this.period ?? LAMP_RMS_TIME)));
    while (done < steps) {
      this.engine.step(h);
      done++;
      for (const i of this.leds) this.ledSum[i] += this.engine.deviceCurrent(i);
      for (const i of this.lamps) {
        this.ledSum[i] += this.lampPower(i);
        const square = this.lampVoltage(i) ** 2;
        this.lampSquares[i] = Number.isNaN(this.lampSquares[i]) ? square : keep * this.lampSquares[i] + (1 - keep) * square;
      }
      if (this.leds.length + this.lamps.length > 0) this.ledSteps++;
      this.meters.forEach((meter) => meter.window.add(meter.read(), h, window));
      if (this.readers.length > 0) {
        this.sampleTimes.push(this.engine.time);
        this.readers.forEach((read, i) => this.sampleValues[i].push(read()));
      }
      if ((done & 7) === 0 && performance.now() - start > budgetMs) break;
    }
    return done;
  }

  /** The voltage across a lamp now. */
  private lampVoltage(index: number): number {
    const engine = this.engine!;
    const d = engine.compiled.devices[index];
    return engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b);
  }

  /** The power a lamp takes now: its voltage times its current. */
  private lampPower(index: number): number {
    return this.lampVoltage(index) * this.engine!.deviceCurrent(index);
  }

  /**
   * After a step that did not converge, once for each version of the circuit: a new operating point at
   * the same time, as a fresh load would find it, with the boards going on with their programs. A
   * passing difficulty, as a sharp edge met with a long step, so does not stop the animation; one that
   * comes back is shown.
   */
  restartOnce(): boolean {
    const previous = this.engine;
    if (this.hasRestarted || !previous) return false;
    this.hasRestarted = true;
    const next = new RealtimeEngine(previous.compiled);
    next.time = previous.time;
    try {
      next.initialize();
    } catch (err) {
      if (err instanceof SolverError) return false;
      throw err;
    }
    next.adoptMcus(previous);
    this.engine = next;
    this.failed = false;
    this.resolveProbes();
    this.resolveMeters();
    return true;
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
    const terminalCurrents: number[][] = [];
    devices.forEach((d, i) => {
      const currents = engine.terminalCurrents(i);
      terminalCurrents.push(currents);
      deviceCurrent[i] = currents[0];
      deviceVoltage[i] = engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b);
      if (d.kind === 'transformer') deviceVbe[i] = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.d);
      if (d.kind === 'ctransformer') deviceVbe[i] = engine.nodeVoltage(d.starts[1]) - engine.nodeVoltage(d.ends[2]);
      if (d.kind === 'bjt' || d.kind === 'mos') deviceVbe[i] = engine.nodeVoltage(d.base) - engine.nodeVoltage(d.b);
      if (d.kind === 'regulator') deviceVbe[i] = engine.nodeVoltage(d.b) - engine.nodeVoltage(d.base);
      if (d.kind === 'pot') deviceVbe[i] = engine.nodeVoltage(d.w);
      if (d.kind === 'relay') deviceVbe[i] = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.d);
      if (d.kind === 'timer') deviceVbe[i] = engine.nodeVoltage(d.vcc) - engine.nodeVoltage(d.b);
      if (d.kind === 'opto') deviceVbe[i] = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.e);
      if (d.kind === 'ssr') deviceVbe[i] = engine.nodeVoltage(d.c) - engine.nodeVoltage(d.d);
      const { firstDot } = layout.devices[i];
      if (firstDot < 0) {
        // Inside a block: what it takes reaches the sheet through the pins
      } else if (d.kind === 'logic' || d.kind === 'display7' || d.kind === 'bridge' || d.kind === 'mcu') currents.forEach((current, k) => (dotCurrent[firstDot + k] = current));
      else if (d.kind === 'ctransformer') [dotCurrent[firstDot], dotCurrent[firstDot + 1], dotCurrent[firstDot + 2]] = [currents[0], currents[2], -currents[4]];
      else if (d.kind === 'relay' && currents.length === 5) [dotCurrent[firstDot], dotCurrent[firstDot + 1], dotCurrent[firstDot + 2]] = [currents[0], -currents[3], -currents[4]];
      else if (currents.length === 2) dotCurrent[firstDot] = currents[0];
      else if (currents.length === 4) [dotCurrent[firstDot], dotCurrent[firstDot + 1]] = [currents[0], currents[2]];
      else currents.forEach((current, k) => (dotCurrent[firstDot + k] = current));
      // The wires give each terminal the current that enters it
      currents.forEach((current, k) => {
        const vertex = deviceVertices[i][k];
        if (vertex >= 0) injected[vertex] -= current;
      });
    });

    layout.blockPins.forEach((pin, k) => {
      const vertex = this.pinVertices[k];
      if (vertex < 0) return;
      for (const [index, terminal] of pin.inside) injected[vertex] -= terminalCurrents[index][terminal];
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
    const motors = devices.map((_, i) => engine.motorStatus(i));
    const logic = devices.map((d, i) => (d.kind === 'logic' ? engine.logicLevels(i) : null));
    const relays = devices.map((_, i) => engine.relayIsClosed(i));
    const mcus = devices.map((_, i) => engine.mcuStatus(i));
    const timers = devices.map((_, i) => engine.timerStatus(i));
    const optos = devices.map((_, i) => engine.optoStatus(i));
    const ssrs = devices.map((_, i) => engine.ssrStatus(i));
    const glowMean = new Float64Array(devices.length).fill(NaN);
    for (const i of this.leds) glowMean[i] = this.ledSteps > 0 ? this.ledSum[i] / this.ledSteps : engine.deviceCurrent(i);
    for (const i of this.lamps) glowMean[i] = this.ledSteps > 0 ? this.ledSum[i] / this.ledSteps : this.lampPower(i);
    const lampRms = new Float64Array(devices.length).fill(NaN);
    for (const i of this.lamps) lampRms[i] = Number.isNaN(this.lampSquares[i]) ? Math.abs(this.lampVoltage(i)) : Math.sqrt(this.lampSquares[i]);
    this.ledSum.fill(0);
    this.ledSteps = 0;
    return { time: engine.time, edgeVoltage, edgeCurrent, deviceCurrent, deviceVoltage, deviceVbe, dotCurrent, meterMean, meterAc, regulators, motors, relays, mcus, timers, optos, ssrs, glowMean, lampRms, logic, scope: this.takeSamples() };
  }
}
