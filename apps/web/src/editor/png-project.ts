/**
 * Embeds the project JSON inside an exported PNG (an iTXt chunk, the PNG-native metadata slot for
 * UTF-8 text), and reads it back — so a shared image is also the file it depicts.
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const PNG_PROJECT_KEYWORD = 'cd3-project';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((expected, index) => bytes[index] === expected);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

/** Builds one iTXt chunk: keyword, no compression, no language tag, UTF-8 text. */
function buildProjectChunk(json: string): Uint8Array {
  const keyword = new TextEncoder().encode(PNG_PROJECT_KEYWORD);
  const text = new TextEncoder().encode(json);
  // Layout: keyword NUL compressionFlag(0) compressionMethod(0) NUL(language) NUL(translated) text
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set([0, 0, 0, 0, 0], keyword.length);
  data.set(text, keyword.length + 5);

  const chunkType = new TextEncoder().encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(chunkType, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(chunkType, 0);
  crcInput.set(data, 4);
  writeUint32(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

/** Inserts the project chunk immediately before IEND; returns the original bytes if not a PNG. */
export function embedProjectInPng(png: Uint8Array, projectJson: string): Uint8Array {
  if (!isPng(png)) {
    return png;
  }
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(
      png[offset + 4] as number,
      png[offset + 5] as number,
      png[offset + 6] as number,
      png[offset + 7] as number,
    );
    if (type === 'IEND') {
      const chunk = buildProjectChunk(projectJson);
      const out = new Uint8Array(png.length + chunk.length);
      out.set(png.subarray(0, offset), 0);
      out.set(chunk, offset);
      out.set(png.subarray(offset), offset + chunk.length);
      return out;
    }
    offset += 12 + length;
  }
  return png;
}

/** Extracts the embedded project JSON from a PNG, or undefined when none is present. */
export function extractProjectFromPng(png: Uint8Array): string | undefined {
  if (!isPng(png)) {
    return undefined;
  }
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const type = String.fromCharCode(
      png[offset + 4] as number,
      png[offset + 5] as number,
      png[offset + 6] as number,
      png[offset + 7] as number,
    );
    if (type === 'iTXt') {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const decoded = new TextDecoder().decode(data);
      if (decoded.startsWith(`${PNG_PROJECT_KEYWORD}\u0000`)) {
        // Keyword, then the four header bytes (flags plus two empty strings), then the text.
        return decoded.slice(PNG_PROJECT_KEYWORD.length + 5);
      }
    }
    if (type === 'IEND') {
      return undefined;
    }
    offset += 12 + length;
  }
  return undefined;
}
