# Componenti di terze parti

EE_SIM_NextGen è distribuito con licenza GPL v3 (vedi `LICENSE`). Include o usa i seguenti componenti, con licenze compatibili.

## PowerCad_NextGen

`src/utils/geometry.ts`, `src/editor/SchematicCanvas.tsx`, `src/editor/Renderer.tsx` e parte di `src/model/types.ts` derivano da PowerCad_NextGen.

```
MIT License

Copyright (c) 2026 Ing. Di Filippo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## eecircuit-engine

Dipendenza npm: build di ngspice in WebAssembly. Licenza MIT, Copyright (c) 2024 EElab.dev. Fonte: https://github.com/eelab-dev/EEcircuit-engine

Il pacchetto, e quindi il sito pubblicato, contiene anche:

- **ngspice** (https://ngspice.sourceforge.io), il simulatore compilato in WebAssembly. È distribuito per la maggior parte con licenza BSD modificata (3 clausole); il testo completo e le eccezioni sono nel file `COPYING` del progetto ngspice.
- **Modelli SkyWater SKY130**: Copyright 2020 The SkyWater PDK Authors, licenza Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
- **Modelli GlobalFoundries GF180MCU**: Copyright 2022 GlobalFoundries PDK Authors, licenza Apache 2.0.
- **Modelli FreePDK15**: Copyright (c) 2013-2016 North Carolina State University, licenza BSD a 3 clausole.

Gli avvisi di copyright e di licenza dei modelli restano nel testo dei modelli stessi, dentro `assets/ngspice.worker-*.js`.

## React e React DOM

Licenza MIT, Copyright (c) Facebook, Inc. and its affiliates. Fonte: https://github.com/facebook/react

## Workbox

Usato dal service worker che rende l'app disponibile offline (`sw.js`, `workbox-*.js`). Licenza MIT, Copyright 2018 Google LLC. Fonte: https://github.com/GoogleChrome/workbox

## vite-plugin-pwa

Usato solo per costruire il service worker e il manifest. Licenza MIT. Fonte: https://github.com/vite-pwa/vite-plugin-pwa
