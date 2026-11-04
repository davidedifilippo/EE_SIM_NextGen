import React from 'react';
import { Element } from '../model/types';
import { tableId } from '../library/devices';
import { emptyTable, MAX_TABLE_INPUTS, MAX_TABLE_OUTPUTS } from '../realtime/logic';

interface Props {
  element: Element;
  inputs: string[];
  outputs: string[];
  onChange: (patch: Partial<Element>) => void;
}

/** The rows as they are stored, padded or cut to the size of the part: a table being resized keeps what fits. */
function resize(text: string, inputs: number, outputs: number): string {
  const old = text.trim().split(/\s+/).filter(Boolean);
  const fresh = emptyTable(inputs, outputs).split(' ');
  return fresh.map((row, r) => (old[r] ? (old[r] + row).slice(0, outputs).padEnd(outputs, '0') : row)).join(' ');
}

/** A truth table as a grid: the inputs of each row, and its outputs to switch with a touch. */
export const TruthTableEditor: React.FC<Props> = ({ element, inputs, outputs, onChange }) => {
  const rows = resize(String(element.props.table ?? ''), inputs.length, outputs.length).split(' ');

  const setSize = (nextInputs: number, nextOutputs: number) =>
    onChange({ def: tableId(nextInputs, nextOutputs), props: { ...element.props, table: resize(String(element.props.table ?? ''), nextInputs, nextOutputs) } });

  const toggle = (r: number, j: number) => {
    const next = rows.map((row, k) => (k === r ? row.slice(0, j) + (row[j] === '1' ? '0' : '1') + row.slice(j + 1) : row));
    onChange({ props: { ...element.props, table: next.join(' ') } });
  };

  return (
    <div className="truth-table">
      <div className="truth-table-size">
        <label>
          Ingressi
          <select value={inputs.length} onChange={(e) => setSize(Number(e.target.value), outputs.length)}>
            {Array.from({ length: MAX_TABLE_INPUTS }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Uscite
          <select value={outputs.length} onChange={(e) => setSize(inputs.length, Number(e.target.value))}>
            {Array.from({ length: MAX_TABLE_OUTPUTS }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="truth-table-scroll">
        <table>
          <thead>
            <tr>
              {inputs.map((name) => (
                <th key={name}>{name}</th>
              ))}
              {outputs.map((name) => (
                <th key={name} className="out">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {inputs.map((name, k) => (
                  <td key={name}>{(r >> (inputs.length - 1 - k)) & 1}</td>
                ))}
                {outputs.map((name, j) => (
                  <td key={name} className="out">
                    <button className={row[j] === '1' ? 'on' : ''} aria-label={`Riga ${r + 1}, ${name}`} aria-pressed={row[j] === '1'} onClick={() => toggle(r, j)}>
                      {row[j]}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
