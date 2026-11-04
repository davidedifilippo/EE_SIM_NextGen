import React, { useEffect, useState } from 'react';
import { Circuit } from '../model/types';
import { circuitFileName } from '../storage/circuitFile';

interface Props {
  circuit: Circuit;
  /** Saves under this name, which becomes the title of the circuit too. */
  onSave: (title: string) => void;
  onClose: () => void;
}

/** The name before the download: on a tablet the browser saves the file without asking for one. */
export const SavePanel: React.FC<Props> = ({ circuit, onSave, onClose }) => {
  const [title, setTitle] = useState(circuit.title === 'Circuito' ? '' : circuit.title);
  const name = title.trim() || 'Circuito';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <form className="share-panel" role="dialog" aria-label="Salva il circuito" onPointerDown={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Salva il circuito</h2>
        <label>
          Nome
          <input autoFocus value={title} placeholder="Circuito" onChange={(e) => setTitle(e.target.value)} aria-label="Nome del circuito" />
        </label>
        <p>
          File: <strong>{circuitFileName({ ...circuit, title: name })}</strong>. Su iPad e iPhone lo trovi nell'app File, nella cartella Download.
        </p>
        <div className="button-row">
          <button type="submit" className="primary">
            Salva
          </button>
          <button type="button" onClick={onClose}>
            Annulla
          </button>
        </div>
      </form>
    </div>
  );
};
