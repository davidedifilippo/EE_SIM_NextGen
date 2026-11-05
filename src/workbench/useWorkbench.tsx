import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circuit, ComponentDef, Pt, Rotation, SpiceModel } from '../model/types';
import { canMirror, canRotate, getDevice, isVoltageSource } from '../library/devices';
import { circuitForSaving, withLibraryModels } from '../library/models';
import { Analysis, describeNodes, generateNetlist, sweepCount } from '../netlist/generate';
import { parseSpiceValue } from '../netlist/values';
import { isDcSource } from '../netlist/source';
import { halfWaveRectifier } from '../samples/halfWaveRectifier';
import { emptyCircuit, EXAMPLES } from '../samples/examples';
import { circuitFromFragment, isCircuitFragment } from '../storage/shareLink';
import { clearOfCircuit, Clip, copySelection, moveInView, moveToCenter, PASTE_STEP, pasteClipboard } from '../editor/clipboard';
import { Box } from '../utils/geometry';
import { libraryAtStart, mergeModels, saveLibrary } from '../storage/modelLibrary';
import { downloadCircuit, INVALID_FILE, loadAutosave, MAX_FILE_BYTES, parseCircuitFile, saveAutosave } from '../storage/circuitFile';
import { Series } from '../ui/TransientChart';
import { AcResult, DcResult, TranResult } from '../engine/ngspice';
import { preloadEngine, simulate, simulateAc, simulateDc } from '../engine/ngspiceClient';
import { LiveFrame, opAmpsToKick, ScopeProbe } from '../realtime/liveSimulation';
import { AcSeries } from '../ui/BodeChart';
import { hasSignal } from '../ui/bode';
import { DcFamily, DcSeries } from '../ui/DcSweepChart';
import { DcValues } from '../ui/DcValues';
import { LiveOverlay } from '../ui/LiveOverlay';
import { useTheme } from '../ui/theme';
import { MeterReadings } from '../ui/MeterReadings';
import { RegulatorStatus } from '../ui/RegulatorStatus';
import { MotorView } from '../ui/MotorView';
import { RelayView } from '../ui/RelayView';
import { LedGlow, LogicLevels, SegmentGlow } from '../ui/LogicView';
import { regulatorSummaries, RegulatorSummary } from '../ui/regulatorPower';
import { LiveLegendHandle } from '../ui/LiveControls';
import { liveTraces, nextSlot, ScopeTrace, traceLabel } from '../ui/scopeTraces';
import { useLiveSimulation } from '../ui/useLiveSimulation';
import { automaticSpeed, fastestPeriod } from '../realtime/liveRate';

export type Run =
  | { kind: 'tran'; result: TranResult; series: Series[]; regulators: RegulatorSummary[]; netlist: string }
  | { kind: 'ac'; result: AcResult; series: AcSeries[]; netlist: string }
  | { kind: 'dc'; result: DcResult; series: DcSeries[]; xLabel: string; family: DcFamily | null; netlist: string };

/** Enough for a smooth curve and a cutoff read to three figures, without weighing on the chart. */
const AC_POINTS_PER_DECADE = 100;

const ENGINE_PRELOAD_DELAY_MS = 2000;
const AUTOSAVE_DELAY_MS = 300;


/** Everything both layouts share: the circuit and its history, the engines, the analysis and its results. */
export function useWorkbench() {
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
  /** Outlives the circuit, to paste into another one. `pastes` says how far the next copy lands. */
  const [clipboard, setClipboard] = useState<{ clip: Clip; pastes: number } | null>(null);
  /** What part of the sheet the canvas shows now. */
  const viewRef = useRef<(() => Box) | null>(null);
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
  /** A speed of the list, or 'auto' to follow the fastest generator. */
  const [speedChoice, setSpeedChoice] = useState<number | 'auto'>('auto');
  const [showValues, setShowValues] = useState(true);
  /** What to look at in the example just opened. */
  const [exampleHint, setExampleHint] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [theme, setTheme] = useTheme();

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

  const signalPeriod = useMemo(() => fastestPeriod(resolved), [resolved]);
  const speed = speedChoice === 'auto' ? automaticSpeed(signalPeriod) : speedChoice;
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
    const sources = circuit.elements.filter(isVoltageSource);
    const hasCurrentSource = circuit.elements.some((el) => getDevice(el.def)?.spice.kind === 'isource');
    return (sources.length > 0 || hasCurrentSource) && sources.every((el) => isDcSource(el.props));
  }, [circuit]);
  const hasMeter = useMemo(() => resolved.elements.some((el) => getDevice(el.def)?.spice.kind === 'meter'), [resolved]);
  const hasRegulator = useMemo(() => resolved.elements.some((el) => getDevice(el.def)?.spice.kind === 'regulator'), [resolved]);
  const hasLogic = useMemo(() => resolved.elements.some((el) => getDevice(el.def)?.spice.kind === 'logic'), [resolved]);
  const hasLed = useMemo(() => resolved.elements.some((el) => el.def === 'led'), [resolved]);
  const hasMotor = useMemo(() => resolved.elements.some((el) => getDevice(el.def)?.spice.kind === 'motor'), [resolved]);
  const hasRelay = useMemo(() => resolved.elements.some((el) => getDevice(el.def)?.spice.kind === 'relay'), [resolved]);
  const hasDisplay = useMemo(() => resolved.elements.some((el) => el.def === 'display7'), [resolved]);
  const labels = useMemo(
    () =>
      live.errors.length === 0 &&
      live.layout && (
        <>
          {showValues && isDc && <DcValues circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasMeter && <MeterReadings circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasRegulator && <RegulatorStatus circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasMotor && <MotorView circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasRelay && <RelayView circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasLed && <LedGlow circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasDisplay && <SegmentGlow circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
          {hasLogic && <LogicLevels circuit={resolved} layout={live.layout} frameRef={live.frameRef} />}
        </>
      ),
    [showValues, isDc, hasMeter, hasRegulator, hasMotor, hasRelay, hasLed, hasDisplay, hasLogic, live.errors.length, resolved, live.layout, live.frameRef],
  );

  const latestCircuitForKeys = useRef(circuit);
  latestCircuitForKeys.current = circuit;

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
    setExampleHint(null);
  };

  const newCircuit = () => openCircuit(emptyCircuit());

  const openExample = (id: string) => {
    const example = EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    openCircuit(example.build());
    setExampleHint(example.hint);
  };

  // A link opens its circuit in place of the one on screen, which Annulla brings back. The address
  // then loses the circuit, so that reloading the page does not open it again over later changes
  const openCircuitRef = useRef(openCircuit);
  openCircuitRef.current = openCircuit;
  useEffect(() => {
    const openLink = async () => {
      if (!isCircuitFragment(location.hash)) return;
      const hash = location.hash;
      window.history.replaceState(null, '', location.pathname + location.search);
      try {
        openCircuitRef.current(await circuitFromFragment(hash));
      } catch (err) {
        setErrors([`Link non valido. ${err instanceof Error ? err.message : String(err)}`]);
      }
    };
    openLink();
    window.addEventListener('hashchange', openLink);
    return () => window.removeEventListener('hashchange', openLink);
  }, []);

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

  // What was just pasted or placed may not be there any more
  const keepSelectionIn = (target: Circuit) => {
    const ids = new Set([...target.elements, ...target.wires].map((item) => item.id));
    setSelectedIds((selected) => new Set([...selected].filter((id) => ids.has(id))));
  };

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const target = history[history.length - 1];
    refitIfOtherCircuit(target);
    keepSelectionIn(target);
    setRedoStack((r) => [circuit, ...r]);
    setCircuit(target);
    setHistory((h) => h.slice(0, -1));
  }, [history, circuit, refitIfOtherCircuit]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    refitIfOtherCircuit(redoStack[0]);
    keepSelectionIn(redoStack[0]);
    setHistory((h) => [...h, circuit]);
    setCircuit(redoStack[0]);
    setRedoStack((r) => r.slice(1));
  }, [redoStack, circuit, refitIfOtherCircuit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set([...latestCircuitForKeys.current.elements, ...latestCircuitForKeys.current.wires].map((item) => item.id)));
      }
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

  const selectAll = useCallback(() => setSelectedIds(new Set([...circuit.elements, ...circuit.wires].map((item) => item.id))), [circuit]);

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
        selectedIds.has(el.id) && canRotate(getDevice(el.def)) ? { ...el, rot: ((el.rot + 90) % 360) as Rotation } : el,
      ),
    });
  }, [circuit, selectedIds, handleChange]);

  const pasteClip = useCallback(
    (clip: Clip, move: Pt) => {
      const available = { ...resolved, models: [...resolved.models, ...library] };
      const pasted = pasteClipboard(circuit, available, clip, move, Date.now());
      handleChange(pasted.circuit);
      setSelectedIds(pasted.ids);
      setActiveDef(null);
      if (pasted.conflicts.length > 0) setErrors(pasted.conflicts.map((name) => `Il circuito ha già un modello "${name}" diverso da quello copiato: resta il suo`));
    },
    [circuit, resolved, library, handleChange],
  );

  const copySelected = useCallback(() => {
    const clip = copySelection(resolved, selectedIds);
    if (clip) setClipboard({ clip, pastes: 1 });
  }, [resolved, selectedIds]);

  // The first paste after a cut goes back where the parts were, connected as before
  const cutSelected = useCallback(() => {
    const clip = copySelection(resolved, selectedIds);
    if (!clip) return;
    setClipboard({ clip, pastes: 0 });
    deleteSelected();
  }, [resolved, selectedIds, deleteSelected]);

  /** On a point of the sheet, or else a step further than the last copy. */
  const paste = useCallback(
    (at?: Pt) => {
      if (!clipboard) return;
      if (at) {
        pasteClip(clipboard.clip, clearOfCircuit(circuit, clipboard.clip, moveToCenter(clipboard.clip, at)));
        return;
      }
      const reach = clipboard.pastes * PASTE_STEP;
      const move = { x: reach, y: reach };
      const inView = viewRef.current ? moveInView(clipboard.clip, move, viewRef.current()) : move;
      pasteClip(clipboard.clip, reach === 0 ? inView : clearOfCircuit(circuit, clipboard.clip, inView));
      setClipboard({ ...clipboard, pastes: clipboard.pastes + 1 });
    },
    [circuit, clipboard, pasteClip],
  );

  // Does not touch what was copied before
  const duplicateSelected = useCallback(() => {
    const clip = copySelection(resolved, selectedIds);
    if (clip) pasteClip(clip, clearOfCircuit(circuit, clip, { x: PASTE_STEP, y: PASTE_STEP }));
  }, [circuit, resolved, selectedIds, pasteClip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      // Text chosen in the results is for the browser to copy
      if ((key === 'c' || key === 'x') && !window.getSelection()?.isCollapsed) return;
      const action = { c: copySelected, x: cutSelected, v: () => paste(), d: duplicateSelected }[key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySelected, cutSelected, paste, duplicateSelected]);

  const generators = useMemo(() => circuit.elements.filter(isVoltageSource), [circuit]);
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
        setRun({ kind: 'tran', result, series: seriesOf([...result.voltages.keys()]), regulators: regulatorSummaries(resolved, netlist.nodeOf, result), netlist: netlist.text });
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setRunning(false);
    }
  };


  const isStale = run !== null && run.netlist !== netlist.text;

  const closeResults = () => {
    setRun(null);
    setErrors([]);
  };

  /** The title becomes the name of the file; changing it is not an edit to undo. */
  const saveAs = (title: string) => {
    handleChange({ ...circuit, title }, false);
    downloadCircuit({ ...forSaving, title });
  };

  return { isSharing, setIsSharing, isSaving, setIsSaving, saveAs, forSaving, openCircuit, newCircuit, fileInputRef, openExample, openFile, undo, redo, history, redoStack, theme, setTheme, liveRunning, setLiveRunning, speed, speedChoice, setSpeedChoice, signalPeriod, showValues, setShowValues, isDc, analysisKind, setAnalysisKind, stop, setStop, step, setStep, sweptId, setDcSource, generators, dcFrom, setDcFrom, dcTo, setDcTo, dcStep, setDcStep, familyId, setDcFamilySource, dcFamilyFrom, setDcFamilyFrom, dcFamilyTo, setDcFamilyTo, dcFamilyStep, setDcFamilyStep, acFrom, setAcFrom, acTo, setAcTo, runSimulation, running, activeDef, setActiveDef, selectedIds, setSelectedIds, exampleHint, setExampleHint, resolved, documentId, circuit, handleChange, deleteSelected, rotateSelected, mirrorSelected, selectAll, copySelected, cutSelected, duplicateSelected, clipboard, paste, viewRef, overlay, labels, legendRef, live, library, importModels, removeModel, scopeIds, traces, setTraces, toggleProbe, traceLabels, errors, setErrors, run, setRun, isStale, closeResults };
}

export type Workbench = ReturnType<typeof useWorkbench>;
