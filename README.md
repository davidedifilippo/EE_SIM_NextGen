# EE_SIM_NextGen

Simulatore di circuiti elettronici open source, nel browser, con l'immediatezza di EveryCircuit e l'accuratezza di SPICE.

**Apri l'app:** https://davidedifilippo.github.io/EE_SIM_NextGen/

Funziona su computer, tablet e telefono, anche con il dito. Non serve installare nulla e il circuito non lascia mai il dispositivo: si salva nel browser e, se vuoi, in un file.

## Cosa sa fare

- **Animazione in tempo reale:** correnti che scorrono sui fili, valori che si regolano mentre il circuito gira, oscilloscopio fino a 4 tracce e multimetro con V, A e Ω.
- **Analisi precisa con ngspice:** analisi nel tempo, in frequenza (diagramma di Bode) e DC sweep.
- **Componenti:** resistori, condensatori, induttori, trasformatore, diodi, zener, BJT, MOSFET, operazionali, regolatori 78xx, 79xx, LM317 e LM337, generatori di tensione e di corrente.
- **Modelli dei produttori:** import di `.model` e `.subckt` SPICE, con le traduzioni necessarie per la versione di ngspice inclusa.
- **Esempi per le lezioni:** partitore, raddrizzatore, filtro RC, zener, amplificatore invertente, transistor come interruttore, regolatore.
- **Condivisione:** un link contiene tutto il circuito. Chi lo apre ne riceve una copia, e nessun server lo vede.
- **Editor:** copia e incolla, menu contestuale, selezione ad area, annulla e ripeti, tema chiaro e scuro.

## Installarla come app

Dal sito si può aggiungere EE_SIM ai programmi del dispositivo. Poi si apre in una finestra sua e funziona anche senza rete.

- **iPad e iPhone, Safari:** *Condividi* → *Aggiungi alla schermata Home*
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
- **Logica digitale e Arduino:** sono previsti in una fase successiva.

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
- **Motore di precisione:** ngspice compilato in WebAssembly, dal pacchetto `eecircuit-engine`.

## Licenza

GPL v3, vedi `LICENSE`. I componenti di terze parti e le loro licenze sono in `THIRD_PARTY_NOTICES.md`.

Autore: Ing. Di Filippo Davide. Sviluppato in ambiente [Claude Code](https://claude.com/claude-code) di Anthropic.
