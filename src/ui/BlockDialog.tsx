import React, { useEffect, useState } from 'react';
import { ProposedPin } from '../library/blockFromSelection';

interface Props {
  pins: ProposedPin[];
  /** What went wrong the last time, to say it beside the fields. */
  error: string | null;
  onCreate: (name: string, pins: ProposedPin[], saveToLibrary: boolean) => void;
  onClose: () => void;
}

/** The name of the block and of each pin, and its side: what the selection becomes. */
export const BlockDialog: React.FC<Props> = ({ pins: proposed, error, onCreate, onClose }) => {
  const [name, setName] = useState('');
  const [pins, setPins] = useState(proposed);
  const [saveToLibrary, setSaveToLibrary] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (k: number, change: Partial<ProposedPin>) => setPins(pins.map((pin, j) => (j === k ? { ...pin, ...change } : pin)));

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(name.trim() || 'Blocco', pins, saveToLibrary);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form className="share-panel block-dialog" role="dialog" aria-label="Crea un blocco" onPointerDown={(e) => e.stopPropagation()} onSubmit={create}>
        <h2>Crea un blocco</h2>
        <label>
          Nome
          <input autoFocus value={name} placeholder="Blocco" maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Nome del blocco" />
        </label>
        {pins.length > 0 ? (
          <>
            <p>Ogni collegamento fra la selezione e il resto del circuito diventa un piedino. La massa è comune: non serve un piedino.</p>
            <table className="block-pins">
              <thead>
                <tr>
                  <th>Piedino</th>
                  <th>Lato</th>
                </tr>
              </thead>
              <tbody>
                {pins.map((pin, k) => (
                  <tr key={k}>
                    <td>
                      <input value={pin.name} maxLength={12} aria-label={`Nome del piedino ${k + 1}`} onChange={(e) => update(k, { name: e.target.value })} />
                    </td>
                    <td>
                      <select value={pin.side} aria-label={`Lato del piedino ${k + 1}`} onChange={(e) => update(k, { side: e.target.value as ProposedPin['side'] })}>
                        <option value="left">Sinistra</option>
                        <option value="right">Destra</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>La selezione non è collegata al resto del circuito.</p>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
          Salva anche nella libreria, per usarlo in altri circuiti
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="primary" disabled={pins.length === 0}>
            Crea
          </button>
          <button type="button" onClick={onClose}>
            Annulla
          </button>
        </div>
      </form>
    </div>
  );
};
