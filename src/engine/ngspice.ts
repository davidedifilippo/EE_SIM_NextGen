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
