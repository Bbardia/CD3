import { describe, expect, it } from 'vitest';

import { elementFromPalette, paletteEntryById, uniqueId } from './palette';
import { project } from '../workspace';

describe('object palette', () => {
  it('takes the C4 kind from the view and the identity from the entry', () => {
    const database = paletteEntryById('database');
    if (database === undefined) {
      throw new Error('The palette must offer a database.');
    }

    expect(
      elementFromPalette(
        database,
        project,
        { type: 'container', scopeElementId: 'northstar-commerce' },
        'x',
      ),
    ).toMatchObject({
      kind: 'container',
      parentId: 'northstar-commerce',
      technology: 'PostgreSQL',
    });
    expect(
      elementFromPalette(
        database,
        project,
        { type: 'context', scopeElementId: 'northstar-commerce' },
        'x',
      ),
    ).toMatchObject({ kind: 'softwareSystem' });
  });

  it('keeps people top level whatever the view is', () => {
    const person = paletteEntryById('person');
    if (person === undefined) {
      throw new Error('The palette must offer a person.');
    }

    expect(
      elementFromPalette(
        person,
        project,
        { type: 'component', scopeElementId: 'order-service' },
        'x',
      ),
    ).toMatchObject({ kind: 'person' });
  });

  it('falls back to a software system when the view scope is missing', () => {
    const service = paletteEntryById('server');
    if (service === undefined) {
      throw new Error('The palette must offer a service.');
    }

    expect(
      elementFromPalette(service, project, { type: 'container', scopeElementId: 'gone' }, 'x'),
    ).toMatchObject({ kind: 'softwareSystem' });
  });

  it('slugs names into free, URL-safe ids', () => {
    const taken = new Set(['web-app', 'web-app-2']);

    expect(uniqueId(project, 'Web app', (id) => taken.has(id))).toBe('web-app-3');
    expect(uniqueId(project, '!!!', () => false)).toBe('element');
  });
});
