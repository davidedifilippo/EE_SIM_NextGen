import React from 'react';
import { Circuit, Element } from '../model/types';
import { getDevice } from '../library/devices';
import { LiveFrame, LiveLayout } from '../realtime/liveSimulation';
import { LiveReadout } from './LiveControls';
import { ValueSlider } from './ValueSlider';

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  onChange: (next: Circuit, record?: boolean) => void;
  onRotateSelected: () => void;
  onDeleteSelected: () => void;
  layout: LiveLayout | null;
  frameRef: React.MutableRefObject<LiveFrame | null>;
}

export const PropertiesPanel: React.FC<Props> = ({ circuit, selectedIds, onChange, onRotateSelected, onDeleteSelected, layout, frameRef }) => {
  if (selectedIds.size === 0) {
    return <p className="hint">Seleziona un componente per modificarne i valori. Per collegare, parti da un terminale.</p>;
  }

  const selected = circuit.elements.filter((el) => selectedIds.has(el.id));
  const single = selectedIds.size === 1 && selected.length === 1 ? selected[0] : null;
  const def = single ? getDevice(single.def) : null;
  const deviceIndex = single && layout ? layout.devices.findIndex((d) => d.elementId === single.id) : -1;

  const update = (patch: Partial<Element>, record = true) => {
    if (!single) return;
    onChange({ ...circuit, elements: circuit.elements.map((el) => (el.id === single.id ? { ...el, ...patch } : el)) }, record);
  };

  return (
    <div className="properties">
      <strong>{def ? def.name : `${selectedIds.size} oggetti selezionati`}</strong>
      {deviceIndex >= 0 && <LiveReadout deviceIndex={deviceIndex} frameRef={frameRef} />}
      {single &&
        def?.props.map((p) => {
          const value = String(single.props[p.key] ?? '');
          const setValue = (next: string, record = true) => update({ props: { ...single.props, [p.key]: next } }, record);
          return (
            <label key={p.key}>
              {p.label}
              {p.type === 'model' ? (
                <select value={value} onChange={(e) => setValue(e.target.value)}>
                  {circuit.models.map((m) => (
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
          );
        })}
      {single && def?.tagPrefix && (
        <label>
          Nome
          <input value={single.tag} onChange={(e) => update({ tag: e.target.value })} />
        </label>
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
