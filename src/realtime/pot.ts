import { Element } from '../model/types';
import { parseSpiceValue } from '../netlist/values';
import { CONTACT_CLOSED } from './switches';

/**
 * The two halves of a potentiometer, from the end a to the wiper and from the wiper to the end b, in
 * both engines. At an end the wiper touches it as a closed contact does, never with nothing between.
 */
export function potResistances(el: Element, valueProp: string, positionProp: string): [number, number] | null {
  const total = parseSpiceValue(String(el.props[valueProp] ?? ''));
  const position = parseSpiceValue(String(el.props[positionProp] ?? ''));
  if (total === null || total <= 0 || position === null || position < 0 || position > 100) return null;
  const share = position / 100;
  return [Math.max(total * share, CONTACT_CLOSED), Math.max(total * (1 - share), CONTACT_CLOSED)];
}
