# EE_SIM_NextGen

Simulatore di circuiti elettronici open source, nel browser, con l'immediatezza di EveryCircuit e l'accuratezza di SPICE.

**Apri l'app:** https://davidedifilippo.github.io/EE_SIM_NextGen/

Funziona su computer, tablet e telefono, anche con il dito. Non serve installare nulla e il circuito non lascia mai il dispositivo: si salva nel browser e, se vuoi, in un file.

## Cosa sa fare

- **Animazione in tempo reale:** correnti che scorrono sui fili, valori che si regolano mentre il circuito gira, LED e lampade che si accendono, motori che girano, contatti che si muovono. Oscilloscopio fino a 4 tracce, con trigger e tracce separate come un analizzatore logico; multimetro con V, A e Ω.
- **Analisi precisa con ngspice:** analisi nel tempo, in frequenza (diagramma di Bode) e DC sweep.
- **Componenti analogici:** resistori, potenziometri, condensatori, induttori, trasformatori anche a presa centrale, diodi, LED, zener, ponte di Graetz, BJT, MOSFET, operazionali, regolatori 78xx, 79xx, LM317 e LM337, generatori di tensione e di corrente.
- **Interruttori e relè:** interruttore, pulsanti, deviatore e deviatore a tre posizioni; relè SPST e SPDT da 5 e 12 V; relè passo passo Finder serie 27 (27.01, 27.05, 27.06); relè a stato solido Panasonic AQ-G; optoisolatore PC817. I valori vengono dai datasheet, e un avviso segnala quando si superano.
- **Carichi e sensori:** lampada con filamento che si scalda (e corrente di spunto), motoriduttori in corrente continua, sensori di temperatura LM35 e TMP36, timer 555 (NE555 e TLC555).
- **Logica:** porte, tabelle di verità, flip-flop D, T, JK e SR, latch SR, clock, contatori, driver e display a 7 segmenti; multiplexer, demultiplexer, half e full adder costruiti da sottocomponenti, con lo schema interno da aprire livello per livello.
- **Arduino Uno:** il microcontrollore emulato esegue il programma vero, da un esempio o dal file `.hex` esportato dall'IDE, con i piedini collegati al circuito, PWM, ingressi analogici e monitor seriale.
- **Blocchi:** un circuito intero, da un file o dalla selezione, diventa un componente con i suoi piedini, da riusare in altri schemi.
- **Modelli:** una libreria inclusa di diodi, zener, transistor e MOSFET comuni, ricavata dai datasheet; import di `.model` e `.subckt` SPICE dei produttori, con le traduzioni necessarie per la versione di ngspice inclusa.
- **Esempi per le lezioni:** partitore, raddrizzatore, filtro RC, zener, amplificatore invertente, transistor come interruttore, regolatore, alimentatore duale, porte logiche, display, contatore, full adder, multiplexer, 555 astabile e monostabile, relè, relè passo passo, relè a stato solido, motoriduttore, sensori, optoisolatore, Arduino.
- **Condivisione:** un link contiene tutto il circuito. Chi lo apre ne riceve una copia, e nessun server lo vede.
- **Editor:** copia e incolla, menu contestuale, selezione ad area, annulla e ripeti, fili che seguono i componenti spostati, tema chiaro e scuro.
- **Telefono:** un'interfaccia apposta per gli schermi piccoli, con lo schema a tutto schermo e i pannelli uno alla volta; la grandezza dei comandi si regola dal menu ⋮.

## Installarla come app

Dal sito si può aggiungere EE_SIM ai programmi del dispositivo. Poi si apre in una finestra sua e funziona anche senza rete.

- **iPad e iPhone, Safari:** *Condividi* → *Aggiungi alla schermata Home*
- **Android, Chrome:** menu ⋮ → *Aggiungi a schermata Home* o *Installa app*
- **Computer, Chrome o Edge:** icona di installazione nella barra degli indirizzi, oppure menu → *Installa EE_SIM_NextGen*
- **Mac, Safari:** *File* → *Aggiungi al Dock*

L'Analisi precisa usa ngspice, circa 20 MB. Il browser lo scarica pochi secondi dopo l'apertura e da quel momento funziona anche offline.

## Limiti noti

- **Modelli importati nell'animazione:** l'animazione usa il comportamento semplice di operazionali e regolatori anche quando c'è un modello importato, che vale solo per l'Analisi precisa. Con un componente Sottocircuito l'animazione non parte.
- **ngspice incluso:** è senza XSPICE. `POLY` e `VALUE` vengono tradotti in sorgenti B; `TABLE`, `LAPLACE` e `FREQ` non sono supportati.
- **Animazione semplificata:** non calcola le capacità dei transistor né la temperatura. Sui fronti veloci fa fede l'Analisi precisa.
- **Multimetro:** legge solo dall'animazione.
- **Generatore di corrente:** solo costante.
- **Copia e incolla:** gli appunti sono interni all'app, quindi non si incolla tra due schede.
- **Rotazione:** ruotando un componente i fili si staccano, per scelta, perché seguendolo si ingarbuglierebbero.
- **Pannello delle proprietà:** subito dopo aver aggiunto un componente può mostrare per un istante `NaN` al posto dei valori.
- **Arduino:** solo Arduino Uno; il programma si carica da un esempio o da un file `.hex`, non si scrive nell'app.
- **Valori stimati:** dove il datasheet non dà un dato (per esempio il rilascio del relè passo passo), il modello usa una stima, dichiarata nella nota del componente.

## Sviluppo

Serve Node.js 20 o più recente. Installa le dipendenze:

```bash
npm install
```

Avvia il server di sviluppo su http://localhost:5173 (con `-- --host` è raggiungibile anche da un tablet in rete):

```bash
npm run dev
```

Esegui i test:

```bash
npm test
```

Compila la versione da pubblicare nella cartella `dist`:

```bash
npm run build
```

A ogni push su `main`, GitHub Actions esegue test e build e pubblica il sito. Se un test fallisce, il sito resta alla versione precedente.

**Tecnologie:**
- **Interfaccia:** React, TypeScript e Vite.
- **Motore in tempo reale:** MNA con Newton-Raphson, con algoritmi ispirati a CircuitJS1 e riscritti da zero.
- **Arduino:** emulazione dell'ATmega328P con `avr8js`.
- **Motore di precisione:** ngspice compilato in WebAssembly, dal pacchetto `eecircuit-engine`.

## Licenza

GPL v3, vedi `LICENSE`. I componenti di terze parti e le loro licenze sono in `THIRD_PARTY_NOTICES.md`.

Autore: Ing. Di Filippo Davide. Sviluppato in ambiente [Claude Code](https://claude.com/claude-code) di Anthropic.
