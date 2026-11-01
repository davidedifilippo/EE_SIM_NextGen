import { Circuit, Pt, SpiceDef } from '../model/types';
import { getDevice } from '../library/devices';
import { computeConnectivity } from '../netlist/connectivity';
import { localToWorld, ptKey } from '../utils/geometry';
import { CompiledCircuit, compileCircuit } from './compile';
import { RealtimeEngine, SolverError } from './engine';
import { buildWireGraph, solveWireCurrents, WireGraph } from './wireGraph';

export interface LiveDevice {
  elementId: string;
  /** World position of the first and second terminal. */
  a: Pt;
  b: Pt;
}

/** What the animation draws. Main thread and worker build it from the same circuit, so indices match. */
export interface LiveLayout {
  graph: WireGraph;
  devices: LiveDevice[];
}

export interface LiveFrame {
  time: number;
  edgeVoltage: Float64Array;
  edgeCurrent: Float64Array;
  deviceCurrent: Float64Array;
  /** Voltage across each device, first terminal minus second. */
  deviceVoltage: Float64Array;
}

const terminalsOf = (s: Exclude<SpiceDef, { kind: 'ground' }>): [string, string] => {
  switch (s.kind) {
    case 'passive':
      return [s.a, s.b];
    case 'vsource':
      return [s.pos, s.neg];
    case 'diode':
      return [s.anode, s.cathode];
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
  const devices = compiled.elementIds.map((id): LiveDevice => {
    const el = byId.get(id)!;
    const def = getDevice(el.def)!;
    const [first, second] = terminalsOf(def.spice as Exclude<SpiceDef, { kind: 'ground' }>);
    const at = (terminal: string) => localToWorld(el.x, el.y, def.terminals.find((t) => t.id === terminal)!, el.rot);
    return { elementId: id, a: at(first), b: at(second) };
  });

  return { graph: buildWireGraph(circuit.wires, terminals, grounds), devices };
}

export type LoadResult = { ok: true } | { ok: false; errors: string[] };

/** The running simulation behind the animation, independent of how it is scheduled. */
export class LiveSimulation {
  private engine: RealtimeEngine | null = null;
  private layout: LiveLayout | null = null;
  private edgeNode = new Int32Array(0);
  /** Device order to vertex indices of its terminals, -1 if the terminal touches no wire. */
  private deviceVertices = new Int32Array(0);
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
    const { wireNet } = computeConnectivity(circuit);
    this.edgeNode = Int32Array.from(graph.edges, (e) => compiled.netIndex.get(wireNet.get(e.wireId)!) ?? -1);
    this.deviceVertices = Int32Array.from(devices.flatMap((d) => [d.a, d.b].map((p) => graph.vertexOf.get(ptKey(p)) ?? -1)));
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
    injected.fill(0);
    devices.forEach((d, i) => {
      const current = engine.deviceCurrent(i);
      deviceCurrent[i] = current;
      deviceVoltage[i] = engine.nodeVoltage(d.a) - engine.nodeVoltage(d.b);
      // The wires give the current to the first terminal and get it back from the second
      const [first, second] = [deviceVertices[d.element * 2], deviceVertices[d.element * 2 + 1]];
      if (first >= 0) injected[first] -= current;
      if (second >= 0) injected[second] += current;
    });

    const edgeCurrent = new Float64Array(layout.graph.edges.length);
    solveWireCurrents(layout.graph, injected, edgeCurrent);
    const edgeVoltage = Float64Array.from(this.edgeNode, (node) => engine.nodeVoltage(node));
    return { time: engine.time, edgeVoltage, edgeCurrent, deviceCurrent, deviceVoltage };
  }
}
