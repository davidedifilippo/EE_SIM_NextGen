import React, { useRef, useState } from 'react';
import { describeImport, ImportedModel, parseModelText } from '../library/modelImport';
import { SpiceModel } from '../model/types';
import { MAX_FILE_BYTES } from '../storage/circuitFile';

interface Props {
  library: SpiceModel[];
  /** Adds the models to the personal library. False if they could not be kept for the next visit. */
  onImport: (models: ImportedModel[]) => boolean;
  onRemove: (name: string) => void;
}

/** Takes SPICE models pasted as text or read from a library file. */
export const ModelImporter: React.FC<Props> = ({ library, onImport, onRemove }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const [hasFailed, setHasFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importText = (content: string) => {
    const read = parseModelText(content);
    setHasFailed(read.models.length === 0);
    if (read.models.length === 0) {
      setReport(read.skipped.length > 0 ? read.skipped : ['Nessun .model trovato nel testo']);
      return;
    }
    const isKept = onImport(read.models);
    setText('');
    setReport([...describeImport(read), ...(isKept ? [] : ['La libreria durerà solo fino alla chiusura della pagina: questo browser non permette di conservarla'])]);
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setHasFailed(true);
      setReport(['Il file è troppo grande']);
      return;
    }
    importText(await file.text());
  };

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)}>
        Importa modello{library.length > 0 ? ` · libreria: ${library.length}` : ''}
      </button>
    );
  }

  return (
    <div className="model-importer">
      <label>
        Modello SPICE, per la tua libreria
        <textarea
          rows={5}
          value={text}
          placeholder=".model NOME NPN(IS=1f BF=200)"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="hint">
        Già inclusi: diodi 1N4148, 1N4007, 1N5408, 1N5819; zener 1N4728A–1N4744A; BC547B, BC557B, 2N2222A, 2N2907A, 2N3904, 2N3906, BD139, BD140, TIP31C, TIP32C; 2N7000, BS170, IRF540N,
        IRF9540N, IRLZ44N. Per altri, con Da file si può caricare un'intera libreria: per esempio standard.bjt, standard.dio o standard.mos dalla cartella lib/cmp del proprio LTspice. Resta nella tua libreria
        personale, anche per i prossimi circuiti.
      </p>
      <div className="button-row">
        <button type="button" className="primary" disabled={!text.trim()} onClick={() => importText(text)}>
          Aggiungi
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Da file
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setReport([]);
          }}
        >
          Chiudi
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        aria-label="Importa un file di modelli"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) readFile(file);
        }}
      />
      {report.length > 0 && (
        <ul className={hasFailed ? 'import-report failed' : 'import-report'} role="status">
          {report.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {library.length > 0 && (
        <details className="model-library">
          <summary>La mia libreria ({library.length})</summary>
          <ul>
            {library.map((model) => (
              <li key={model.name}>
                <span>{model.name}</span>
                <button type="button" aria-label={`Togli ${model.name} dalla libreria`} title="Togli dalla libreria" onClick={() => onRemove(model.name)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
