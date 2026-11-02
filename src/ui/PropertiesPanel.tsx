import React from 'react';
import { Circuit, Element, SpiceModel } from '../model/types';
import { blockId, canMirror, getDevice } from '../library/devices';
import { ImportedModel } from '../library/modelImport';
import { fitsModelType, modelsOfType } from '../library/models';
import { OPAMP_ROLES, OpAmpRole, readOpAmpRoles, readRegulatorRoles, REGULATOR_ROLES, RegulatorRole, subcircuitPins } from '../library/subcircuit';
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
  onMirrorSelected: () => void;
  onSelectAll: () => void;
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

const OPAMP_LABELS: Record<OpAmpRole, string> = { plus: 'Ingresso +', minus: 'Ingresso −', high: 'Alimentazione +', low: 'Alimentazione −', out: 'Uscita' };
const REGULATOR_LABELS: Record<RegulatorRole, string> = { in: 'Ingresso', ref: 'Massa o ADJ', out: 'Uscita' };

/** Which pin of a manufacturer's model does what. Names rarely tell, and the order is only a habit. */
function ModelPins<Role extends string>({ pins, roles, allRoles, labels, onChange }: { pins: string[]; roles: Role[]; allRoles: Role[]; labels: Record<Role, string>; onChange: (next: string) => void }) {
  // Giving a pin the role of another swaps them, so that each role always stays on one pin
  const assign = (index: number, role: Role) => onChange(roles.map((r, k) => (k === index ? role : r === role ? roles[index] : r)).join(' '));
  return (
    <details className="model-library">
      <summary>Piedini del modello</summary>
      {pins.map((pin, k) => (
        <label key={pin}>
          {pin}
          <select value={roles[k]} onChange={(e) => assign(k, e.target.value as Role)}>
            {allRoles.map((role) => (
              <option key={role} value={role}>
                {labels[role]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </details>
  );
}

export const PropertiesPanel: React.FC<Props> = ({ circuit, selectedIds, onChange, onRotateSelected, onMirrorSelected, onSelectAll, onDeleteSelected, layout, frameRef, library, onImportModels, onRemoveModel, scopeIds, isScopeFull, onToggleProbe }) => {
  if (selectedIds.size === 0) {
    return (
      <div className="properties">
        <p className="hint">Seleziona un componente per modificarne i valori. Per collegare, parti da un terminale. Per un'area, tieni fermo un dito sul foglio e poi trascina, oppure trascina con il mouse.</p>
        {circuit.elements.length + circuit.wires.length > 0 && <button onClick={onSelectAll}>Seleziona tutto</button>}
      </div>
    );
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
        <LiveReadout deviceIndex={deviceIndex} sign={single ? drawingSign(single) : 1} transistorFirstDot={def?.spice.kind === 'bjt' || def?.spice.kind === 'mos' ? layout!.devices[deviceIndex].firstDot : null} isMos={def?.spice.kind === 'mos'} windingsFirstDot={def?.spice.kind === 'transformer' ? layout!.devices[deviceIndex].firstDot : null} regulatorFirstDot={def?.spice.kind === 'regulator' ? layout!.devices[deviceIndex].firstDot : null} frameRef={frameRef} />
      )}
      {single && def?.spice.kind === 'vsource' && <SourceInspector props={single.props} isDcOnly={def.id !== 'vsource'} onChange={(props, record) => update({ props }, record)} />}
      {single &&
        def?.spice.kind !== 'vsource' &&
        def?.props.map((p) => {
          // With a manufacturer's model the bandwidth is in the model
          if (p.key === 'gbw' && single.props.model) return null;
          const value = String(single.props[p.key] ?? '');
          const isOpAmpModel = p.modelType === 'OPAMP';
          const isRegulatorModel = p.modelType === 'REGULATOR';
          const isBlock = p.modelType === 'SUBCKT';
          const options = p.type === 'model' ? modelsOfType(circuit, p.modelType ?? 'D', library) : [];
          const chosenCard = options.find((m) => m.name === value)?.card;
          // A block takes the shape of its model: the pins are part of the kind of part
          const chosen = (next: string, card: string | undefined): Partial<Element> => ({
            props: { ...single.props, [p.key]: next, ...(isOpAmpModel || isRegulatorModel ? { pins: '' } : {}), ...(isBlock && card ? { pinNames: subcircuitPins(card).join(' ') } : {}) },
            ...(isBlock && card ? { def: blockId(subcircuitPins(card).length) } : {}),
          });
          const setValue = (next: string, record = true) => update(chosen(next, options.find((m) => m.name === next)?.card), record);
          const addModels = (models: ImportedModel[]) => {
            const isKept = onImportModels(models);
            // The part takes a model imported for it; out of a whole library, the choice is the user's
            const fitting = models.filter((m) => fitsModelType(m.card, p.modelType ?? 'D'));
            const usable = fitting.length === 1 ? fitting[0] : undefined;
            // A copy the circuit already has must follow, or the new version would never be used
            const imported = new Map(models.map((m) => [m.name, m.card]));
            const hasOwnCopy = circuit.models.some((m) => imported.has(m.name));
            if (usable || hasOwnCopy) {
              onChange({
                ...circuit,
                models: circuit.models.map((m) => ({ name: m.name, card: imported.get(m.name) ?? m.card })),
                elements: circuit.elements.map((el) => (el.id === single.id && usable ? { ...el, ...chosen(usable.name, usable.card) } : el)),
              });
            }
            return isKept;
          };
          return (
            <React.Fragment key={p.key}>
              <label>
                {p.label}
                {p.type === 'choice' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {p.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : p.type === 'model' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}>
                    {(isOpAmpModel || isRegulatorModel) && <option value="">{isOpAmpModel ? 'Ideale' : 'Semplice'}</option>}
                    {isBlock && !chosenCard && <option value="">Scegli…</option>}
                    {options.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value)} />
                )}
                {(def.spice.kind === 'passive' || def.spice.kind === 'isource') && <ValueSlider value={value} label={p.label} onChange={setValue} />}
              </label>
              {p.type === 'model' && <ModelImporter library={library} onImport={addModels} onRemove={onRemoveModel} />}
              {isBlock && chosenCard && (
                <p className="hint">Piedini, da sinistra in alto e poi a destra: {subcircuitPins(chosenCard).join(', ')}. Vale per l'Analisi precisa: con un sottocircuito l'animazione non parte.</p>
              )}
              {isRegulatorModel && chosenCard && (
                <>
                  <ModelPins pins={subcircuitPins(chosenCard)} roles={readRegulatorRoles(single.props.pins, subcircuitPins(chosenCard)) ?? REGULATOR_ROLES} allRoles={REGULATOR_ROLES} labels={REGULATOR_LABELS} onChange={(pins) => update({ props: { ...single.props, pins } })} />
                  <p className="hint">Il modello vale per l'Analisi precisa. L'animazione usa il comportamento semplice.</p>
                </>
              )}
              {isOpAmpModel && chosenCard && (
                <>
                  <ModelPins pins={subcircuitPins(chosenCard)} roles={readOpAmpRoles(single.props.pins, subcircuitPins(chosenCard)) ?? OPAMP_ROLES} allRoles={OPAMP_ROLES} labels={OPAMP_LABELS} onChange={(pins) => update({ props: { ...single.props, pins } })} />
                  <p className="hint">Il modello vale per l'Analisi precisa. L'animazione usa un operazionale ideale con queste alimentazioni.</p>
                </>
              )}
            </React.Fragment>
          );
        })}
      {single && def?.spice.kind === 'regulator' && (
        <p className="hint">Oltre 150 °C l'uscita si spegne e sotto 125 °C riparte. La temperatura è giusta, i tempi sono accorciati per vederla: circa 2 s di animazione.</p>
      )}
      {single && def?.spice.kind === 'meter' && (
        <p className="hint">
          {String(single.props.mode).startsWith('v') ? 'Collega i due puntali in parallelo ai punti da misurare.' : 'Apri il ramo e collega il multimetro in serie.'} Legge il puntale + rispetto al −. Con RMS esclude la componente continua. Vale per l'animazione.
        </p>
      )}
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
        {selected.some((el) => canMirror(getDevice(el.def))) && (
          <button title="Scambia sopra e sotto: per un op. amp, gli ingressi + e −" onClick={onMirrorSelected}>
            Specchia
          </button>
        )}
        <button className="danger" onClick={onDeleteSelected}>
          Elimina
        </button>
      </div>
    </div>
  );
};
