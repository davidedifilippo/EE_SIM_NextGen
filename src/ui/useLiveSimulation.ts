import { useEffect, useMemo, useRef, useState } from 'react';
import { Circuit } from '../model/types';
import { compileCircuit } from '../realtime/compile';
import { buildLiveLayout, LiveFrame, LiveLayout, ScopeProbe } from '../realtime/liveSimulation';
import type { LiveRequest, LiveResponse } from '../realtime/live.worker';
import { ScopeBuffer } from './scopeBuffer';

export interface LiveState {
  /** Null while the circuit cannot run yet. */
  layout: LiveLayout | null;
  /** The latest frame for the current circuit; read during animation, without re-rendering. */
  frameRef: React.MutableRefObject<LiveFrame | null>;
  keptUpRef: React.MutableRefObject<number>;
  scopeRef: React.MutableRefObject<ScopeBuffer>;
  errors: string[];
}

export function useLiveSimulation(circuit: Circuit, running: boolean, simSecondsPerSecond: number, probes: ScopeProbe[]): LiveState {
  const workerRef = useRef<Worker | null>(null);
  const revisionRef = useRef(0);
  const frameRef = useRef<LiveFrame | null>(null);
  const keptUpRef = useRef(1);
  const scopeRef = useRef(new ScopeBuffer());
  const probeRevisionRef = useRef(0);
  const [workerErrors, setWorkerErrors] = useState<string[]>([]);

  const compiled = useMemo(() => compileCircuit(circuit), [circuit]);
  const layout = useMemo(() => (compiled.ok ? buildLiveLayout(circuit, compiled.compiled) : null), [circuit, compiled]);

  const send = (message: LiveRequest) => workerRef.current?.postMessage(message);
  const latest = useRef({ circuit, running, simSecondsPerSecond, probes });
  latest.current = { circuit, running, simSecondsPerSecond, probes };

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
        const { scope } = message.frame;
        if (scope && scope.probeRevision === probeRevisionRef.current) scopeRef.current.append(scope.time, scope.values);
      }
    };
    const current = latest.current;
    send({ type: 'config', running: current.running, simSecondsPerSecond: current.simSecondsPerSecond });
    send({ type: 'load', revision: revisionRef.current, circuit: current.circuit });
    send({ type: 'probes', probeRevision: probeRevisionRef.current, probes: current.probes });
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

  useEffect(() => {
    probeRevisionRef.current += 1;
    scopeRef.current.reset(probes.length);
    send({ type: 'probes', probeRevision: probeRevisionRef.current, probes });
  }, [probes]);

  return {
    layout,
    frameRef,
    keptUpRef,
    scopeRef,
    errors: compiled.ok ? workerErrors : compiled.errors,
  };
}
