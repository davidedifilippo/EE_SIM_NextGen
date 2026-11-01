import React, { useRef, useState } from 'react';
import { describeImport, ImportedModel, parseModelText } from '../library/modelImport';
import { MAX_FILE_BYTES } from '../storage/circuitFile';

interface Props {
  /** Adds the models to the circuit. */
  onImport: (models: ImportedModel[]) => void;
}

/** Takes SPICE models pasted as text or read from a library file. */
export const ModelImporter: React.FC<Props> = ({ onImport }) => {
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
    onImport(read.models);
    setText('');
    setReport(describeImport(read));
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
        Importa modello
      </button>
    );
  }

  return (
    <div className="model-importer">
      <label>
        Modello SPICE
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
    </div>
  );
};
