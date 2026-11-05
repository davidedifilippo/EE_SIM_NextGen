import { useEffect, useMemo, useRef, useState } from 'react';
import { Circuit } from '../model/types';
import { compileCircuit } from '../realtime/compile';
import { buildLiveLayout, LiveFrame, LiveLayout, ScopeProbe } from '../realtime/liveSimulation';
import type { LiveRequest, LiveResponse } from '../realtime/live.worker';
import { ScopeBuffer } from './scopeBuffer';
import { getDevice } from '../library/devices';
import { programKey } from '../realtime/intelHex';

export interface LiveState {
  /** Null while the circuit cannot run yet. */
  layout: LiveLayout | null;
  /** The latest frame for the current circuit; read during animation, without re-rendering. */
  frameRef: React.MutableRefObject<LiveFrame | null>;
  keptUpRef: React.MutableRefObject<number>;
  scopeRef: React.MutableRefObject<ScopeBuffer>;
  /** What each Arduino wrote on its serial port, by element: gathered from every frame, so none is lost between two looks. */
  serialRef: React.MutableRefObject<SerialLog>;
  errors: string[];
}

/** The text of each serial monitor, with a count that moves whenever any of it changes. */
export interface SerialLog {
  text: Map<string, string>;
  version: number;
}

/** The last lines of a monitor: enough to scroll back a while. */
const SERIAL_KEEP = 8000;

export function useLiveSimulation(circuit: Circuit, running: boolean, simSecondsPerSecond: number, probes: ScopeProbe[]): LiveState {
  const workerRef = useRef<Worker | null>(null);
  const revisionRef = useRef(0);
  const frameRef = useRef<LiveFrame | null>(null);
  const keptUpRef = useRef(1);
  const scopeRef = useRef(new ScopeBuffer());
  const serialRef = useRef<SerialLog>({ text: new Map(), version: 0 });
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
        for (const mcu of message.frame.mcus) {
          if (!mcu?.serial) continue;
          const log = serialRef.current;
          log.text.set(mcu.id, ((log.text.get(mcu.id) ?? '') + mcu.serial).slice(-SERIAL_KEEP));
          log.version++;
        }
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

  // A board that starts another program, or starts again, begins with an empty monitor
  const programs = useMemo(
    () =>
      JSON.stringify(
        circuit.elements.filter((el) => getDevice(el.def)?.spice.kind === 'mcu').map((el) => [el.id, el.props.sketch, programKey(String(el.props.hex ?? '')), el.props.resets]),
      ),
    [circuit],
  );
  useEffect(() => {
    serialRef.current.text.clear();
    serialRef.current.version++;
  }, [programs]);

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
    serialRef,
    errors: compiled.ok ? workerErrors : compiled.errors,
  };
}
