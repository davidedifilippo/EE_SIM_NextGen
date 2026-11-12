import React, { useEffect, useState } from 'react';
import { HAS_BREADBOARD } from '../edition';
import { Logo } from './Logo';

const REPOSITORY = 'https://github.com/davidedifilippo/EE_SIM_NextGen';

/** Who made the simulator, what it does, and its licence. */
export const AboutPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="share-panel about-panel" role="dialog" aria-label="Informazioni su EE_SIM_NextGen" onPointerDown={(e) => e.stopPropagation()}>
        <div className="about-header">
          <h2>EE_SIM_NextGen</h2>
          <button className="icon" aria-label="Chiudi" title="Chiudi" onClick={onClose}>
            ×
          </button>
        </div>
        <p>Simulatore di circuiti elettronici open source, funzionante nel browser, con l'immediatezza di EveryCircuit e l'accuratezza di SPICE.</p>
        <p>
          <strong>Autore:</strong> Ing. Di Filippo Davide. Sviluppato in ambiente Claude Code di Anthropic.
        </p>
        <p>
          Funziona su computer, tablet e telefono, anche con il dito. Non serve installare nulla e il circuito non lascia mai il dispositivo: si salva nel browser e, se vuoi, in un file.
        </p>
        <h3>Cosa sa fare</h3>
        <ul>
          <li>
            <strong>Animazione in tempo reale:</strong> correnti che scorrono sui fili, valori che si regolano mentre il circuito gira, LED e lampade che si accendono, motori che girano. Oscilloscopio fino a 4 tracce, con
            trigger e tracce separate come un analizzatore logico; multimetro con V, A e Ω.
          </li>
          <li>
            <strong>Analisi precisa con ngspice:</strong> analisi nel tempo, in frequenza (diagramma di Bode) e DC sweep.
          </li>
          <li>
            <strong>Componenti analogici:</strong> resistori, potenziometri, condensatori, induttori, trasformatori anche a presa centrale, interruttori, pulsanti e deviatori, diodi, LED, zener, ponte di Graetz, BJT,
            MOSFET, operazionali, regolatori 78xx, 79xx, LM317 e LM337, generatori di tensione e di corrente.
          </li>
          <li>
            <strong>Componenti elettromeccanici e sensori:</strong> relè da 5 e 12 V, lampada con filamento che si scalda (e corrente di spunto), motoriduttori in corrente continua, sensori di temperatura LM35 e TMP36,
            optoisolatore PC817, timer 555 (NE555 e TLC555).
          </li>
          <li>
            <strong>Logica:</strong> porte, tabelle di verità, flip-flop D, T, JK e SR, latch SR, clock, contatori, driver e display a 7 segmenti; multiplexer, demultiplexer, half e full adder costruiti da
            sottocomponenti, con lo schema interno da aprire livello per livello.
          </li>
          <li>
            <strong>Arduino Uno:</strong> il microcontrollore emulato esegue il programma vero, da un esempio o dal file .hex esportato dall'IDE, con i piedini collegati al circuito, PWM, ingressi analogici e monitor
            seriale.
          </li>
          <li>
            <strong>Modelli:</strong> una libreria inclusa di diodi, zener, transistor e MOSFET comuni, ricavata dai datasheet; import di <code>.model</code> e <code>.subckt</code> SPICE dei produttori, con le
            traduzioni necessarie per la versione di ngspice inclusa.
          </li>
          <li>
            <strong>Esempi per le lezioni:</strong> partitore, raddrizzatori, filtro RC, zener, amplificatore invertente, transistor come interruttore, regolatore, alimentatore duale, porte logiche, display, contatore, full
            adder, multiplexer, 555 astabile e monostabile, relè, motoriduttore, sensori, optoisolatore, Arduino.
          </li>
          <li>
            <strong>Condivisione:</strong> un link contiene tutto il circuito. Chi lo apre ne riceve una copia, e nessun server lo vede.
          </li>
          <li>
            <strong>Editor:</strong> copia e incolla, menu contestuale, selezione ad area, annulla e ripeti, fili che seguono i componenti spostati, tema chiaro e scuro.
          </li>
        </ul>
        <p>
          {HAS_BREADBOARD ? (
            <>
              Questa è l'edizione con la vista breadboard. <a href="../">Apri l'edizione principale</a>, senza breadboard.
            </>
          ) : (
            <>
              Esiste anche un'edizione con la vista breadboard, in sviluppo: <a href="./breadboard/">aprila qui</a>.
            </>
          )}
        </p>
        <p className="about-note">
          Sviluppato da zero dall'Ing. Di Filippo Davide sfruttando le possibilità offerte dall'ambiente di sviluppo del codice di Claude Code. Tutte le scelte progettuali, la direzione di sviluppo e la correzione dei bug sono frutto
          dell'esperienza dell'autore nel settore. Si tratta di un software per simulazioni didattiche e non di un software professionale. Si vedano i termini di licenza GPL v3 presenti in{' '}
          <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
            {REPOSITORY.replace('https://', '')}
          </a>
          .
        </p>
      </div>
    </div>
  );
};

/** The logo, which opens the page about the simulator. */
export const LogoButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button className="logo-button" aria-label="Informazioni su EE_SIM_NextGen" title="Informazioni" onClick={() => setIsOpen(true)}>
        <Logo />
      </button>
      {HAS_BREADBOARD && <span className="edition-tag">Breadboard</span>}
      {isOpen && <AboutPanel onClose={() => setIsOpen(false)} />}
    </>
  );
};
