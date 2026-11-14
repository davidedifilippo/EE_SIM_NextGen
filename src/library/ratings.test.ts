import { describe, expect, it } from 'vitest';
import { BJT_SHEETS, DIODE_SHEETS, MOS_SHEETS, modelGroup, ZENER_SHEETS } from './standardModels';
import { ratingRows, saturationCurrent } from './ratings';

describe('the ratings of the library', () => {
  it('every diode, zener, transistor and MOSFET of the library has them', () => {
    for (const { name } of [...DIODE_SHEETS, ...ZENER_SHEETS, ...BJT_SHEETS, ...MOS_SHEETS]) expect(ratingRows(name), name).not.toBeNull();
    expect(ratingRows('tip120')).not.toBeNull();
    // A generic or imported model has none
    expect(ratingRows('MN1')).toBeNull();
  });

  it('a diode shows the saturation current of its model, with VRRM, IF and VF', () => {
    const r = ratingRows('D1N4148', '.model D1N4148 D(IS=2.52n RS=0.568 N=1.752)')!;
    expect(r.rows.map(([label]) => label)).toEqual(['VRRM, inversa massima', 'IF media massima', 'Potenza massima', 'VF in conduzione, massima', 'IS (del modello)']);
    expect(saturationCurrent('.model X D(IS=2.52n RS=1)')).toBeCloseTo(2.52e-9, 15);
    expect(saturationCurrent('.model X D(IS=6.734e-15)')).toBeCloseTo(6.734e-15, 25);
  });

  it('a transistor shows hFE, its voltages and its power, in free air and on a heat sink', () => {
    const rows = new Map(ratingRows('TIP31C')!.rows);
    expect(rows.get('VCEO, massima')).toBe('100 V');
    expect(rows.get('Potenza in aria')).toBe('2 W');
    expect(rows.get('Potenza con dissipatore')).toBe('40 W');
    expect(rows.get('hFE')).toContain('10–50');
  });

  it('puts every transistor of the library in the signal or the power group', () => {
    expect(modelGroup('BC547B')).toBe('Segnale');
    expect(modelGroup('2N3904')).toBe('Segnale');
    expect(modelGroup('TIP31C')).toBe('Potenza');
    expect(modelGroup('IRL520')).toBe('Potenza');
    expect(modelGroup('2N7000')).toBe('Segnale');
    expect(modelGroup('MN1')).toBeNull();
  });
});
