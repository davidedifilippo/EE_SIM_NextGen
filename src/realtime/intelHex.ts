/** Flash of the ATmega328P, in 16-bit words. */
const FLASH_WORDS = 0x4000;

/**
 * An Intel HEX file, as the Arduino IDE exports it, into the flash of the ATmega328P. Null if a line
 * is malformed, its checksum is wrong, or it does not fit.
 */
export function parseIntelHex(text: string): Uint16Array | null {
  const bytes = new Uint8Array(FLASH_WORDS * 2);
  let base = 0;
  let hasData = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^:([0-9a-fA-F]{2})+$/.test(line) || line.length < 11) return null;
    const record = Array.from({ length: (line.length - 1) / 2 }, (_, k) => parseInt(line.slice(1 + 2 * k, 3 + 2 * k), 16));
    const [count, high, low, type] = record;
    if (record.length !== count + 5) return null;
    if (record.reduce((sum, b) => sum + b, 0) & 0xff) return null;
    const data = record.slice(4, 4 + count);
    if (type === 0x00) {
      const address = base + ((high << 8) | low);
      if (address + count > bytes.length) return null;
      bytes.set(data, address);
      hasData = true;
    } else if (type === 0x01) {
      break;
    } else if (type === 0x02) {
      base = ((data[0] << 8) | data[1]) << 4;
    } else if (type === 0x04) {
      base = ((data[0] << 8) | data[1]) << 16;
    }
  }
  return hasData ? new Uint16Array(bytes.buffer) : null;
}

/** A short fingerprint of a program: a new one restarts the board, the same one lets it run on. */
export function programKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) hash = Math.imul(hash ^ text.charCodeAt(k), 0x01000193);
  return (hash >>> 0).toString(16);
}
