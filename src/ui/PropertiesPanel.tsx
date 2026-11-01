import React from 'react';
import { Circuit, Element } from '../model/types';
import { getDevice } from '../library/devices';

interface Props {
  circuit: Circuit;
  selectedIds: Set<string>;
  onChange: (next: Circuit) => void;
  onRotateSelected: () => void;
  onDeleteSelected: () => void;
}

export const PropertiesPanel: React.FC<Props> = ({ circuit, selectedIds, onChange, onRotateSelected, onDeleteSelected }) => {
  if (selectedIds.size === 0) {
    return <p className="hint">Seleziona un componente per modificarne i valori. Per collegare, parti da un terminale.</p>;
  }

  const selected = circuit.elements.filter((el) => selectedIds.has(el.id));
  const single = selectedIds.size === 1 && selected.length === 1 ? selected[0] : null;
  const def = single ? getDevice(single.def) : null;

  const update = (patch: Partial<Element>) => {
    if (!single) return;
    onChange({ ...circuit, elements: circuit.elements.map((el) => (el.id === single.id ? { ...el, ...patch } : el)) });
  };

  return (
    <div className="properties">
      <strong>{def ? def.name : `${selectedIds.size} oggetti selezionati`}</strong>
      {single && def?.tagPrefix && (
        <label>
          Nome
          <input value={single.tag} onChange={(e) => update({ tag: e.target.value })} />
        </label>
      )}
      {single &&
        def?.props.map((p) => (
          <label key={p.key}>
            {p.label}
            {p.type === 'model' ? (
              <select
                value={String(single.props[p.key] ?? '')}
                onChange={(e) => update({ props: { ...single.props, [p.key]: e.target.value } })}
              >
                {circuit.models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={String(single.props[p.key] ?? '')}
                onChange={(e) => update({ props: { ...single.props, [p.key]: e.target.value } })}
              />
            )}
          </label>
        ))}
      <div className="button-row">
        {selected.length > 0 && <button onClick={onRotateSelected}>Ruota</button>}
        <button className="danger" onClick={onDeleteSelected}>
          Elimina
        </button>
      </div>
    </div>
  );
};
