import { AcResult, DcResult, TranResult } from './ngspice';
import type { AnalysisKind, WorkerRequest, WorkerResponse } from './ngspice.worker';

const TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();
let engineReady = false;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./ngspice.worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    if (e.data.type === 'ready') engineReady = true;
  });
  worker = w;
  return w;
}

function discardWorker(w: Worker) {
  w.terminate();
  if (worker === w) {
    worker = null;
    engineReady = false;
  }
}

/** True once ngspice is loaded, when an analysis no longer has to wait for it. */
export function isEngineReady(): boolean {
  return engineReady;
}

/** Loads ngspice ahead of the first analysis. Not needed for it to work, a run loads it anyway. */
export function preloadEngine() {
  const w = getWorker();
  // Without this, a worker that failed to load would only be noticed when a run times out
  w.addEventListener('error', () => discardWorker(w), { once: true });
  const request: WorkerRequest = { type: 'preload' };
  w.postMessage(request);
}

function runInWorker(netlist: string, kind: AnalysisKind): Promise<TranResult | AcResult | DcResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = nextId++;

    const finish = () => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type !== 'result' || e.data.id !== id) return;
      finish();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    const onError = (e: ErrorEvent) => {
      finish();
      discardWorker(w);
      reject(new Error(e.message || 'Errore nel worker di ngspice'));
    };
    // ngspice cannot be interrupted from inside: a stuck run needs a fresh worker
    const timer = setTimeout(() => {
      finish();
      discardWorker(w);
      reject(new Error(`Simulazione interrotta dopo ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const request: WorkerRequest = { type: 'run', id, netlist, kind };
    w.postMessage(request);
  });
}

/** Runs one simulation at a time, because the engine holds a single netlist. */
function enqueue(netlist: string, kind: AnalysisKind): Promise<TranResult | AcResult | DcResult> {
  const job = queue.then(() => runInWorker(netlist, kind));
  queue = job.catch(() => undefined);
  return job;
}

export const simulate = (netlist: string) => enqueue(netlist, 'tran') as Promise<TranResult>;
export const simulateAc = (netlist: string) => enqueue(netlist, 'ac') as Promise<AcResult>;
export const simulateDc = (netlist: string) => enqueue(netlist, 'dc') as Promise<DcResult>;
