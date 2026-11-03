import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../samples/examples';
import { INVALID_FILE, MAX_FILE_BYTES } from './circuitFile';
import { circuitFragment, circuitFromFragment, isCircuitFragment } from './shareLink';

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('share links', () => {
  it.each(EXAMPLES.map((e) => e.id))('%s comes back the same', async (id) => {
    const circuit = EXAMPLES.find((e) => e.id === id)!.build();
    const fragment = await circuitFragment(circuit);
    expect(isCircuitFragment(`#${fragment}`)).toBe(true);
    expect(fragment).toMatch(/^c=[A-Za-z0-9_-]+$/);
    expect(await circuitFromFragment(`#${fragment}`)).toEqual(circuit);
  });

  it('keeps an imported model, and stays short for a lesson circuit', async () => {
    const circuit = { ...EXAMPLES[0].build(), models: [{ name: 'MYD', card: '.model MYD D(IS=1n RS=0.5)' }] };
    const fragment = await circuitFragment(circuit);
    expect((await circuitFromFragment(fragment)).models).toEqual(circuit.models);
    expect(fragment.length).toBeLessThan(1000);
  });

  it('refuses what is not a circuit', async () => {
    await expect(circuitFromFragment('#x=abc')).rejects.toThrow(INVALID_FILE);
    await expect(circuitFromFragment('#c=not base64!')).rejects.toThrow(INVALID_FILE);
    await expect(circuitFromFragment('#c=AAAA')).rejects.toThrow(INVALID_FILE);
    const packed = new Uint8Array(await new Response(new Blob([new TextEncoder().encode('{"hello":1}')]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    await expect(circuitFromFragment(`#c=${toBase64Url(packed)}`)).rejects.toThrow(INVALID_FILE);
  });

  it('stops a small link that would unpack into too much', async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1024).fill(32);
    const packed = new Uint8Array(await new Response(new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    expect(packed.length).toBeLessThan(20000);
    let binary = '';
    for (const b of packed) binary += String.fromCharCode(b);
    const fragment = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(circuitFromFragment(`#c=${fragment}`)).rejects.toThrow(INVALID_FILE);
  });
});
