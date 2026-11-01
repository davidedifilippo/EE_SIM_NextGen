import { Circuit, Pt, SpiceDef } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity } from '../netlist/connectivity';
import { localToWorld, ptKey } from '../utils/geometry';
import { CompiledCircuit, compileCircuit } from './compile';
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
  /** Voltage across each device, first terminal minus second; collector minus emitter for a transistor. */
  deviceVoltage: Float64Array;
  /** Base minus emitter voltage of a transistor, 0 for the rest. */
  deviceVbe: Float64Array;
  dotCurrent: Float64Array;
}

const terminalsOf = (s: Exclude<SpiceDef, { kind: 'ground' }>): string[] => {
  switch (s.kind) {
    case 'passive':
      return [s.a, s.b];
    case 'vsource':
      return [s.pos, s.neg];
    case 'diode':
      return [s.anode, s.cathode];
    case 'bjt':
      return [s.collector, s.base, s.emitter];
  }
};

export function buildLiveLayout(circuit: Circuit, compiled: CompiledCircuit): LiveLayout {
  const terminals: Pt[] = [];
  const grounds: Pt[] = [];
  for (const el of circuit.elements) {
    const def = getDevice(el.def);
    for (const t of def?.terminals ?? []) {
      const pt = localToWorld(el.x, el.y, t, el.rot);
      terminals.push(pt);
      if (def?.spice.kind === 'ground') grounds.push(pt);
    }
  }

  const byId = new Map(circuit.elements.map((el) => [el.id, el]));
  const dots: DeviceDots[] = [];
  const devices = compiled.elementIds.map((id): LiveDevice => {
    const el = byId.get(id)!;
    const def = getDevice(el.def)!;
    const at = (terminal: string) => localToWorld(el.x, el.y, def.terminals.find((t) => t.id === terminal)!, el.rot);
    const points = terminalsOf(def.spice as Exclude<SpiceDef, { kind: 'ground' }>).map(at);
    const firstDot = dots.length;
    // Through a two-terminal device in one run; in a transistor, each lead meets at the center
    if (points.length === 2) dots.push({ a: points[0], b: points[1] });
    else points.forEach((p) => dots.push({ a: p, b: { x: el.x, y: el.y } }));
    return { elementId: id, terminals: points, firstDot };
  });

  const graph = buildWireGraph(circuit.wires, terminals, grounds);
  const { wireNet } = computeConnectivity(circuit);
  const edgeNode = Int32Array.from(graph.edges, (e) => compiled.netIndex.get(wireNet.get(e.wireId)!) ?? -1);
  return { graph, edgeNode, devices, dots };
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

  load(circuit: Circuit): LoadResult {
    const result = compileCircuit(circuit);
    if (!result.ok) {
      this.engine = null;
      return result;
    }
    const { compiled } = result;

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
      if (err instanceof SolverError) return { ok: false, errors: [err.message] };
      throw err;
    }
    this.engine = next;
    return { ok: true };
  }

  /** Runs up to the given number of steps within the time budget and returns how many were done. */
  advance(steps: number, h: number, budgetMs: number): number {
    if (!this.engine || this.failed) return 0;
    const start = performance.now();
    let done = 0;
    while (done < steps) {
      this.engine.step(h);
      done++;
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
      if (d.kind === 'bjt') deviceVbe[i] = engine.nodeVoltage(d.base) - engine.nodeVoltage(d.b);
      const { firstDot } = layout.devices[i];
      if (currents.length === 2) dotCurrent[firstDot] = currents[0];
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
    return { time: engine.time, edgeVoltage, edgeCurrent, deviceCurrent, deviceVoltage, deviceVbe, dotCurrent };
  }
}
