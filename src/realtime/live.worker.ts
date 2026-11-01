import { Circuit } from '../model/types';
import { LiveFrame, LiveSimulation } from './liveSimulation';
import { SolverError } from './engine';

export type LiveRequest =
  | { type: 'load'; revision: number; circuit: Circuit }
  | { type: 'config'; running: boolean; simSecondsPerSecond: number };

export type LiveResponse =
  | { type: 'frame'; revision: number; frame: LiveFrame; /** Fraction of the requested steps that fit in real time. */ keptUp: number }
  | { type: 'status'; revision: number; errors: string[] };

/** Solver steps per second of real time: the step size follows from the chosen speed. */
const STEPS_PER_SECOND = 2400;
const TICK_MS = 16;
const FRAME_MS = 33;
/** Leaves time to receive messages and for the browser to breathe. */
const BUDGET_MS = 11;
/** After a long pause, such as a hidden tab, do not try to catch up. */
const MAX_ELAPSED_MS = 100;

const simulation = new LiveSimulation();
let revision = 0;
let running = true;
let simSecondsPerSecond = 0.02;
let lastTick = performance.now();
let lastFrame = 0;
let owedSteps = 0;
let keptUp = 1;

const post = (message: LiveResponse) => self.postMessage(message);

function sendFrame() {
  const frame = simulation.frame();
  if (frame) post({ type: 'frame', revision, frame, keptUp });
}

self.onmessage = (e: MessageEvent<LiveRequest>) => {
  const message = e.data;
  if (message.type === 'config') {
    running = message.running;
    simSecondsPerSecond = message.simSecondsPerSecond;
    return;
  }
  revision = message.revision;
  const result = simulation.load(message.circuit);
  post({ type: 'status', revision, errors: result.ok ? [] : result.errors });
  sendFrame();
};

setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min(now - lastTick, MAX_ELAPSED_MS);
  lastTick = now;
  if (!running) return;

  owedSteps += (elapsed / 1000) * STEPS_PER_SECOND;
  const requested = Math.floor(owedSteps);
  try {
    const done = simulation.advance(requested, simSecondsPerSecond / STEPS_PER_SECOND, BUDGET_MS);
    // Steps that did not fit are dropped: the animation slows down rather than falling behind for good
    owedSteps -= requested;
    if (requested > 0) keptUp += (done / requested - keptUp) * 0.1;
  } catch (err) {
    if (!(err instanceof SolverError)) throw err;
    simulation.markFailed();
    post({ type: 'status', revision, errors: [err.message] });
  }

  if (now - lastFrame >= FRAME_MS) {
    lastFrame = now;
    sendFrame();
  }
}, TICK_MS);
