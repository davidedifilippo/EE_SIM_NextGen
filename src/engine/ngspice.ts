import { Simulation } from 'eecircuit-engine';

export interface TranResult {
  time: number[];
  /** Node voltages keyed by SPICE node name, lowercase ("n1"). */
  voltages: Map<string, number[]>;
}

let simulation: Promise<Simulation> | null = null;

function getSimulation(): Promise<Simulation> {
  simulation ??= (async () => {
    const sim = new Simulation();
    await sim.start();
    return sim;
  })();
  // A failed start must not stay cached, or every later run would fail the same way
  simulation.catch(() => {
    simulation = null;
  });
  return simulation;
}

export async function loadEngine(): Promise<void> {
  await getSimulation();
}

export interface AcResult {
  frequency: number[];
  /** Node voltages as real and imaginary parts, keyed like TranResult. */
  voltages: Map<string, { re: number[]; im: number[] }>;
}

export async function runAc(netlist: string): Promise<AcResult> {
  const sim = await getSimulation();
  sim.setNetList(netlist);
  const result = await sim.runSim();

  const errors = sim.getError();
  if (errors.length > 0) throw new Error(`ngspice: ${errors.join('\n')}`);
  if (result.dataType !== 'complex') throw new Error('ngspice: risultato reale inatteso per una analisi AC');

  const frequency = result.data.find((d) => d.type === 'frequency')?.values.map((v) => v.real);
  if (!frequency) throw new Error('ngspice: nessun asse delle frequenze nel risultato');

  const voltages = new Map<string, { re: number[]; im: number[] }>();
  for (const d of result.data) {
    if (d.type !== 'voltage') continue;
    voltages.set(d.name.toLowerCase().replace(/^v\((.*)\)$/, '$1'), { re: d.values.map((v) => v.real), im: d.values.map((v) => v.img) });
  }
  return { frequency, voltages };
}

export interface DcResult {
  /** The swept voltage. */
  x: number[];
  /** Node voltages, one array per value of the second generator. */
  voltages: Map<string, number[][]>;
  /** What each generator delivers, by its name in the netlist, with the same shape. */
  currents: Map<string, number[][]>;
}

/** The sweep repeats for each value of the second generator: this cuts it where it starts over. */
export function splitDcCurves(sweep: number[], series: Record<string, number[]>): { x: number[]; curves: Record<string, number[][]> } {
  const again = sweep.findIndex((v, i) => i > 0 && v === sweep[0]);
  const size = again > 0 ? again : sweep.length;
  const curves: Record<string, number[][]> = {};
  for (const [name, values] of Object.entries(series)) {
    curves[name] = [];
    for (let i = 0; i < values.length; i += size) curves[name].push(values.slice(i, i + size));
  }
  return { x: sweep.slice(0, size), curves };
}

export async function runDc(netlist: string): Promise<DcResult> {
  const sim = await getSimulation();
  sim.setNetList(netlist);
  const result = await sim.runSim();

  const errors = sim.getError();
  if (errors.length > 0) throw new Error(`ngspice: ${errors.join('\n')}`);
  if (result.dataType !== 'real') throw new Error('ngspice: risultato complesso inatteso per un DC sweep');

  const sweep = result.data.find((d) => d.name.toLowerCase() === 'v(v-sweep)')?.values;
  if (!sweep) throw new Error('ngspice: nessuna tensione variata nel risultato');

  const series: Record<string, number[]> = {};
  const currentNames: string[] = [];
  for (const d of result.data) {
    const name = d.name.toLowerCase();
    if (name === 'v(v-sweep)') continue;
    if (d.type === 'voltage') {
      series[`v:${name.replace(/^v\((.*)\)$/, '$1')}`] = d.values;
    } else if (d.type === 'current' && /^i\(v/.test(name)) {
      const source = name.replace(/^i\((.*)\)$/, '$1').toUpperCase();
      currentNames.push(source);
      // SPICE counts the current entering the positive terminal: what the generator delivers is the opposite
      series[`i:${source}`] = d.values.map((v) => (v === 0 ? 0 : -v));
    }
  }
  const { x, curves } = splitDcCurves(sweep, series);
  const voltages = new Map<string, number[][]>();
  const currents = new Map<string, number[][]>();
  for (const [key, value] of Object.entries(curves)) {
    if (key.startsWith('v:')) voltages.set(key.slice(2), value);
    else currents.set(key.slice(2), value);
  }
  return { x, voltages, currents };
}

export async function runTransient(netlist: string): Promise<TranResult> {
  const sim = await getSimulation();
  sim.setNetList(netlist);
  const result = await sim.runSim();

  const errors = sim.getError();
  if (errors.length > 0) throw new Error(`ngspice: ${errors.join('\n')}`);
  if (result.dataType !== 'real') throw new Error('ngspice: risultato complesso inatteso per un transitorio');

  const time = result.data.find((d) => d.type === 'time')?.values;
  if (!time) throw new Error('ngspice: nessun asse dei tempi nel risultato');

  const voltages = new Map<string, number[]>();
  for (const d of result.data) {
    if (d.type !== 'voltage') continue;
    voltages.set(d.name.toLowerCase().replace(/^v\((.*)\)$/, '$1'), d.values);
  }
  return { time, voltages };
}
