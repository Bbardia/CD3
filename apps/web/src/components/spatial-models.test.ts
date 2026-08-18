import { describe, expect, it } from 'vitest';

import { modelKeyFor } from './spatial-models';
import { getWorkspaceProjection3D, project } from '../workspace';

describe('modelKeyFor', () => {
  it('maps the container fixture onto recognizable props', () => {
    const byName = Object.fromEntries(
      getWorkspaceProjection3D(project, 'core-containers').nodes.map((node) => [
        node.name,
        modelKeyFor(node),
      ]),
    );

    expect(byName).toMatchObject({
      Shopper: 'person',
      'Commerce Data Store': 'database',
      'Commerce Event Stream': 'queue',
      'Storefront Web App': 'browser',
      'Commerce Edge API': 'gateway',
      'Inventory Worker': 'worker',
      'Constellation Payments': 'cloud',
    });
  });

  it('lets an explicit icon choice override everything else', () => {
    expect(modelKeyFor({ kind: 'person', tags: ['person'], icon: 'database' })).toBe('database');
    expect(modelKeyFor({ kind: 'container', tags: [], icon: 'not-a-real-icon' })).toBe('server');
  });

  it('maps the newer technology vocabularies onto their own props', () => {
    expect(modelKeyFor({ kind: 'container', tags: ['auth'] })).toBe('lock');
    expect(modelKeyFor({ kind: 'container', tags: [], technology: 'Metrics dashboard' })).toBe(
      'analytics',
    );
    expect(modelKeyFor({ kind: 'container', tags: ['mobile'] })).toBe('mobile');
    // Storage means object storage now; databases keep their own prop.
    expect(modelKeyFor({ kind: 'container', tags: [], technology: 'S3 object storage' })).toBe(
      'storage',
    );
    expect(modelKeyFor({ kind: 'container', tags: [], technology: 'PostgreSQL 17' })).toBe(
      'database',
    );
  });

  it('falls back to the element kind when tags and technology say nothing', () => {
    expect(modelKeyFor({ kind: 'container', tags: ['container'] })).toBe('server');
    expect(modelKeyFor({ kind: 'component', tags: [] })).toBe('component');
    expect(modelKeyFor({ kind: 'softwareSystem', tags: [] })).toBe('system');
    expect(modelKeyFor({ kind: 'softwareSystem', tags: ['external'] })).toBe('cloud');
  });
});
