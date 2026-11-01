import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circuit, ComponentDef, Rotation } from './model/types';
import { DEVICES } from './library/devices';
import { describeNodes, generateNetlist } from './netlist/generate';
import { isDcSource } from './netlist/source';
import { halfWaveRectifier } from './samples/halfWaveRectifier';
import { SchematicCanvas } from './editor/SchematicCanvas';
import { downloadCircuit, INVALID_FILE, loadAutosave, MAX_FILE_BYTES, parseCircuitFile, saveAutosave } from './storage/circuitFile';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Series, TransientChart } from './ui/TransientChart';
import { TranResult } from './engine/ngspice';
import { isEngineReady, preloadEngine, simulate } from './engine/ngspiceClient';
import { LiveFrame } from './realtime/liveSimulation';
import { DcValues } from './ui/DcValues';
import { LiveOverlay } from './ui/LiveOverlay';
import { LiveLegend, LiveLegendHandle, SourceStats, SPEEDS } from './ui/LiveControls';
import { useLiveSimulation } from './ui/useLiveSimulation';

interface Run {
  result: TranResult;
  series: Series[];
  netlist: string;
}

const ENGINE_PRELOAD_DELAY_MS = 2000;
const AUTOSAVE_DELAY_MS = 300;

export const App: React.FC = () => {
  const [circuit, setCircuit] = useState<Circuit>(() => loadAutosave() ?? halfWaveRectifier({ capacitor: '100u' }));
  /** Changes when another circuit is opened, so the canvas fits it in view. */
  const [documentId, setDocumentId] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [showValues, setShowValues] = useState(true);

  // ngspice arrives in the background once the page is up, so the first analysis finds it ready
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    const timer = setTimeout(preloadEngine, ENGINE_PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

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
  const isDc = useMemo(() => {
    const sources = circuit.elements.filter((el) => el.def === 'vsource');
    return sources.length > 0 && sources.every((el) => isDcSource(el.props));
  }, [circuit]);
  const labels = useMemo(
    () => showValues && isDc && live.errors.length === 0 && live.layout && <DcValues circuit={circuit} layout={live.layout} frameRef={live.frameRef} />,
    [showValues, isDc, live.errors.length, circuit, live.layout, live.frameRef],
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

  // Soon after each change, and in any case when the page goes away
  const latestCircuit = useRef(circuit);
  latestCircuit.current = circuit;
  useEffect(() => {
    const timer = setTimeout(() => saveAutosave(circuit), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [circuit]);
  useEffect(() => {
    const flush = () => saveAutosave(latestCircuit.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  /** Replaces the circuit. Annulla brings the previous one back. */
  const openCircuit = (next: Circuit) => {
    handleChange(next);
    setSelectedIds(new Set());
    setRun(null);
    setErrors([]);
    setDocumentId((id) => id + 1);
  };

  const openFile = async (file: File) => {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error(INVALID_FILE);
      openCircuit(parseCircuitFile(await file.text()));
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    }
  };

  // Going back to a circuit with nothing in common with this one needs a new fit, as opening it did
  const refitIfOtherCircuit = useCallback(
    (target: Circuit) => {
      const ids = new Set(circuit.elements.map((el) => el.id));
      if (!target.elements.some((el) => ids.has(el.id))) setDocumentId((id) => id + 1);
    },
    [circuit],
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const target = history[history.length - 1];
    refitIfOtherCircuit(target);
    setRedoStack((r) => [circuit, ...r]);
    setCircuit(target);
    setHistory((h) => h.slice(0, -1));
  }, [history, circuit, refitIfOtherCircuit]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    refitIfOtherCircuit(redoStack[0]);
    setHistory((h) => [...h, circuit]);
    setCircuit(redoStack[0]);
    setRedoStack((r) => r.slice(1));
  }, [redoStack, circuit, refitIfOtherCircuit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
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
          <button onClick={() => openCircuit({ title: 'Circuito', elements: [], wires: [], models: circuit.models })}>Nuovo</button>
          <button onClick={() => fileInputRef.current?.click()}>Apri</button>
          <button onClick={() => downloadCircuit(circuit)}>Salva</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Apri un circuito"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so that choosing the same file again still counts as a change
              e.target.value = '';
              if (file) openFile(file);
            }}
          />
        </div>
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
          <label className="values-toggle" title="Tensioni e correnti sullo schema, quando tutti i generatori sono in continua">
            <input type="checkbox" checked={showValues} disabled={!isDc} onChange={(e) => setShowValues(e.target.checked)} />
            Valori
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
            {running ? (isEngineReady() ? 'Analisi…' : 'Carico ngspice…') : 'Analisi precisa'}
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
            key={documentId}
            circuit={circuit}
            onChange={handleChange}
            selectedIds={selectedIds}
            onSelectIds={setSelectedIds}
            activeDefToPlace={activeDef}
            onPlacedDef={() => setActiveDef(null)}
            onDeleteSelected={deleteSelected}
            onRotateSelected={rotateSelected}
            overlay={overlay}
            labels={labels}
          />
          {circuit.elements.length > 0 && <LiveLegend ref={legendRef} errors={live.errors} />}
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
          <button
            className="close-results"
            aria-label="Chiudi risultati"
            title="Chiudi"
            onClick={() => {
              setRun(null);
              setErrors([]);
            }}
          >
            ×
          </button>
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
