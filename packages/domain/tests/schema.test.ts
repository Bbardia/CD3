import { LIMITS, ProjectSchema, type ProjectInput } from '@cd3/domain';
import { describe, expect, it } from 'vitest';

function createValidProject(): ProjectInput {
  return {
    schemaVersion: 1,
    id: 'test-project',
    name: 'Test Project',
    description: 'A compact project used to exercise schema invariants.',
    elements: {
      shopper: {
        id: 'shopper',
        kind: 'person',
        name: 'Shopper',
        description: 'Places an order.',
        tags: ['customer'],
        properties: {},
        externalRefs: [],
      },
      commerce: {
        id: 'commerce',
        kind: 'softwareSystem',
        name: 'Commerce',
        description: 'Sells products.',
        tags: ['core'],
        properties: { tier: 1 },
        externalRefs: [],
      },
      api: {
        id: 'api',
        kind: 'container',
        parentId: 'commerce',
        name: 'Commerce API',
        technology: 'TypeScript',
        tags: ['api'],
        properties: {},
        externalRefs: [],
      },
      pricing: {
        id: 'pricing',
        kind: 'component',
        parentId: 'api',
        name: 'Pricing',
        technology: 'TypeScript module',
        tags: ['domain'],
        properties: {},
        externalRefs: [],
      },
    },
    relationships: {
      'shopper-uses-commerce': {
        id: 'shopper-uses-commerce',
        sourceId: 'shopper',
        targetId: 'commerce',
        name: 'Browses and buys',
        interaction: 'synchronous',
        technology: 'HTTPS',
        tags: ['customer'],
        properties: {},
        externalRefs: [],
      },
    },
    views: {
      context: {
        id: 'context',
        type: 'context',
        scopeElementId: 'commerce',
        name: 'Commerce context',
        items: {
          'context-shopper': { id: 'context-shopper', elementId: 'shopper' },
          'context-commerce': { id: 'context-commerce', elementId: 'commerce' },
        },
        placements: {
          'context-shopper': { x: 0, y: 100, width: 160, height: 80 },
          'context-commerce': { x: 300, y: 100, width: 200, height: 100 },
        },
        relationshipIds: ['shopper-uses-commerce'],
      },
      containers: {
        id: 'containers',
        type: 'container',
        scopeElementId: 'commerce',
        name: 'Commerce containers',
        items: {
          'containers-api': { id: 'containers-api', elementId: 'api' },
        },
        placements: {
          'containers-api': { x: 100, y: 100, width: 200, height: 100 },
        },
        relationshipIds: [],
      },
      components: {
        id: 'components',
        type: 'component',
        scopeElementId: 'api',
        name: 'API components',
        items: {
          'components-pricing': { id: 'components-pricing', elementId: 'pricing' },
        },
        placements: {
          'components-pricing': { x: 100, y: 100, width: 200, height: 100 },
        },
        relationshipIds: [],
      },
    },
    threeD: {
      policy: {
        coordinateScale: 0.025,
        elevationStep: 1.4,
        platformPadding: 0.5,
        defaultProjection: 'orthographic',
      },
      bookmarks: {
        'context-isometric': {
          id: 'context-isometric',
          name: 'Context isometric',
          viewId: 'context',
          projection: 'orthographic',
          position: { x: 16, y: 14, z: 16 },
          target: { x: 4, y: 0, z: 2 },
          zoom: 1.1,
        },
      },
    },
  };
}

function issuesFor(input: unknown): string {
  const result = ProjectSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? '' : result.error.issues.map((issue) => issue.message).join('\n');
}

describe('ProjectSchema', () => {
  it('accepts and normalizes a valid schema-version 1 project', () => {
    const result = ProjectSchema.parse(createValidProject());
    const pricing = result.elements.pricing;

    expect(result.schemaVersion).toBe(1);
    expect(pricing?.kind).toBe('component');
    if (pricing?.kind !== 'component') {
      throw new Error('Expected the pricing fixture element to be a component.');
    }
    expect(pricing.parentId).toBe('api');
    expect(result.views.context?.items['context-commerce']?.elementId).toBe('commerce');
  });

  it('rejects record key and embedded ID misalignment', () => {
    const element = createValidProject();
    element.elements.commerce!.id = 'different';
    expect(issuesFor(element)).toContain('must match embedded id');

    const relationship = createValidProject();
    relationship.relationships['shopper-uses-commerce']!.id = 'different';
    expect(issuesFor(relationship)).toContain('must match embedded id');

    const view = createValidProject();
    view.views.context!.id = 'different';
    expect(issuesFor(view)).toContain('must match embedded id');

    const viewItem = createValidProject();
    viewItem.views.context!.items['context-commerce']!.id = 'different';
    expect(issuesFor(viewItem)).toContain('View item key');

    const bookmark = createValidProject();
    bookmark.threeD.bookmarks['context-isometric']!.id = 'different';
    expect(issuesFor(bookmark)).toContain('Camera bookmark key');
  });

  it('rejects malformed IDs, record keys, and unsupported schema versions', () => {
    const id = createValidProject();
    id.elements.commerce!.id = 'Not URL Safe';
    expect(ProjectSchema.safeParse(id).success).toBe(false);

    const key = createValidProject();
    key.elements['Not URL Safe'] = key.elements.commerce!;
    expect(ProjectSchema.safeParse(key).success).toBe(false);

    expect(ProjectSchema.safeParse({ ...createValidProject(), schemaVersion: 2 }).success).toBe(
      false,
    );
  });

  it('rejects invalid parent kinds and cyclic parent links', () => {
    const wrongKind = createValidProject();
    const api = wrongKind.elements.api;
    if (api?.kind !== 'container') {
      throw new Error('Expected the api fixture element to be a container.');
    }
    api.parentId = 'shopper';
    expect(issuesFor(wrongKind)).toContain('container elements must have a softwareSystem parent');

    const cyclic = createValidProject();
    const cyclicPricing = cyclic.elements.pricing;
    if (cyclicPricing?.kind !== 'component') {
      throw new Error('Expected the pricing fixture element to be a component.');
    }
    cyclicPricing.parentId = 'pricing';
    expect(issuesFor(cyclic)).toContain('parent graph must be acyclic');
  });

  it('rejects missing semantic and view references', () => {
    const relation = createValidProject();
    relation.relationships['shopper-uses-commerce']!.targetId = 'missing';
    expect(issuesFor(relation)).toContain('does not exist');

    const view = createValidProject();
    view.views.context!.items['context-commerce']!.elementId = 'missing';
    expect(issuesFor(view)).toContain('does not exist');

    const bookmark = createValidProject();
    bookmark.threeD.bookmarks['context-isometric']!.viewId = 'missing';
    expect(issuesFor(bookmark)).toContain('Camera bookmark view');
  });

  it('never treats inherited Object prototype keys as record members', () => {
    const relationship = createValidProject();
    relationship.relationships['shopper-uses-commerce']!.targetId = 'constructor';
    expect(issuesFor(relationship)).toContain('Target element "constructor" does not exist');

    const viewRelationship = createValidProject();
    viewRelationship.views.context!.relationshipIds = ['constructor'];
    expect(issuesFor(viewRelationship)).toContain('View relationship "constructor" does not exist');

    const bookmark = createValidProject();
    bookmark.threeD.bookmarks['context-isometric']!.viewId = 'constructor';
    expect(issuesFor(bookmark)).toContain('Camera bookmark view "constructor" does not exist');
  });

  it('requires own placement and item keys even when the ID is constructor', () => {
    const missingPlacement = createValidProject();
    missingPlacement.elements.analytics = {
      id: 'analytics',
      kind: 'softwareSystem',
      name: 'Analytics',
      tags: [],
      properties: {},
      externalRefs: [],
    };
    Object.defineProperty(missingPlacement.views.context!.items, 'constructor', {
      configurable: true,
      enumerable: true,
      value: {
        id: 'constructor',
        elementId: 'analytics',
      },
      writable: true,
    });
    expect(issuesFor(missingPlacement)).toContain(
      'View item "constructor" requires a 2D placement',
    );

    const orphanPlacement = createValidProject();
    Object.defineProperty(orphanPlacement.views.context!.placements, 'constructor', {
      configurable: true,
      enumerable: true,
      value: {
        x: 0,
        y: 0,
        width: 100,
        height: 60,
      },
      writable: true,
    });
    expect(issuesFor(orphanPlacement)).toContain(
      'Placement "constructor" does not reference a view item',
    );
  });

  it('rejects self relationships, invalid view scopes, and duplicate view relationships', () => {
    const selfRelationship = createValidProject();
    selfRelationship.relationships['shopper-uses-commerce']!.targetId = 'shopper';
    expect(issuesFor(selfRelationship)).toContain('may not be self-loops');

    const invalidScope = createValidProject();
    invalidScope.views.context!.scopeElementId = 'shopper';
    expect(issuesFor(invalidScope)).toContain('context views require a softwareSystem scope');

    const duplicateRelationship = createValidProject();
    duplicateRelationship.views.context!.relationshipIds.push('shopper-uses-commerce');
    expect(issuesFor(duplicateRelationship)).toContain('may occur only once in a view');
  });

  it('enforces one occurrence per element and exact placement keys', () => {
    const duplicate = createValidProject();
    duplicate.views.context!.items['context-commerce-copy'] = {
      id: 'context-commerce-copy',
      elementId: 'commerce',
    };
    duplicate.views.context!.placements['context-commerce-copy'] = {
      x: 600,
      y: 100,
      width: 200,
      height: 100,
    };
    expect(issuesFor(duplicate)).toContain('may occur only once');

    const missingPlacement = createValidProject();
    delete missingPlacement.views.context!.placements['context-commerce'];
    expect(issuesFor(missingPlacement)).toContain('requires a 2D placement');

    const orphanPlacement = createValidProject();
    orphanPlacement.views.context!.placements.orphan = {
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    };
    expect(issuesFor(orphanPlacement)).toContain('does not reference a view item');
  });

  it('rejects non-finite, out-of-range, and oversized payload values', () => {
    const nonFinite = createValidProject();
    nonFinite.views.context!.placements['context-shopper']!.x = Number.POSITIVE_INFINITY;
    expect(ProjectSchema.safeParse(nonFinite).success).toBe(false);

    const camera = createValidProject();
    camera.threeD.bookmarks['context-isometric']!.position.x = LIMITS.cameraCoordinate + 1;
    expect(ProjectSchema.safeParse(camera).success).toBe(false);

    const description = createValidProject();
    description.elements.commerce!.description = 'x'.repeat(LIMITS.description + 1);
    expect(ProjectSchema.safeParse(description).success).toBe(false);

    const properties = createValidProject();
    properties.elements.commerce!.properties = {
      value: 'x'.repeat(LIMITS.propertiesPayload),
    };
    expect(issuesFor(properties)).toContain('Properties payload exceeds');
  });

  it('supports bounded JSON properties, external references, and asynchronous relationships', () => {
    const input = createValidProject();
    input.elements.commerce!.properties = {
      featureFlags: [true, false, null],
      release: { sequence: 42, status: 'ready' },
    };
    input.elements.commerce!.externalRefs = [
      {
        kind: 'documentation',
        label: 'Architecture guide',
        url: 'https://example.com/architecture',
      },
    ];
    input.relationships['shopper-uses-commerce']!.interaction = 'asynchronous';

    const result = ProjectSchema.parse(input);
    expect(result.relationships['shopper-uses-commerce']?.interaction).toBe('asynchronous');

    const invalidJson = createValidProject();
    invalidJson.elements.commerce!.properties = { value: Number.NaN };
    expect(ProjectSchema.safeParse(invalidJson).success).toBe(false);

    const invalidReference = createValidProject();
    invalidReference.elements.commerce!.externalRefs = [
      { kind: 'documentation', label: 'Broken', url: 'not a URL' },
    ];
    expect(ProjectSchema.safeParse(invalidReference).success).toBe(false);
  });
});
