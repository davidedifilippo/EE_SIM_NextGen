import React from 'react';
import { Circuit, Element, SpiceModel } from '../model/types';
import { getDevice } from '../library/devices';
import { ImportedModel } from '../library/modelImport';
import { modelsOfType } from '../library/models';
import { drawingSign, LiveFrame, LiveLayout, ScopeProbe } from '../realtime/liveSimulation';
import { LiveReadout } from './LiveControls';
import { ModelImporter } from './ModelImporter';
import { elementProbes, nodeWire, wireProbe } from './scopeTraces';
import { SourceInspector } from './SourceInspector';
import { ValueSlider } from './ValueSlider';

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  onChange: (next: Circuit, record?: boolean) => void;
  onRotateSelected: () => void;
  onDeleteSelected: () => void;
  layout: LiveLayout | null;
  frameRef: React.MutableRefObject<LiveFrame | null>;
  library: SpiceModel[];
  onImportModels: (models: ImportedModel[]) => boolean;
  onRemoveModel: (name: string) => void;
  scopeIds: Set<string>;
  isScopeFull: boolean;
  onToggleProbe: (probe: ScopeProbe) => void;
}

export const PropertiesPanel: React.FC<Props> = ({ circuit, selectedIds, onChange, onRotateSelected, onDeleteSelected, layout, frameRef, library, onImportModels, onRemoveModel, scopeIds, isScopeFull, onToggleProbe }) => {
  if (selectedIds.size === 0) {
    return <p className="hint">Seleziona un componente per modificarne i valori. Per collegare, parti da un terminale.</p>;
  }

  const selected = circuit.elements.filter((el) => selectedIds.has(el.id));
  const single = selectedIds.size === 1 && selected.length === 1 ? selected[0] : null;
  const def = single ? getDevice(single.def) : null;
  const singleWire = selectedIds.size === 1 && !single ? circuit.wires.find((w) => selectedIds.has(w.id)) : undefined;
  const probeChoices = single ? elementProbes(single) : singleWire ? [wireProbe(nodeWire(singleWire.id, circuit))] : [];
  const deviceIndex = single && layout ? layout.devices.findIndex((d) => d.elementId === single.id) : -1;

  const update = (patch: Partial<Element>, record = true) => {
    if (!single) return;
    onChange({ ...circuit, elements: circuit.elements.map((el) => (el.id === single.id ? { ...el, ...patch } : el)) }, record);
  };

  return (
    <div className="properties">
      <strong>{def ? def.name : singleWire ? 'Filo' : `${selectedIds.size} oggetti selezionati`}</strong>
      {deviceIndex >= 0 && (
        <LiveReadout deviceIndex={deviceIndex} sign={single ? drawingSign(single) : 1} transistorFirstDot={def?.spice.kind === 'bjt' ? layout!.devices[deviceIndex].firstDot : null} frameRef={frameRef} />
      )}
      {single && def?.id === 'vsource' && <SourceInspector props={single.props} onChange={(props, record) => update({ props }, record)} />}
      {single &&
        def?.id !== 'vsource' &&
        def?.props.map((p) => {
          const value = String(single.props[p.key] ?? '');
          const setValue = (next: string, record = true) => update({ props: { ...single.props, [p.key]: next } }, record);
          const addModels = (models: ImportedModel[]) => {
            const isKept = onImportModels(models);
            // The part takes a model imported for it; out of a whole library, the choice is the user's
            const fitting = models.filter((m) => m.type === p.modelType);
            const usable = fitting.length === 1 ? fitting[0] : undefined;
            // A copy the circuit already has must follow, or the new version would never be used
            const imported = new Map(models.map((m) => [m.name, m.card]));
            const hasOwnCopy = circuit.models.some((m) => imported.has(m.name));
            if (usable || hasOwnCopy) {
              onChange({
                ...circuit,
                models: circuit.models.map((m) => ({ name: m.name, card: imported.get(m.name) ?? m.card })),
                elements: circuit.elements.map((el) => (el.id === single.id && usable ? { ...el, props: { ...el.props, [p.key]: usable.name } } : el)),
              });
            }
            return isKept;
          };
          return (
            <React.Fragment key={p.key}>
              <label>
                {p.label}
                {p.type === 'model' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {modelsOfType(circuit, p.modelType ?? 'D', library).map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value)} />
                )}
                {def.spice.kind === 'passive' && <ValueSlider value={value} label={p.label} onChange={setValue} />}
              </label>
              {p.type === 'model' && <ModelImporter library={library} onImport={addModels} onRemove={onRemoveModel} />}
            </React.Fragment>
          );
        })}
      {single && def?.tagPrefix && (
        <label>
          Nome
          <input value={single.tag} onChange={(e) => update({ tag: e.target.value })} />
        </label>
      )}
      {probeChoices.length > 0 && (
        <div className="scope-buttons">
          <span id="scope-buttons-label">All'oscilloscopio</span>
          <div role="group" aria-labelledby="scope-buttons-label">
            {probeChoices.map(({ label, probe }) => {
              const isActive = scopeIds.has(probe.id);
              return (
                <button key={probe.id} className={isActive ? 'active' : ''} aria-pressed={isActive} disabled={!isActive && isScopeFull} onClick={() => onToggleProbe(probe)}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="button-row">
        {selected.length > 0 && <button onClick={onRotateSelected}>Ruota</button>}
        <button className="danger" onClick={onDeleteSelected}>
          Elimina
        </button>
      </div>
    </div>
  );
};
