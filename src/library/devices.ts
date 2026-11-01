import { ComponentDef } from '../model/types';

const twoPin = (a: string, b: string) => [
  { id: a, x: -40, y: 0 },
  { id: b, x: 40, y: 0 },
];

export const DEVICES: ComponentDef[] = [
  { id: 'ground', name: 'Massa', terminals: [{ id: 'g', x: 0, y: 0 }], spice: { kind: 'ground', terminal: 'g' } },
  { id: 'resistor', name: 'Resistore', terminals: twoPin('a', 'b'), spice: { kind: 'passive', prefix: 'R', a: 'a', b: 'b', valueProp: 'value' } },
  { id: 'capacitor', name: 'Condensatore', terminals: twoPin('a', 'b'), spice: { kind: 'passive', prefix: 'C', a: 'a', b: 'b', valueProp: 'value' } },
  { id: 'inductor', name: 'Induttore', terminals: twoPin('a', 'b'), spice: { kind: 'passive', prefix: 'L', a: 'a', b: 'b', valueProp: 'value' } },
  { id: 'vsource', name: 'Generatore di tensione', terminals: twoPin('pos', 'neg'), spice: { kind: 'vsource', pos: 'pos', neg: 'neg' } },
  { id: 'diode', name: 'Diodo', terminals: twoPin('anode', 'cathode'), spice: { kind: 'diode', anode: 'anode', cathode: 'cathode', modelProp: 'model' } },
];

const byId = new Map(DEVICES.map((d) => [d.id, d]));

export function getDevice(id: string): ComponentDef | undefined {
  return byId.get(id);
}
