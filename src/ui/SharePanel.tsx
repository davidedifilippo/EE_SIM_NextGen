import React, { useEffect, useRef, useState } from 'react';
import { Circuit } from '../model/types';
import { circuitFragment, LONG_LINK } from '../storage/shareLink';

interface Props {
  /** With the models it uses, so that it works anywhere. */
  circuit: Circuit;
  onClose: () => void;
}

/** The link that opens a copy of the circuit. Copying to the clipboard needs a secure page: the link stays on view to copy by hand. */
export const SharePanel: React.FC<Props> = ({ circuit, onClose }) => {
  const [link, setLink] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let isCurrent = true;
    circuitFragment(circuit).then(
      (fragment) => isCurrent && setLink(`${location.origin}${location.pathname}#${fragment}`),
      () => isCurrent && setStatus('Non riesco a creare il link in questo browser'),
    );
    return () => {
      isCurrent = false;
    };
  }, [circuit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Link copiato');
    } catch {
      inputRef.current?.select();
      setStatus('Copia non consentita qui: il link è selezionato, copialo a mano');
    }
  };

  const send = async () => {
    try {
      await navigator.share({ title: circuit.title, url: link });
    } catch {
      // Closed without sending
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="share-panel" role="dialog" aria-label="Condividi il circuito" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Condividi il circuito</h2>
        <p>Chi apre il link riceve una copia del circuito, con i modelli che usa. Le sue modifiche non toccano il tuo.</p>
        <input ref={inputRef} readOnly value={link} aria-label="Link del circuito" onFocus={(e) => e.target.select()} />
        {link.length > LONG_LINK && <p className="share-warning">Il link è lungo: alcune app di messaggi potrebbero tagliarlo. In quel caso manda il file salvato.</p>}
        {location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? <p className="share-warning">Questo indirizzo funziona solo su questo computer.</p> : null}
        <div className="button-row">
          <button className="primary" onClick={copy} disabled={!link}>
            Copia link
          </button>
          {'share' in navigator && (
            <button onClick={send} disabled={!link}>
              Invia…
            </button>
          )}
          <button onClick={onClose}>Chiudi</button>
        </div>
        {status && <p role="status">{status}</p>}
      </div>
    </div>
  );
};
