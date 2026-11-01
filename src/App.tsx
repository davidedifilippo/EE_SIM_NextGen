import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circuit, ComponentDef, Rotation, SpiceModel } from './model/types';
import { canMirror, DEVICES, getDevice } from './library/devices';
import { circuitForSaving, withLibraryModels } from './library/models';
import { Analysis, describeNodes, generateNetlist, sweepCount } from './netlist/generate';
import { parseSpiceValue } from './netlist/values';
import { isDcSource } from './netlist/source';
import { halfWaveRectifier } from './samples/halfWaveRectifier';
import { SchematicCanvas } from './editor/SchematicCanvas';
import { libraryAtStart, mergeModels, saveLibrary } from './storage/modelLibrary';
import { downloadCircuit, INVALID_FILE, loadAutosave, MAX_FILE_BYTES, parseCircuitFile, saveAutosave } from './storage/circuitFile';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Series, TransientChart } from './ui/TransientChart';
import { AcResult, DcResult, TranResult } from './engine/ngspice';
import { isEngineReady, preloadEngine, simulate, simulateAc, simulateDc } from './engine/ngspiceClient';
import { LiveFrame, opAmpsToKick, ScopeProbe } from './realtime/liveSimulation';
import { AcSeries, BodeChart } from './ui/BodeChart';
import { hasSignal } from './ui/bode';
import { DcFamily, DcSeries, DcSweepChart } from './ui/DcSweepChart';
import { DcValues } from './ui/DcValues';
import { LiveOverlay } from './ui/LiveOverlay';
import { LiveLegend, LiveLegendHandle, SourceStats, SPEEDS } from './ui/LiveControls';
import { ScopePanel } from './ui/ScopePanel';
import { liveTraces, MAX_TRACES, nextSlot, ScopeTrace, traceLabel } from './ui/scopeTraces';
import { useLiveSimulation } from './ui/useLiveSimulation';

type Run =
  | { kind: 'tran'; result: TranResult; series: Series[]; netlist: string }
  | { kind: 'ac'; result: AcResult; series: AcSeries[]; netlist: string }
  | { kind: 'dc'; result: DcResult; series: DcSeries[]; xLabel: string; family: DcFamily | null; netlist: string };

/** Enough for a smooth curve and a cutoff read to three figures, without weighing on the chart. */
const AC_POINTS_PER_DECADE = 100;

const ENGINE_PRELOAD_DELAY_MS = 2000;
const AUTOSAVE_DELAY_MS = 300;

export const App: React.FC = () => {
  const [circuit, setCircuit] = useState<Circuit>(() => loadAutosave() ?? halfWaveRectifier({ capacitor: '100u' }));
  const [library, setLibrary] = useState<SpiceModel[]>(() => libraryAtStart(circuit));
  /** The circuit as engines and files need it, with the library models it uses. */
  const resolved = useMemo(() => withLibraryModels(circuit, library), [circuit, library]);
  /** Changes when another circuit is opened, so the canvas fits it in view. */
  const [documentId, setDocumentId] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<Circuit[]>([]);
  const [redoStack, setRedoStack] = useState<Circuit[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeDef, setActiveDef] = useState<ComponentDef | null>(null);
  const [stop, setStop] = useState('100m');
  const [step, setStep] = useState('20u');
  const [analysisKind, setAnalysisKind] = useState<'tran' | 'ac' | 'dc'>('tran');
  const [acFrom, setAcFrom] = useState('10');
  const [acTo, setAcTo] = useState('100k');
  const [dcSource, setDcSource] = useState('');
  const [dcFrom, setDcFrom] = useState('0');
  const [dcTo, setDcTo] = useState('10');
  const [dcStep, setDcStep] = useState('0.1');
  const [dcFamilySource, setDcFamilySource] = useState('');
  const [dcFamilyFrom, setDcFamilyFrom] = useState('0');
  const [dcFamilyTo, setDcFamilyTo] = useState('5');
  const [dcFamilyStep, setDcFamilyStep] = useState('1');
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

  const [allTraces, setTraces] = useState<ScopeTrace[]>([]);
  const traces = useMemo(() => liveTraces(allTraces, circuit), [allTraces, circuit]);
  const traceLabels = useMemo(() => new Map(traces.map((t) => [t.id, traceLabel(t, circuit)])), [traces, circuit]);
  const scopeIds = useMemo(() => new Set(traces.map((t) => t.id)), [traces]);
  const toggleProbe = (probe: ScopeProbe) =>
    setTraces(scopeIds.has(probe.id) ? traces.filter((t) => t.id !== probe.id) : [...traces, { ...probe, slot: nextSlot(traces) }]);

  const live = useLiveSimulation(resolved, liveRunning, speed, traces);
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
    () => showValues && isDc && live.errors.length === 0 && live.layout && <DcValues circuit={resolved} layout={live.layout} frameRef={live.frameRef} />,
    [showValues, isDc, live.errors.length, resolved, live.layout, live.frameRef],
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
  const forSaving = useMemo(() => circuitForSaving(circuit, library), [circuit, library]);
  const latestCircuit = useRef(forSaving);
  latestCircuit.current = forSaving;
  useEffect(() => {
    const timer = setTimeout(() => saveAutosave(forSaving), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [forSaving]);
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

  const importModels = (models: SpiceModel[]) => {
    const next = mergeModels(library, models.map(({ name, card }) => ({ name, card })));
    setLibrary(next);
    return saveLibrary(next);
  };

  // The open circuit keeps what it uses: taking a model out of the library must not break it
  const removeModel = (name: string) => {
    setCircuit(resolved);
    const next = library.filter((m) => m.name !== name);
    setLibrary(next);
    saveLibrary(next);
  };

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

  const mirrorSelected = useCallback(() => {
    handleChange({
      ...circuit,
      elements: circuit.elements.map((el) => (selectedIds.has(el.id) && canMirror(getDevice(el.def)) ? { ...el, flip: !el.flip } : el)),
    });
  }, [circuit, selectedIds, handleChange]);

  const rotateSelected = useCallback(() => {
    handleChange({
      ...circuit,
      elements: circuit.elements.map((el) =>
        selectedIds.has(el.id) ? { ...el, rot: ((el.rot + 90) % 360) as Rotation } : el,
      ),
    });
  }, [circuit, selectedIds, handleChange]);

  const generators = useMemo(() => circuit.elements.filter((el) => el.def === 'vsource'), [circuit]);
  // A choice whose generator has gone falls back on the first one, or on no family
  const sweptId = generators.some((g) => g.id === dcSource) ? dcSource : (generators[0]?.id ?? '');
  const familyId = generators.some((g) => g.id === dcFamilySource) && dcFamilySource !== sweptId ? dcFamilySource : '';
  const analysis = useMemo<Analysis>(() => {
    if (analysisKind === 'ac') return { type: 'ac', from: acFrom, to: acTo, pointsPerDecade: AC_POINTS_PER_DECADE };
    if (analysisKind === 'tran') return { type: 'tran', step, stop, maxStep: step };
    return {
      type: 'dc',
      source: sweptId,
      from: dcFrom,
      to: dcTo,
      step: dcStep,
      ...(familyId ? { familySource: familyId, familyFrom: dcFamilyFrom, familyTo: dcFamilyTo, familyStep: dcFamilyStep } : {}),
    };
  }, [analysisKind, acFrom, acTo, step, stop, sweptId, familyId, dcFrom, dcTo, dcStep, dcFamilyFrom, dcFamilyTo, dcFamilyStep]);
  const netlist = useMemo(() => generateNetlist(resolved, analysis, analysis.type === 'tran' ? opAmpsToKick(resolved) : undefined), [resolved, analysis]);

  const runSimulation = async () => {
    if (netlist.errors.length > 0) {
      setErrors(netlist.errors);
      return;
    }
    setErrors([]);
    setRunning(true);
    try {
      const labels = describeNodes(resolved, netlist.nodeOf);
      const seriesOf = (nodes: string[]) =>
        nodes
          .filter((node) => labels.has(node))
          .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
          .map((node) => ({ node, label: `${node} (${labels.get(node)})` }));
      if (analysis.type === 'dc') {
        const result = await simulateDc(netlist.text);
        const tagOf = (id: string | undefined) => circuit.elements.find((el) => el.id === id)?.tag ?? '?';
        const nodes: DcSeries[] = seriesOf([...result.voltages.keys()]).map((s) => ({ key: s.node, label: s.label, unit: 'V', curves: result.voltages.get(s.node)! }));
        const currents: DcSeries[] = [...result.currents].map(([name, curves]) => ({ key: name, label: `I(${name})`, unit: 'A', curves }));
        const familyValues = analysis.familySource ? Array.from({ length: sweepCount(analysis.familyFrom!, analysis.familyTo!, analysis.familyStep!) ?? 0 }, (_, k) => parseSpiceValue(analysis.familyFrom!)! + k * parseSpiceValue(analysis.familyStep!)!) : null;
        setRun({
          kind: 'dc',
          result,
          series: [...currents, ...nodes],
          xLabel: tagOf(analysis.source),
          family: familyValues && { name: tagOf(analysis.familySource), values: familyValues },
          netlist: netlist.text,
        });
      } else if (analysis.type === 'ac') {
        const result = await simulateAc(netlist.text);
        // A node with no signal at all, such as a DC supply, has no gain to draw
        const nodes = [...result.voltages].filter(([, v]) => hasSignal(v.re, v.im)).map(([node]) => node);
        setRun({ kind: 'ac', result, series: seriesOf(nodes), netlist: netlist.text });
      } else {
        const result = await simulate(netlist.text);
        setRun({ kind: 'tran', result, series: seriesOf([...result.voltages.keys()]), netlist: netlist.text });
      }
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
          <button onClick={() => openCircuit({ title: 'Circuito', elements: [], wires: [], models: [] })}>Nuovo</button>
          <button onClick={() => fileInputRef.current?.click()}>Apri</button>
          <button onClick={() => downloadCircuit(forSaving)}>Salva</button>
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
            Analisi
            <select className="analysis-kind" value={analysisKind} onChange={(e) => setAnalysisKind(e.target.value as 'tran' | 'ac' | 'dc')}>
              <option value="tran">Nel tempo</option>
              <option value="ac">In frequenza (AC)</option>
              <option value="dc">In continua (DC sweep)</option>
            </select>
          </label>
          {analysisKind === 'tran' ? (
            <>
              <label>
                Durata
                <input value={stop} onChange={(e) => setStop(e.target.value)} />
              </label>
              <label>
                Passo
                <input value={step} onChange={(e) => setStep(e.target.value)} />
              </label>
            </>
          ) : analysisKind === 'dc' ? (
            <>
              <label>
                Varia
                <select value={sweptId} onChange={(e) => setDcSource(e.target.value)}>
                  {generators.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.tag}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Da (V)
                <input value={dcFrom} onChange={(e) => setDcFrom(e.target.value)} />
              </label>
              <label>
                A (V)
                <input value={dcTo} onChange={(e) => setDcTo(e.target.value)} />
              </label>
              <label>
                Passo
                <input value={dcStep} onChange={(e) => setDcStep(e.target.value)} />
              </label>
              <label title="Una curva per ogni valore di un secondo generatore">
                Famiglia
                <select value={familyId} onChange={(e) => setDcFamilySource(e.target.value)}>
                  <option value="">Nessuna</option>
                  {generators
                    .filter((g) => g.id !== sweptId)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.tag}
                      </option>
                    ))}
                </select>
              </label>
              {familyId && (
                <>
                  <label>
                    Da (V)
                    <input value={dcFamilyFrom} onChange={(e) => setDcFamilyFrom(e.target.value)} />
                  </label>
                  <label>
                    A (V)
                    <input value={dcFamilyTo} onChange={(e) => setDcFamilyTo(e.target.value)} />
                  </label>
                  <label>
                    Passo
                    <input value={dcFamilyStep} onChange={(e) => setDcFamilyStep(e.target.value)} />
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <label>
                Da (Hz)
                <input value={acFrom} onChange={(e) => setAcFrom(e.target.value)} />
              </label>
              <label>
                A (Hz)
                <input value={acTo} onChange={(e) => setAcTo(e.target.value)} />
              </label>
            </>
          )}
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
            onMirrorSelected={mirrorSelected}
            onDeleteSelected={deleteSelected}
            layout={live.layout}
            frameRef={live.frameRef}
            library={library}
            onImportModels={importModels}
            onRemoveModel={removeModel}
            scopeIds={scopeIds}
            isScopeFull={traces.length >= MAX_TRACES}
            onToggleProbe={toggleProbe}
          />
        </aside>
      </div>

      {traces.length > 0 && (
        <ScopePanel
          traces={traces}
          labels={traceLabels}
          bufferRef={live.scopeRef}
          speed={speed}
          onRemove={(id) => setTraces(traces.filter((t) => t.id !== id))}
          onClose={() => setTraces([])}
        />
      )}

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
          {isStale && <p className="stale">Il circuito o l'analisi sono cambiati: il grafico mostra la simulazione precedente.</p>}
          {run?.kind === 'tran' && <TransientChart result={run.result} series={run.series} />}
          {run?.kind === 'ac' && <BodeChart key={run.netlist} result={run.result} series={run.series} />}
          {run?.kind === 'dc' && <DcSweepChart key={run.netlist} result={run.result} series={run.series} xLabel={run.xLabel} family={run.family} />}
        </section>
      )}
    </div>
  );
};
