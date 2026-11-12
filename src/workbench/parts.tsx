import React, { lazy, Suspense, useMemo } from 'react';
import { HAS_BREADBOARD } from '../edition';
import { ComponentDef } from '../model/types';
import { canRotate, getDevice } from '../library/devices';
import { EXAMPLES } from '../samples/examples';
import { SchematicCanvas } from '../editor/SchematicCanvas';
import { ComponentLibrary } from '../ui/ComponentLibrary';
import { LiveLegend, SourceStats, SPEEDS } from '../ui/LiveControls';
import { speedLabel } from '../realtime/liveRate';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import { BlockDialog } from '../ui/BlockDialog';
import { MAX_TRACES } from '../ui/scopeTraces';
import { THEME_CHOICES } from '../ui/theme';
import { Workbench } from './useWorkbench';

/** Fetched when the view is first opened, and only in the edition that has it. */
const BreadboardCanvas = HAS_BREADBOARD ? lazy(() => import('../ui/BreadboardCanvas').then((m) => ({ default: m.BreadboardCanvas }))) : null;

/** Undo, redo and rotate, side by side under the thumb: the same three on every screen. */
export const EditButtons: React.FC<{ wb: Workbench }> = ({ wb }) => {
  const canTurn = wb.circuit.elements.some((el) => wb.selectedIds.has(el.id) && canRotate(getDevice(el.def)));
  return (
    <div className="edit-buttons" role="group" aria-label="Modifica">
      <button className="icon" aria-label="Annulla" title="Annulla" onClick={wb.undo} disabled={wb.history.length === 0}>
        ↶
      </button>
      <button className="icon" aria-label="Ripeti" title="Ripeti" onClick={wb.redo} disabled={wb.redoStack.length === 0}>
        ↷
      </button>
      <button className="icon" aria-label="Ruota la selezione" title="Ruota la selezione (R)" onClick={wb.rotateSelected} disabled={!canTurn}>
        ⟳
      </button>
    </div>
  );
};

/** The hidden field behind Apri. */
export const CircuitFileInput: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <input
    ref={wb.fileInputRef}
    type="file"
    accept=".json,application/json"
    hidden
    aria-label="Apri un circuito"
    onChange={(e) => {
      const file = e.target.files?.[0];
      // Cleared so that choosing the same file again still counts as a change
      e.target.value = '';
      if (file) wb.openFile(file);
    }}
  />
);

export const ExamplesSelect: React.FC<{ wb: Workbench; onOpened?: () => void }> = ({ wb, onOpened }) => (
  <select
    className="examples"
    aria-label="Apri un esempio"
    value=""
    onChange={(e) => {
      wb.openExample(e.target.value);
      onOpened?.();
    }}
  >
    <option value="" disabled>
      Esempi…
    </option>
    {EXAMPLES.map(({ id, title }) => (
      <option key={id} value={id}>
        {title}
      </option>
    ))}
  </select>
);

export const ThemeSelect: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <label>
    Tema
    <select value={wb.theme} onChange={(e) => wb.setTheme(e.target.value as typeof wb.theme)}>
      {THEME_CHOICES.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  </label>
);

export const SpeedSelect: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <label title="Tempo simulato per ogni secondo reale. Automatica rallenta per i segnali veloci, così l'oscilloscopio li disegna bene">
    Velocità
    <select value={String(wb.speedChoice)} onChange={(e) => wb.setSpeedChoice(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
      <option value="auto">Automatica ({speedLabel(wb.speed)})</option>
      {SPEEDS.map((s) => (
        <option key={s.label} value={s.simSecondsPerSecond}>
          {s.label}
        </option>
      ))}
    </select>
  </label>
);

export const ValuesToggle: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <label className="values-toggle" title="Tensioni e correnti sullo schema, quando tutti i generatori sono in continua">
    <input type="checkbox" checked={wb.showValues} disabled={!wb.isDc} onChange={(e) => wb.setShowValues(e.target.checked)} />
    Valori
  </label>
);

export const Library: React.FC<{ wb: Workbench; onChosen?: (def: ComponentDef | null) => void }> = ({ wb, onChosen }) => {
  // Those of the library, then those only the circuit has
  const blocks = useMemo(() => {
    const ids = [...new Set([...wb.blockLibrary, ...(wb.circuit.blocks ?? [])].map((b) => b.id))];
    return ids.flatMap((id) => getDevice(id) ?? []);
  }, [wb.blockLibrary, wb.circuit.blocks]);
  const removable = useMemo(() => new Set(wb.blockLibrary.map((b) => b.id)), [wb.blockLibrary]);
  return (
  <ComponentLibrary
    blocks={blocks}
    removableBlocks={removable}
    onRemoveBlock={wb.removeBlock}
    onImportBlock={wb.importBlockFile}
    active={wb.activeDef}
    onChoose={(def) => {
      const next = wb.activeDef?.id === def.id ? null : def;
      wb.setActiveDef(next);
      wb.setSelectedIds(new Set());
      onChosen?.(next);
    }}
  />
  );
};

/** The schematic with what is written over it: the hint of an example, notes, the legend of the animation. */
export const CanvasArea: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <div className="canvas-area">
    {wb.exampleHint && (
      <p className="example-hint">
        {wb.exampleHint}
        <button aria-label="Chiudi il suggerimento" onClick={() => wb.setExampleHint(null)}>
          ×
        </button>
      </p>
    )}
    {wb.resolved.elements.some((el) => (el.def === 'opamp' || getDevice(el.def)?.spice.kind === 'regulator') && el.props.model) && <p className="live-note">Animazione con il comportamento semplice: i modelli importati valgono per l'Analisi precisa</p>}
    {BreadboardCanvas && wb.view === 'breadboard' ? (
      <Suspense fallback={null}>
      <BreadboardCanvas
        key={`bb${wb.documentId}`}
        circuit={wb.circuit}
        onChange={wb.handleChange}
        selectedIds={wb.selectedIds}
        onSelectIds={wb.setSelectedIds}
        activeDefToPlace={wb.activeDef}
        onPlacedDef={() => wb.setActiveDef(null)}
        onRotateSelected={wb.rotateSelected}
        onDeleteSelected={wb.deleteSelected}
        layout={wb.live.layout}
        frameRef={wb.live.frameRef}
      />
      </Suspense>
    ) : (
    <SchematicCanvas
      key={wb.documentId}
      circuit={wb.circuit}
      onChange={wb.handleChange}
      selectedIds={wb.selectedIds}
      onSelectIds={wb.setSelectedIds}
      activeDefToPlace={wb.activeDef}
      onPlacedDef={() => wb.setActiveDef(null)}
      onDeleteSelected={wb.deleteSelected}
      onRotateSelected={wb.rotateSelected}
      onMirrorSelected={wb.mirrorSelected}
      onSelectAll={wb.selectAll}
      onCopy={wb.copySelected}
      onCut={wb.cutSelected}
      onDuplicate={wb.duplicateSelected}
      onPaste={wb.clipboard ? wb.paste : null}
      onMakeBlock={wb.startBlockFromSelection}
      viewRef={wb.viewRef}
      overlay={wb.overlay}
      labels={wb.labels}
    />
    )}
    {wb.circuit.elements.length > 0 && wb.view === 'schematic' && <LiveLegend ref={wb.legendRef} errors={wb.live.errors} />}
    {wb.blockDraft && <BlockDialog pins={wb.blockDraft.pins} error={wb.blockDraft.error} onCreate={wb.createBlockFromSelection} onClose={() => wb.setBlockDraft(null)} />}
    <SourceStats circuit={wb.circuit} selectedIds={wb.selectedIds} />
  </div>
);

export const Properties: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <PropertiesPanel
    circuit={wb.circuit}
    selectedIds={wb.selectedIds}
    onChange={wb.handleChange}
    onMirrorSelected={wb.mirrorSelected}
    onSelectAll={wb.selectAll}
    onDeleteSelected={wb.deleteSelected}
    onPaste={wb.clipboard ? wb.paste : null}
    layout={wb.live.layout}
    frameRef={wb.live.frameRef}
    library={wb.library}
    onImportModels={wb.importModels}
    onRemoveModel={wb.removeModel}
    scopeIds={wb.scopeIds}
    isScopeFull={wb.traces.length >= MAX_TRACES}
    onToggleProbe={wb.toggleProbe}
    onOpenBlock={wb.openBlockAsCircuit}
  />
);

/** Schematic or breadboard: two drawings of the same circuit. */
export const ViewSwitch: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <div className="view-switch" role="group" aria-label="Vista">
    <button aria-pressed={wb.view === 'schematic'} className={wb.view === 'schematic' ? 'active' : ''} onClick={() => wb.setView('schematic')}>
      Schema
    </button>
    <button aria-pressed={wb.view === 'breadboard'} className={wb.view === 'breadboard' ? 'active' : ''} onClick={() => wb.setView('breadboard')}>
      Breadboard
    </button>
  </div>
);
