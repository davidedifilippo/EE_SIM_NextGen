import { TranResult } from './ngspice';
import type { WorkerRequest, WorkerResponse } from './ngspice.worker';

const TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();

/** ngspice is loaded on the first run, so opening the app does not download it. */
function getWorker(): Worker {
  worker ??= new Worker(new URL('./ngspice.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function runInWorker(netlist: string): Promise<TranResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = nextId++;

    const finish = () => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const discardWorker = () => {
      w.terminate();
      if (worker === w) worker = null;
    };
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== id) return;
      finish();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    const onError = (e: ErrorEvent) => {
      finish();
      discardWorker();
      reject(new Error(e.message || 'Errore nel worker di ngspice'));
    };
    // ngspice cannot be interrupted from inside: a stuck run needs a fresh worker
    const timer = setTimeout(() => {
      finish();
      discardWorker();
      reject(new Error(`Simulazione interrotta dopo ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const request: WorkerRequest = { id, netlist };
    w.postMessage(request);
  });
}

/** Runs one simulation at a time, because the engine holds a single netlist. */
export function simulate(netlist: string): Promise<TranResult> {
  const job = queue.then(() => runInWorker(netlist));
  queue = job.catch(() => undefined);
  return job;
}
