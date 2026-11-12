/**
 * The simulator is published in two editions from the same code: the main one, and one with the breadboard
 * view beside the schematic. Which one is decided when it is built, so that the main edition does not carry
 * the code of the breadboard.
 */
export const HAS_BREADBOARD = import.meta.env.VITE_EDITION === 'breadboard';
