import React from 'react';
import { ComponentDef } from '../model/types';
import { getDevice } from '../library/devices';
import { EXAMPLES } from '../samples/examples';
import { SchematicCanvas } from '../editor/SchematicCanvas';
import { ComponentLibrary } from '../ui/ComponentLibrary';
import { LiveLegend, SourceStats, SPEEDS } from '../ui/LiveControls';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import { MAX_TRACES } from '../ui/scopeTraces';
import { THEME_CHOICES } from '../ui/theme';
import { Workbench } from './useWorkbench';

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
  <label>
    Velocità
    <select value={wb.speed} onChange={(e) => wb.setSpeed(Number(e.target.value))}>
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

export const Library: React.FC<{ wb: Workbench; onChosen?: (def: ComponentDef | null) => void }> = ({ wb, onChosen }) => (
  <ComponentLibrary
    active={wb.activeDef}
    onChoose={(def) => {
      const next = wb.activeDef?.id === def.id ? null : def;
      wb.setActiveDef(next);
      wb.setSelectedIds(new Set());
      onChosen?.(next);
    }}
  />
);

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
      viewRef={wb.viewRef}
      overlay={wb.overlay}
      labels={wb.labels}
    />
    {wb.circuit.elements.length > 0 && <LiveLegend ref={wb.legendRef} errors={wb.live.errors} />}
    <SourceStats circuit={wb.circuit} selectedIds={wb.selectedIds} />
  </div>
);

export const Properties: React.FC<{ wb: Workbench }> = ({ wb }) => (
  <PropertiesPanel
    circuit={wb.circuit}
    selectedIds={wb.selectedIds}
    onChange={wb.handleChange}
    onRotateSelected={wb.rotateSelected}
    onMirrorSelected={wb.mirrorSelected}
    onSelectAll={wb.selectAll}
    onDeleteSelected={wb.deleteSelected}
    onCopy={wb.copySelected}
    onCut={wb.cutSelected}
    onDuplicate={wb.duplicateSelected}
    onPaste={wb.clipboard ? wb.paste : null}
    layout={wb.live.layout}
    frameRef={wb.live.frameRef}
    library={wb.library}
    onImportModels={wb.importModels}
    onRemoveModel={wb.removeModel}
    scopeIds={wb.scopeIds}
    isScopeFull={wb.traces.length >= MAX_TRACES}
    onToggleProbe={wb.toggleProbe}
  />
);
