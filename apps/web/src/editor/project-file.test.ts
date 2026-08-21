import { describe, expect, it } from 'vitest';

import { embedProjectInPng } from './png-project';
import { readProjectFile } from './project-file';
import { project } from '../workspace';

/** The smallest valid PNG: signature, IHDR, IDAT, IEND — enough to carry an iTXt chunk. */
function tinyPng(): Uint8Array {
  return Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
    ),
    (character) => character.charCodeAt(0),
  );
}

describe('readProjectFile', () => {
  it('opens a project from JSON, from a portable PNG, and from nothing else', async () => {
    const json = new File([JSON.stringify(project)], 'a.c4.json', { type: 'application/json' });
    const carrier = embedProjectInPng(tinyPng(), JSON.stringify(project));
    const png = new File([carrier.slice().buffer as ArrayBuffer], 'a.png', { type: 'image/png' });
    const plainPng = new File([tinyPng().slice().buffer as ArrayBuffer], 'shot.PNG', {
      type: 'image/png',
    });
    const junk = new File(['not json'], 'notes.txt', { type: 'text/plain' });

    expect((await readProjectFile(json))?.id).toBe(project.id);
    expect((await readProjectFile(png))?.id).toBe(project.id);
    // An ordinary screenshot carries no project, and its extension is not always lowercase.
    expect(await readProjectFile(plainPng)).toBeUndefined();
    expect(await readProjectFile(junk)).toBeUndefined();
  });
});
