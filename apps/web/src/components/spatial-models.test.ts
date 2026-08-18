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

  it('falls back to the element kind when tags and technology say nothing', () => {
    expect(modelKeyFor({ kind: 'container', tags: ['container'] })).toBe('server');
    expect(modelKeyFor({ kind: 'component', tags: [] })).toBe('component');
    expect(modelKeyFor({ kind: 'softwareSystem', tags: [] })).toBe('system');
    expect(modelKeyFor({ kind: 'softwareSystem', tags: ['external'] })).toBe('cloud');
  });
});
