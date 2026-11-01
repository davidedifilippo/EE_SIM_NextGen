import { runTransient, TranResult } from './ngspice';

export type WorkerRequest = { id: number; netlist: string };
export type WorkerResponse = { id: number; ok: true; result: TranResult } | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, netlist } = e.data;
  let response: WorkerResponse;
  try {
    response = { id, ok: true, result: await runTransient(netlist) };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
