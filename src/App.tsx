import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circuit, ComponentDef, Rotation } from './model/types';
import { DEVICES } from './library/devices';
import { describeNodes, generateNetlist } from './netlist/generate';
import { halfWaveRectifier } from './samples/halfWaveRectifier';
import { SchematicCanvas } from './editor/SchematicCanvas';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Series, TransientChart } from './ui/TransientChart';
import { TranResult } from './engine/ngspice';
import { simulate } from './engine/ngspiceClient';
import { LiveFrame } from './realtime/liveSimulation';
import { LiveOverlay } from './ui/LiveOverlay';
import { LiveLegend, LiveLegendHandle, SourceStats, SPEEDS } from './ui/LiveControls';
import { useLiveSimulation } from './ui/useLiveSimulation';

interface Run {
  result: TranResult;
  series: Series[];
  netlist: string;
}

export const App: React.FC = () => {
  const [circuit, setCircuit] = useState<Circuit>(() => halfWaveRectifier({ capacitor: '100u' }));
  const [history, setHistory] = useState<Circuit[]>([]);
  const [redoStack, setRedoStack] = useState<Circuit[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeDef, setActiveDef] = useState<ComponentDef | null>(null);
  const [stop, setStop] = useState('100m');
  const [step, setStep] = useState('20u');
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [liveRunning, setLiveRunning] = useState(true);
  const [speed, setSpeed] = useState(20e-3);

  const live = useLiveSimulation(circuit, liveRunning, speed);
  const legendRef = useRef<LiveLegendHandle>(null);
  const { keptUpRef } = live;
  const handleScale = useCallback(
    (maxVoltage: number, frame: LiveFrame | null) => legendRef.current?.update(maxVoltage, frame, keptUpRef.current),
    [keptUpRef],
  );
  const overlay = useMemo(
    () => live.layout && <LiveOverlay layout={live.layout} frameRef={live.frameRef} onScale={handleScale} />,
    [live.layout, live.frameRef, handleScale],
  );

  const handleChange = useCallback(
    (next: Circuit, recordHistory = true) => {
      if (recordHistory) {
        setHistory((h) => [...h, circuit]);
        setRedoStack([]);
      }
      setCircuit(next);
    },
    [circuit],
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setRedoStack((r) => [circuit, ...r]);
    setCircuit(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  }, [history, circuit]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    setHistory((h) => [...h, circuit]);
    setCircuit(redoStack[0]);
    setRedoStack((r) => r.slice(1));
  }, [redoStack, circuit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const deleteSelected = useCallback(() => {
    handleChange({
      ...circuit,
      elements: circuit.elements.filter((el) => !selectedIds.has(el.id)),
      wires: circuit.wires.filter((w) => !selectedIds.has(w.id)),
    });
    setSelectedIds(new Set());
  }, [circuit, selectedIds, handleChange]);

  const rotateSelected = useCallback(() => {
    handleChange({
      ...circuit,
      elements: circuit.elements.map((el) =>
        selectedIds.has(el.id) ? { ...el, rot: ((el.rot + 90) % 360) as Rotation } : el,
      ),
    });
  }, [circuit, selectedIds, handleChange]);

  const analysis = useMemo(() => ({ type: 'tran', step, stop, maxStep: step }) as const, [step, stop]);
  const netlist = useMemo(() => generateNetlist(circuit, analysis), [circuit, analysis]);

  const runSimulation = async () => {
    if (netlist.errors.length > 0) {
      setErrors(netlist.errors);
      return;
    }
    setErrors([]);
    setRunning(true);
    try {
      const result = await simulate(netlist.text);
      const labels = describeNodes(circuit, netlist.nodeOf);
      const series = [...result.voltages.keys()]
        .filter((node) => labels.has(node))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .map((node) => ({ node, label: `${node} (${labels.get(node)})` }));
      setRun({ result, series, netlist: netlist.text });
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setRunning(false);
    }
  };

  const isStale = run !== null && run.netlist !== netlist.text;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>EE_SIM_NextGen</h1>
        <div className="button-row">
          <button onClick={undo} disabled={history.length === 0}>
            Annulla
          </button>
          <button onClick={redo} disabled={redoStack.length === 0}>
            Ripeti
          </button>
        </div>
        <div className="button-row live-controls">
          <button onClick={() => setLiveRunning((r) => !r)}>{liveRunning ? 'Pausa' : 'Avvia'}</button>
          <label>
            Velocità
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s.label} value={s.simSecondsPerSecond}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="analysis">
          <label>
            Durata
            <input value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          <label>
            Passo
            <input value={step} onChange={(e) => setStep(e.target.value)} />
          </label>
          <button className="primary" onClick={runSimulation} disabled={running}>
            {running ? 'Analisi…' : 'Analisi precisa'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <nav className="palette" aria-label="Componenti">
          {DEVICES.map((def) => (
            <button
              key={def.id}
              className={activeDef?.id === def.id ? 'active' : ''}
              aria-pressed={activeDef?.id === def.id}
              onClick={() => {
                setActiveDef(activeDef?.id === def.id ? null : def);
                setSelectedIds(new Set());
              }}
            >
              {def.name}
            </button>
          ))}
        </nav>

        <div className="canvas-area">
          <SchematicCanvas
            circuit={circuit}
            onChange={handleChange}
            selectedIds={selectedIds}
            onSelectIds={setSelectedIds}
            activeDefToPlace={activeDef}
            onPlacedDef={() => setActiveDef(null)}
            onDeleteSelected={deleteSelected}
            onRotateSelected={rotateSelected}
            overlay={overlay}
          />
          <LiveLegend ref={legendRef} errors={live.errors} />
          <SourceStats circuit={circuit} selectedIds={selectedIds} />
        </div>

        <aside className="side-panel">
          <PropertiesPanel
            circuit={circuit}
            selectedIds={selectedIds}
            onChange={handleChange}
            onRotateSelected={rotateSelected}
            onDeleteSelected={deleteSelected}
            layout={live.layout}
            frameRef={live.frameRef}
          />
        </aside>
      </div>

      {(errors.length > 0 || run) && (
        <section className="results">
          {errors.length > 0 && (
            <ul className="errors" role="alert">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          {isStale && <p className="stale">Il circuito è cambiato: il grafico mostra la simulazione precedente.</p>}
          {run && <TransientChart result={run.result} series={run.series} />}
        </section>
      )}
    </div>
  );
};
