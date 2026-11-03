import React from 'react';
import { downloadCircuit } from './storage/circuitFile';
import { SharePanel } from './ui/SharePanel';
import { Logo } from './ui/Logo';
import { ScopePanel } from './ui/ScopePanel';
import { AnalysisControls } from './ui/AnalysisControls';
import { ResultsView } from './ui/ResultsView';
import { CanvasArea, CircuitFileInput, ExamplesSelect, Library, Properties, SpeedSelect, ThemeSelect, ValuesToggle } from './workbench/parts';
import { Workbench } from './workbench/useWorkbench';

/** The full layout, for computers and tablets: everything in view at once. */
export const App: React.FC<{ wb: Workbench; onPhoneLayout: () => void }> = ({ wb, onPhoneLayout }) => (
  <div className="app">
    {wb.isSharing && <SharePanel circuit={wb.forSaving} onClose={() => wb.setIsSharing(false)} />}
    <header className="toolbar">
      <h1>
        <Logo />
      </h1>
      <div className="button-row">
        <button onClick={() => wb.openCircuit({ title: 'Circuito', elements: [], wires: [], models: [] })}>Nuovo</button>
        <button onClick={() => wb.fileInputRef.current?.click()}>Apri</button>
        <ExamplesSelect wb={wb} />
        <button className="primary" onClick={() => downloadCircuit(wb.forSaving)}>
          Salva
        </button>
        <button onClick={() => wb.setIsSharing(true)}>Condividi</button>
        <CircuitFileInput wb={wb} />
      </div>
      <div className="button-row">
        <button onClick={wb.undo} disabled={wb.history.length === 0}>
          Annulla
        </button>
        <button onClick={wb.redo} disabled={wb.redoStack.length === 0}>
          Ripeti
        </button>
        <ThemeSelect wb={wb} />
        <button className="layout-switch" onClick={onPhoneLayout} title="L'interfaccia pensata per gli schermi piccoli">
          Vista telefono
        </button>
      </div>
      <div className="button-row live-controls">
        <button onClick={() => wb.setLiveRunning((r) => !r)}>{wb.liveRunning ? 'Pausa' : 'Avvia'}</button>
        <SpeedSelect wb={wb} />
        <ValuesToggle wb={wb} />
      </div>
      <AnalysisControls wb={wb} />
    </header>

    <div className="workspace">
      <Library wb={wb} />
      <CanvasArea wb={wb} />
      <aside className="side-panel">
        <Properties wb={wb} />
      </aside>
    </div>

    {wb.traces.length > 0 && (
      <ScopePanel
        traces={wb.traces}
        labels={wb.traceLabels}
        bufferRef={wb.live.scopeRef}
        speed={wb.speed}
        onRemove={(id) => wb.setTraces(wb.traces.filter((t) => t.id !== id))}
        onClose={() => wb.setTraces([])}
      />
    )}

    {(wb.errors.length > 0 || wb.run) && (
      <section className="results">
        <button className="close-results" aria-label="Chiudi risultati" title="Chiudi" onClick={wb.closeResults}>
          ×
        </button>
        <ResultsView wb={wb} />
      </section>
    )}
  </div>
);
