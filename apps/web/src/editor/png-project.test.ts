import { describe, expect, it } from 'vitest';

import { embedProjectInPng, extractProjectFromPng } from './png-project';

/** The smallest valid-enough PNG skeleton: signature, an IHDR-ish chunk, then IEND. */
function tinyPng(): Uint8Array {
  const bytes = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 4, 73, 72, 68, 82, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0,
    73, 69, 78, 68, 174, 66, 96, 130,
  ];
  return new Uint8Array(bytes);
}

describe('project-in-PNG round trip', () => {
  it('embeds before IEND and reads back exactly, including unicode', () => {
    const json = JSON.stringify({ name: 'Nördstern — 商店', ok: true });

    const embedded = embedProjectInPng(tinyPng(), json);

    expect(embedded.length).toBeGreaterThan(tinyPng().length);
    expect(extractProjectFromPng(embedded)).toBe(json);
  });

  it('returns undefined for a PNG without the chunk and passes non-PNGs through', () => {
    expect(extractProjectFromPng(tinyPng())).toBeUndefined();
    const notPng = new Uint8Array([1, 2, 3]);
    expect(embedProjectInPng(notPng, '{}')).toBe(notPng);
    expect(extractProjectFromPng(notPng)).toBeUndefined();
  });
});
