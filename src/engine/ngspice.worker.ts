import { AcResult, loadEngine, runAc, runTransient, TranResult } from './ngspice';

export type WorkerRequest = { type: 'preload' } | { type: 'run'; id: number; netlist: string; isAc: boolean };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; result: TranResult | AcResult }
  | { type: 'result'; id: number; ok: false; error: string };

const reply = (response: WorkerResponse) => self.postMessage(response);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'preload') {
    // A failure here is not reported: the first run tries again and shows the error
    loadEngine().then(() => reply({ type: 'ready' }), () => undefined);
    return;
  }
  const { id, netlist, isAc } = e.data;
  try {
    const result = await (isAc ? runAc(netlist) : runTransient(netlist));
    reply({ type: 'ready' });
    reply({ type: 'result', id, ok: true, result });
  } catch (err) {
    reply({ type: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
