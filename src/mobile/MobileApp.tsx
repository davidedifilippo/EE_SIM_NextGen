import React, { useEffect, useRef, useState } from 'react';
import { AnalysisControls } from '../ui/AnalysisControls';
import { Logo } from '../ui/Logo';
import { ResultsView } from '../ui/ResultsView';
import { ScopePanel } from '../ui/ScopePanel';
import { SharePanel } from '../ui/SharePanel';
import { CanvasArea, CircuitFileInput, EditButtons, Library, Properties } from '../workbench/parts';
import { Workbench } from '../workbench/useWorkbench';
import { LONG_PRESS_MS } from '../editor/SchematicCanvas';
import { BottomSheet } from './BottomSheet';
import { MobileMenu } from './MobileMenu';
import './mobile.css';

type Sheet = 'library' | 'properties' | 'analysis' | 'results';

const TABS: { sheet: Sheet; label: string }[] = [
  { sheet: 'library', label: 'Componenti' },
  { sheet: 'properties', label: 'Proprietà' },
  { sheet: 'analysis', label: 'Analisi' },
  { sheet: 'results', label: 'Risultati' },
];

/** Screen pixels a finger may move and still count as a tap. */
const TAP_SLOP = 8;

const isLandscape = () => window.matchMedia('(orientation: landscape)').matches;

/** The layout for phones: the schematic on the whole screen, everything else in panels taken one at a time. */
export const MobileApp: React.FC<{ wb: Workbench; onFullLayout: () => void }> = ({ wb, onFullLayout }) => {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [landscape, setLandscape] = useState(isLandscape);
  const toggle = (next: Sheet) => setSheet((open) => (open === next ? null : next));

  useEffect(() => {
    const onResize = () => setLandscape(isLandscape());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A finished analysis shows its results, and so does an error
  const runRef = useRef(wb.run);
  const errorsRef = useRef(wb.errors);
  useEffect(() => {
    if ((wb.run && wb.run !== runRef.current) || (wb.errors.length > 0 && wb.errors !== errorsRef.current)) setSheet('results');
    runRef.current = wb.run;
    errorsRef.current = wb.errors;
  }, [wb.run, wb.errors]);

  // A tap that selects a part opens its properties; one that clears the selection closes them.
  // A drag never does: the panel would cover what the finger is moving
  const selectionRef = useRef(wb.selectedIds);
  selectionRef.current = wb.selectedIds;
  const circuitRef = useRef(wb.circuit);
  circuitRef.current = wb.circuit;
  const pressRef = useRef<{ x: number; y: number; at: number; ids: Set<string> } | null>(null);
  const onCanvasDown = (e: React.PointerEvent) => {
    pressRef.current = { x: e.clientX, y: e.clientY, at: performance.now(), ids: wb.selectedIds };
  };
  const onCanvasUp = (e: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) return;
    // A finger held still opened the menu of the part instead: the panel stays as it was
    if (performance.now() - press.at >= LONG_PRESS_MS) return;
    // After the canvas has handled the same release
    setTimeout(() => {
      const ids = selectionRef.current;
      const hasChanged = ids.size !== press.ids.size || [...ids].some((id) => !press.ids.has(id));
      if (!hasChanged) return;
      // A wire just drawn is selected too, ready to drag: only a part brings up the panel
      const hasPart = circuitRef.current.elements.some((el) => ids.has(el.id));
      if (hasPart) setSheet((open) => (open === null || open === 'properties' ? 'properties' : open));
      else setSheet((open) => (open === 'properties' ? null : open));
    }, 0);
  };

  const hasResults = wb.run !== null || wb.errors.length > 0 || wb.traces.length > 0;

  return (
    <div className="mobile-app">
      {wb.isSharing && <SharePanel circuit={wb.forSaving} onClose={() => wb.setIsSharing(false)} />}
      {isMenuOpen && <MobileMenu wb={wb} onFullLayout={onFullLayout} onClose={() => setIsMenuOpen(false)} />}
      <CircuitFileInput wb={wb} />
      <header className="mobile-bar">
        <Logo />
        <button className="icon" aria-label={wb.liveRunning ? 'Ferma l’animazione' : 'Avvia l’animazione'} onClick={() => wb.setLiveRunning((r) => !r)}>
          {wb.liveRunning ? '⏸' : '▶'}
        </button>
        <EditButtons wb={wb} />
        <button className="icon" aria-label="Menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(true)}>
          ⋮
        </button>
      </header>

      <div className="mobile-canvas" onPointerDownCapture={onCanvasDown} onPointerUpCapture={onCanvasUp}>
        <CanvasArea wb={wb} />
        {sheet === 'library' && (
          <BottomSheet title="Componenti" onClose={() => setSheet(null)}>
            <Library wb={wb} onChosen={(def) => def && setSheet(null)} />
          </BottomSheet>
        )}
        {sheet === 'properties' && (
          <BottomSheet title="Proprietà" onClose={() => setSheet(null)}>
            <Properties wb={wb} />
          </BottomSheet>
        )}
        {sheet === 'analysis' && (
          <BottomSheet title="Analisi" onClose={() => setSheet(null)}>
            <AnalysisControls wb={wb} className="analysis mobile-analysis" />
          </BottomSheet>
        )}
        {sheet === 'results' && (
          <BottomSheet title="Risultati" isFull={landscape} onClose={() => setSheet(null)}>
            {!hasResults && <p className="hint">Esegui un'Analisi precisa, oppure aggiungi una traccia all'oscilloscopio dalle Proprietà di un componente.</p>}
            {wb.traces.length > 0 && (
              <ScopePanel
                traces={wb.traces}
                labels={wb.traceLabels}
                bufferRef={wb.live.scopeRef}
                speed={wb.speed}
                signalPeriod={wb.signalPeriod}
                onRemove={(id) => wb.setTraces(wb.traces.filter((t) => t.id !== id))}
                onClose={() => wb.setTraces([])}
              />
            )}
            {(wb.run || wb.errors.length > 0) && (
              <div className="results mobile-results">
                <ResultsView wb={wb} />
              </div>
            )}
          </BottomSheet>
        )}
      </div>

      <nav className="mobile-tabs">
        {TABS.map(({ sheet: tab, label }) => (
          <button key={tab} className={sheet === tab ? 'active' : ''} aria-pressed={sheet === tab} onClick={() => toggle(tab)}>
            {label}
            {tab === 'results' && hasResults && sheet !== 'results' && <span className="tab-dot" aria-label="ci sono risultati" />}
          </button>
        ))}
      </nav>
    </div>
  );
};
