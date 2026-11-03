import { Circuit } from '../model/types';
import { INVALID_FILE, MAX_FILE_BYTES, parseCircuitFile, serializeCircuit } from './circuitFile';

/** What comes before the circuit in the part of the address after #. */
const PREFIX = 'c=';

/** Above this a link may be cut by the apps it is sent through. */
export const LONG_LINK = 2000;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error(INVALID_FILE);
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Reads a stream to the end, refusing more than a file may hold: a few bytes can unpack into a great many. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error(INVALID_FILE);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

const through = (bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream) => readAll(new Blob([bytes]).stream().pipeThrough(transform));

/** The circuit, compressed, as the part of a link after #. */
export async function circuitFragment(circuit: Circuit): Promise<string> {
  const packed = await through(new TextEncoder().encode(serializeCircuit(circuit, 0)), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(packed);
}

export const isCircuitFragment = (hash: string) => hash.replace(/^#/, '').startsWith(PREFIX);

/** Reads a circuit from a link, with the checks of a file: a link comes from outside too. */
export async function circuitFromFragment(hash: string): Promise<Circuit> {
  const body = hash.replace(/^#/, '');
  if (!body.startsWith(PREFIX)) throw new Error(INVALID_FILE);
  let text: string;
  try {
    const bytes = await through(fromBase64Url(body.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(INVALID_FILE);
  }
  return parseCircuitFile(text);
}
