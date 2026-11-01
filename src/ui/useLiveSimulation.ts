import { useEffect, useMemo, useRef, useState } from 'react';
import { Circuit } from '../model/types';
import { compileCircuit } from '../realtime/compile';
import { buildLiveLayout, LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import type { LiveRequest, LiveResponse } from '../realtime/live.worker';

export interface LiveState {
  /** Null while the circuit cannot run yet. */
  layout: LiveLayout | null;
  /** The latest frame for the current circuit; read during animation, without re-rendering. */
  frameRef: React.MutableRefObject<LiveFrame | null>;
  keptUpRef: React.MutableRefObject<number>;
  errors: string[];
}

export function useLiveSimulation(circuit: Circuit, running: boolean, simSecondsPerSecond: number): LiveState {
  const workerRef = useRef<Worker | null>(null);
  const revisionRef = useRef(0);
  const frameRef = useRef<LiveFrame | null>(null);
  const keptUpRef = useRef(1);
  const [workerErrors, setWorkerErrors] = useState<string[]>([]);

  const compiled = useMemo(() => compileCircuit(circuit), [circuit]);
  const layout = useMemo(() => (compiled.ok ? buildLiveLayout(circuit, compiled.compiled) : null), [circuit, compiled]);

  const send = (message: LiveRequest) => workerRef.current?.postMessage(message);
  const latest = useRef({ circuit, running, simSecondsPerSecond });
  latest.current = { circuit, running, simSecondsPerSecond };

  useEffect(() => {
    const worker = new Worker(new URL('../realtime/live.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<LiveResponse>) => {
      const message = e.data;
      if (message.revision !== revisionRef.current) return;
      if (message.type === 'status') {
        setWorkerErrors(message.errors);
      } else {
        frameRef.current = message.frame;
        keptUpRef.current = message.keptUp;
      }
    };
    const current = latest.current;
    send({ type: 'config', running: current.running, simSecondsPerSecond: current.simSecondsPerSecond });
    send({ type: 'load', revision: revisionRef.current, circuit: current.circuit });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    revisionRef.current += 1;
    frameRef.current = null;
    send({ type: 'load', revision: revisionRef.current, circuit });
  }, [circuit]);

  useEffect(() => {
    send({ type: 'config', running, simSecondsPerSecond });
  }, [running, simSecondsPerSecond]);

  return {
    layout,
    frameRef,
    keptUpRef,
    errors: compiled.ok ? workerErrors : compiled.errors,
  };
}
