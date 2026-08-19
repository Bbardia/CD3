import {
  DomainCommandError,
  ProjectSchema,
  applyCommand,
  applyCommands,
  applyCommandToHistory,
  createCommandHistory,
  redoCommand,
  undoCommand,
  type DomainCommand,
  type Project,
  type ProjectInput,
  type ReadonlyProject,
} from '@cd3/domain';
import { describe, expect, it } from 'vitest';

function createProject(): Project {
  const input = {
    schemaVersion: 1,
    id: 'command-project',
    name: 'Command Project',
    elements: {
      shopper: element({ id: 'shopper', kind: 'person', name: 'Shopper' }),
      commerce: element({ id: 'commerce', kind: 'softwareSystem', name: 'Commerce' }),
      api: element({
        id: 'api',
        kind: 'container',
        parentId: 'commerce',
        name: 'Commerce API',
      }),
      pricing: element({
        id: 'pricing',
        kind: 'component',
        parentId: 'api',
        name: 'Pricing',
      }),
      analytics: element({ id: 'analytics', kind: 'softwareSystem', name: 'Analytics' }),
      worker: element({
        id: 'worker',
        kind: 'container',
        parentId: 'analytics',
        name: 'Analytics Worker',
      }),
      adapter: element({
        id: 'adapter',
        kind: 'component',
        parentId: 'worker',
        name: 'Analytics Adapter',
      }),
    },
    relationships: {
      'shopper-uses-commerce': relationship({
        id: 'shopper-uses-commerce',
        sourceId: 'shopper',
        targetId: 'commerce',
        name: 'Uses',
      }),
      'adapter-calls-pricing': relationship({
        id: 'adapter-calls-pricing',
        sourceId: 'adapter',
        targetId: 'pricing',
        name: 'Calls pricing',
      }),
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
          'context-analytics': { id: 'context-analytics', elementId: 'analytics' },
          'context-worker': { id: 'context-worker', elementId: 'worker' },
          'context-adapter': { id: 'context-adapter', elementId: 'adapter' },
        },
        placements: {
          'context-shopper': { x: 0, y: 0, width: 160, height: 80 },
          'context-commerce': { x: 200, y: 0, width: 200, height: 100 },
          'context-analytics': { x: 500, y: 0, width: 200, height: 100 },
          'context-worker': { x: 500, y: 150, width: 200, height: 100 },
          'context-adapter': { x: 500, y: 300, width: 200, height: 100 },
        },
        relationshipIds: ['shopper-uses-commerce', 'adapter-calls-pricing'],
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
      bookmarks: {},
    },
  } satisfies ProjectInput;

  return ProjectSchema.parse(input);
}

type ElementSeed = ElementInputWithoutDefaults<ProjectInput['elements'][string]>;
type ElementInputWithoutDefaults<T> = T extends ProjectInput['elements'][string]
  ? Omit<T, 'externalRefs' | 'properties' | 'tags'>
  : never;

function element(value: ElementSeed): ProjectInput['elements'][string] {
  return { ...value, tags: [], properties: {}, externalRefs: [] };
}

type RelationshipSeed = Omit<
  ProjectInput['relationships'][string],
  'externalRefs' | 'interaction' | 'properties' | 'tags'
>;

function relationship(value: RelationshipSeed): ProjectInput['relationships'][string] {
  return {
    ...value,
    interaction: 'synchronous',
    tags: [],
    properties: {},
    externalRefs: [],
  };
}

function expectValid(project: ReadonlyProject): void {
  expect(ProjectSchema.safeParse(project).success).toBe(true);
}

function attemptMutation(mutate: () => void): void {
  try {
    mutate();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
  }
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }

  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen(Reflect.get(value, key), seen);
  }
}

function expectCommandError(
  project: ReadonlyProject,
  command: DomainCommand,
  code: string,
  message: string,
): void {
  const before = structuredClone(project);

  try {
    applyCommand(project, command);
    throw new Error('Expected the command to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainCommandError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(message);
  }

  expect(project).toEqual(before);
}

describe('element commands', () => {
  it('creates, updates, and deletes elements without mutating prior documents', () => {
    const initial = createProject();
    const initialSnapshot = structuredClone(initial);

    const created = applyCommand(initial, {
      type: 'create-element',
      element: element({
        id: 'checkout',
        kind: 'component',
        parentId: 'api',
        name: 'Checkout',
      }),
    });
    expect(created.project.elements.checkout?.name).toBe('Checkout');
    expect(created.patches.length).toBeGreaterThan(0);
    expect(created.inversePatches.length).toBeGreaterThan(0);
    expect(initial).toEqual(initialSnapshot);
    expectValid(created.project);

    const updated = applyCommand(created.project, {
      type: 'update-element',
      elementId: 'checkout',
      changes: { name: 'Checkout Workflow', tags: ['orders'] },
    });
    expect(updated.project.elements.checkout?.name).toBe('Checkout Workflow');
    expect(initial.elements.checkout).toBeUndefined();
    expectValid(updated.project);

    const deleted = applyCommand(updated.project, {
      type: 'delete-element',
      elementId: 'checkout',
    });
    expect(deleted.project.elements.checkout).toBeUndefined();
    expectValid(deleted.project);
  });

  it('rejects duplicate IDs, missing parents, and invalid parent kinds', () => {
    const project = createProject();

    expectCommandError(
      project,
      {
        type: 'create-element',
        element: element({ id: 'api', kind: 'softwareSystem', name: 'Duplicate' }),
      },
      'DUPLICATE_ELEMENT_ID',
      'Element "api" already exists.',
    );
    expectCommandError(
      project,
      {
        type: 'create-element',
        element: element({
          id: 'orphan',
          kind: 'container',
          parentId: 'missing',
          name: 'Orphan',
        }),
      },
      'INVALID_PROJECT',
      'Parent element "missing" does not exist.',
    );
    expectCommandError(
      project,
      {
        type: 'create-element',
        element: element({
          id: 'wrong-parent',
          kind: 'component',
          parentId: 'commerce',
          name: 'Wrong parent',
        }),
      },
      'INVALID_PROJECT',
      'component elements must have a container parent.',
    );
  });

  it('keeps identity, kind, and parent changes out of update-element', () => {
    const project = createProject();

    for (const protectedField of ['id', 'kind', 'parentId'] as const) {
      expectCommandError(
        project,
        {
          type: 'update-element',
          elementId: 'pricing',
          changes: { [protectedField]: 'changed' },
        } as unknown as DomainCommand,
        'PROTECTED_ELEMENT_FIELD',
        `cannot change protected field "${protectedField}"`,
      );
    }
  });

  it('requires explicit cascade and cleans descendants, relationships, and view occurrences', () => {
    const project = createProject();

    expectCommandError(
      project,
      { type: 'delete-element', elementId: 'analytics' },
      'CASCADE_REQUIRED',
      'has descendants; set cascade to true',
    );

    const result = applyCommand(project, {
      type: 'delete-element',
      elementId: 'analytics',
      cascade: true,
    });

    expect(result.project.elements.analytics).toBeUndefined();
    expect(result.project.elements.worker).toBeUndefined();
    expect(result.project.elements.adapter).toBeUndefined();
    expect(result.project.relationships['adapter-calls-pricing']).toBeUndefined();
    expect(result.project.views.context?.relationshipIds).not.toContain('adapter-calls-pricing');
    for (const itemId of ['context-analytics', 'context-worker', 'context-adapter']) {
      expect(result.project.views.context?.items[itemId]).toBeUndefined();
      expect(result.project.views.context?.placements[itemId]).toBeUndefined();
    }
    expectValid(result.project);
  });

  it('rejects cascade when deleting an element would leave a dangling view scope', () => {
    expectCommandError(
      createProject(),
      { type: 'delete-element', elementId: 'commerce', cascade: true },
      'VIEW_SCOPE_WOULD_DANGLE',
      'scopes view',
    );
  });
});

describe('authoring an element straight into a view', () => {
  const placed: DomainCommand = {
    type: 'create-element',
    element: element({ id: 'search', kind: 'container', parentId: 'commerce', name: 'Search' }),
    placeInView: {
      viewId: 'containers',
      itemId: 'containers-search',
      placement: { x: 400, y: 220, width: 240, height: 110 },
    },
  };

  it('adds the element, its view item and its placement in one command', () => {
    const result = applyCommand(createProject(), placed);

    expect(result.project.elements['search']).toMatchObject({ name: 'Search' });
    expect(result.project.views['containers']?.items['containers-search']).toEqual({
      id: 'containers-search',
      elementId: 'search',
    });
    expect(result.project.views['containers']?.placements['containers-search']).toEqual({
      x: 400,
      y: 220,
      width: 240,
      height: 110,
    });
    expectValid(result.project);
  });

  it('undoes the element and the view item together', () => {
    const history = applyCommandToHistory(createCommandHistory(createProject()), placed);
    const undone = undoCommand(history).project;

    expect(Object.hasOwn(undone.elements, 'search')).toBe(false);
    expect(Object.hasOwn(undone.views['containers']?.items ?? {}, 'containers-search')).toBe(false);
    expect(Object.hasOwn(undone.views['containers']?.placements ?? {}, 'containers-search')).toBe(
      false,
    );
  });

  it('rejects a view item id that is already taken, leaving the element uncreated', () => {
    expectCommandError(
      createProject(),
      {
        ...placed,
        placeInView: {
          viewId: 'containers',
          itemId: 'containers-api',
          placement: { x: 0, y: 0, width: 240, height: 110 },
        },
      },
      'DUPLICATE_VIEW_ITEM',
      'already exists in view "containers"',
    );
  });

  it('shows a new relationship in the requested view', () => {
    const result = applyCommand(createProject(), {
      type: 'create-relationship',
      relationship: relationship({
        id: 'api-calls-analytics',
        sourceId: 'api',
        targetId: 'analytics',
        name: 'Reports to',
      }),
      showInViewId: 'containers',
    });

    expect(result.project.views['containers']?.relationshipIds).toEqual(['api-calls-analytics']);
    expectValid(result.project);
  });
});

describe('reparent-element', () => {
  it('reparents through a separate validated command', () => {
    const project = createProject();
    const result = applyCommand(project, {
      type: 'reparent-element',
      elementId: 'pricing',
      parentId: 'worker',
    });
    const pricing = result.project.elements.pricing;

    expect(pricing?.kind).toBe('component');
    if (pricing?.kind !== 'component') {
      throw new Error('Expected pricing to remain a component.');
    }
    expect(pricing.parentId).toBe('worker');
    expect(result.patches).not.toHaveLength(0);
    expect(result.inversePatches).not.toHaveLength(0);
    expectValid(result.project);
  });

  it('rejects cyclic and hierarchy-invalid reparenting', () => {
    const project = createProject();

    expectCommandError(
      project,
      { type: 'reparent-element', elementId: 'api', parentId: 'pricing' },
      'REPARENT_CYCLE',
      'would create a cycle',
    );
    expectCommandError(
      project,
      { type: 'reparent-element', elementId: 'api', parentId: 'shopper' },
      'INVALID_PROJECT',
      'container elements must have a softwareSystem parent.',
    );
  });

  it('rejects a missing parent and root element kinds explicitly', () => {
    const project = createProject();

    expectCommandError(
      project,
      { type: 'reparent-element', elementId: 'pricing', parentId: 'missing' },
      'PARENT_ELEMENT_NOT_FOUND',
      'Parent element "missing" does not exist.',
    );
    expectCommandError(
      project,
      { type: 'reparent-element', elementId: 'shopper', parentId: 'commerce' },
      'ELEMENT_CANNOT_BE_REPARENTED',
      'person element "shopper" cannot have a parent.',
    );
    expectCommandError(
      project,
      { type: 'reparent-element', elementId: 'commerce', parentId: 'analytics' },
      'ELEMENT_CANNOT_BE_REPARENTED',
      'softwareSystem element "commerce" cannot have a parent.',
    );
  });
});

describe('relationship commands', () => {
  it('creates a validated relationship and rejects duplicate IDs or invalid endpoints', () => {
    const project = createProject();
    const created = applyCommand(project, {
      type: 'create-relationship',
      relationship: relationship({
        id: 'pricing-calls-adapter',
        sourceId: 'pricing',
        targetId: 'adapter',
        name: 'Calls adapter',
      }),
    });

    expect(created.project.relationships['pricing-calls-adapter']?.sourceId).toBe('pricing');
    expectValid(created.project);
    expectCommandError(
      project,
      {
        type: 'create-relationship',
        relationship: relationship({
          id: 'shopper-uses-commerce',
          sourceId: 'pricing',
          targetId: 'adapter',
          name: 'Duplicate',
        }),
      },
      'DUPLICATE_RELATIONSHIP_ID',
      'Relationship "shopper-uses-commerce" already exists.',
    );
    expectCommandError(
      project,
      {
        type: 'create-relationship',
        relationship: relationship({
          id: 'missing-endpoint',
          sourceId: 'pricing',
          targetId: 'missing',
          name: 'Missing endpoint',
        }),
      },
      'RELATIONSHIP_ENDPOINT_NOT_FOUND',
      'Target element "missing" does not exist.',
    );
  });
});

describe('relationship editing', () => {
  it('renames a relationship and switches its interaction', () => {
    const result = applyCommand(createProject(), {
      type: 'update-relationship',
      relationshipId: 'shopper-uses-commerce',
      changes: { name: 'Browses catalogue', interaction: 'asynchronous' },
    });

    expect(result.project.relationships['shopper-uses-commerce']).toMatchObject({
      name: 'Browses catalogue',
      interaction: 'asynchronous',
      sourceId: 'shopper',
      targetId: 'commerce',
    });
    expectValid(result.project);
  });

  it('refuses to move an endpoint through an update', () => {
    expectCommandError(
      createProject(),
      {
        type: 'update-relationship',
        relationshipId: 'shopper-uses-commerce',
        changes: { targetId: 'analytics' } as never,
      },
      'PROTECTED_RELATIONSHIP_FIELD',
      'cannot change protected field "targetId"',
    );
  });

  it('deletes a relationship and drops it from every view that listed it', () => {
    const result = applyCommand(createProject(), {
      type: 'delete-relationship',
      relationshipId: 'shopper-uses-commerce',
    });

    expect(Object.hasOwn(result.project.relationships, 'shopper-uses-commerce')).toBe(false);
    expect(result.project.views['context']?.relationshipIds).toEqual(['adapter-calls-pricing']);
    expectValid(result.project);
  });

  it('reports an unknown relationship instead of silently doing nothing', () => {
    expectCommandError(
      createProject(),
      { type: 'delete-relationship', relationshipId: 'missing' },
      'RELATIONSHIP_NOT_FOUND',
      'Relationship "missing" does not exist.',
    );
  });

  it('restores a deleted relationship and its view membership on undo', () => {
    const history = applyCommandToHistory(createCommandHistory(createProject()), {
      type: 'delete-relationship',
      relationshipId: 'shopper-uses-commerce',
    });
    const undone = undoCommand(history).project;

    expect(undone.relationships['shopper-uses-commerce']).toBeDefined();
    expect(undone.views['context']?.relationshipIds).toEqual([
      'shopper-uses-commerce',
      'adapter-calls-pricing',
    ]);
  });
});

describe('view commands', () => {
  it('commits a multi-item movement as one deterministic command-history entry', () => {
    const project = createProject();
    const command = {
      type: 'move-view-items',
      viewId: 'context',
      moves: [
        { itemId: 'context-shopper', x: 25, y: 50 },
        { itemId: 'context-commerce', x: 275, y: 75 },
      ],
    } as const;

    const first = applyCommand(project, command);
    const second = applyCommand(project, command);
    expect(first.patches).toEqual(second.patches);
    expect(first.inversePatches).toEqual(second.inversePatches);
    expect(first.project.views.context?.placements['context-shopper']).toMatchObject({
      x: 25,
      y: 50,
    });
    expect(first.project.views.context?.placements['context-commerce']).toMatchObject({
      x: 275,
      y: 75,
    });
    expect(project.views.context?.placements['context-shopper']).toMatchObject({ x: 0, y: 0 });
    expectValid(first.project);

    const history = applyCommandToHistory(createCommandHistory(project), command);
    expect(history.undoStack).toHaveLength(1);
    expect(history.redoStack).toHaveLength(0);
    expect(undoCommand(history).project).toEqual(project);
  });

  it('validates view/item IDs, unique moves, and finite bounded coordinates before moving', () => {
    const project = createProject();

    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'missing',
        moves: [{ itemId: 'context-shopper', x: 0, y: 0 }],
      },
      'VIEW_NOT_FOUND',
      'View "missing" does not exist.',
    );
    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'context',
        moves: [{ itemId: 'missing', x: 0, y: 0 }],
      },
      'VIEW_ITEM_NOT_FOUND',
      'View item "missing" does not exist',
    );
    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'context',
        moves: [{ itemId: 'context-shopper', x: Number.NaN, y: 0 }],
      },
      'INVALID_COORDINATE',
      'finite coordinates',
    );
    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'context',
        moves: [{ itemId: 'context-shopper', x: 1_000_001, y: 0 }],
      },
      'INVALID_PROJECT',
      'Too big',
    );
    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'context',
        moves: [
          { itemId: 'context-shopper', x: 1, y: 1 },
          { itemId: 'context-shopper', x: 2, y: 2 },
        ],
      },
      'DUPLICATE_VIEW_ITEM_MOVE',
      'may be moved only once per command',
    );
  });

  it('updates safe view metadata/policy fields and rejects protected or invalid mutations', () => {
    const project = createProject();
    const result = applyCommand(project, {
      type: 'update-view',
      viewId: 'context',
      changes: { name: 'System landscape', description: 'Updated safely.' },
    });

    expect(result.project.views.context).toMatchObject({
      id: 'context',
      name: 'System landscape',
      description: 'Updated safely.',
    });
    expectValid(result.project);
    expectCommandError(
      project,
      {
        type: 'update-view',
        viewId: 'context',
        changes: { id: 'renamed' },
      } as unknown as DomainCommand,
      'PROTECTED_VIEW_FIELD',
      'cannot change protected field "id"',
    );
    expectCommandError(
      project,
      {
        type: 'update-view',
        viewId: 'context',
        changes: { items: {} },
      } as unknown as DomainCommand,
      'PROTECTED_VIEW_FIELD',
      'cannot change protected field "items"',
    );
    expectCommandError(
      project,
      {
        type: 'update-view',
        viewId: 'context',
        changes: { scopeElementId: 'shopper' },
      },
      'INVALID_PROJECT',
      'context views require a softwareSystem scope.',
    );
  });
});

describe('view authoring', () => {
  const emptyView = {
    id: 'audit',
    type: 'container',
    scopeElementId: 'commerce',
    name: 'Audit view',
    items: {},
    placements: {},
    relationshipIds: [],
  } as const;

  it('creates an empty view and deletes it again', () => {
    const created = applyCommand(createProject(), { type: 'create-view', view: emptyView });
    expect(created.project.views['audit']).toMatchObject({ name: 'Audit view' });
    expectValid(created.project);

    const deleted = applyCommand(created.project, { type: 'delete-view', viewId: 'audit' });
    expect(Object.hasOwn(deleted.project.views, 'audit')).toBe(false);
    expectValid(deleted.project);
  });

  it('rejects duplicate ids, missing scopes, and deleting the last view', () => {
    expectCommandError(
      createProject(),
      { type: 'create-view', view: { ...emptyView, id: 'context' } },
      'DUPLICATE_VIEW_ID',
      'View "context" already exists.',
    );
    expectCommandError(
      createProject(),
      { type: 'create-view', view: { ...emptyView, scopeElementId: 'missing' } },
      'ELEMENT_NOT_FOUND',
      'Scope element "missing" does not exist.',
    );

    let lone: ReadonlyProject = createProject();
    for (const viewId of ['containers', 'components']) {
      lone = applyCommand(lone, { type: 'delete-view', viewId }).project;
    }
    expectCommandError(
      lone,
      { type: 'delete-view', viewId: 'context' },
      'LAST_VIEW',
      'A project needs at least one view.',
    );
  });

  it('shows an existing element in a view and hides it again', () => {
    const added = applyCommand(createProject(), {
      type: 'add-view-item',
      viewId: 'containers',
      itemId: 'containers-worker',
      elementId: 'worker',
      placement: { x: 400, y: 100, width: 240, height: 110 },
    });
    expect(added.project.views['containers']?.items['containers-worker']).toEqual({
      id: 'containers-worker',
      elementId: 'worker',
    });
    expectValid(added.project);

    const removed = applyCommand(added.project, {
      type: 'remove-view-item',
      viewId: 'containers',
      itemId: 'containers-worker',
    });
    expect(
      Object.hasOwn(removed.project.views['containers']?.items ?? {}, 'containers-worker'),
    ).toBe(false);
    expect(
      Object.hasOwn(removed.project.views['containers']?.placements ?? {}, 'containers-worker'),
    ).toBe(false);
    expectValid(removed.project);
  });

  it('enforces one occurrence of an element per view', () => {
    expectCommandError(
      createProject(),
      {
        type: 'add-view-item',
        viewId: 'containers',
        itemId: 'containers-api-again',
        elementId: 'api',
        placement: { x: 0, y: 0, width: 240, height: 110 },
      },
      'ELEMENT_ALREADY_IN_VIEW',
      'Element "api" already occurs in view "containers".',
    );
  });

  it('restores a removed view item with its placement on undo', () => {
    const history = applyCommandToHistory(createCommandHistory(createProject()), {
      type: 'remove-view-item',
      viewId: 'containers',
      itemId: 'containers-api',
    });
    const undone = undoCommand(history).project;

    expect(undone.views['containers']?.items['containers-api']).toBeDefined();
    expect(undone.views['containers']?.placements['containers-api']).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
  });
});

describe('view annotations', () => {
  it('adds, replaces, and removes annotations through update-view, undoably', () => {
    const withRegion = applyCommand(createProject(), {
      type: 'update-view',
      viewId: 'containers',
      changes: {
        annotations: {
          'region-net': {
            id: 'region-net',
            kind: 'boundary',
            label: 'Internal network',
            x: 50,
            y: 50,
            width: 400,
            height: 260,
          },
        },
      },
    });
    expect(withRegion.project.views['containers']?.annotations?.['region-net']).toMatchObject({
      kind: 'boundary',
      label: 'Internal network',
    });
    expectValid(withRegion.project);

    const cleared = applyCommand(withRegion.project, {
      type: 'update-view',
      viewId: 'containers',
      changes: { annotations: {} },
    });
    expect(Object.keys(cleared.project.views['containers']?.annotations ?? {})).toHaveLength(0);
  });

  it('rejects an annotation the schema does not allow', () => {
    expectCommandError(
      createProject(),
      {
        type: 'update-view',
        viewId: 'containers',
        changes: {
          annotations: {
            bad: { id: 'bad', kind: 'boundary', x: 0, y: 0, width: 1, height: 1 },
          },
        },
      },
      'INVALID_PROJECT',
      'View is invalid',
    );
  });
});

describe('applyCommands batches', () => {
  it('matches sequential applyCommand results exactly', () => {
    const batch: DomainCommand[] = [
      { type: 'update-element', elementId: 'api', changes: { name: 'Gateway API' } },
      { type: 'delete-relationship', relationshipId: 'shopper-uses-commerce' },
    ];
    const sequential = batch.reduce<ReadonlyProject>(
      (current, command) => applyCommand(current, command).project,
      createProject(),
    );

    const batched = applyCommands(createProject(), batch).project;

    expect(batched).toEqual(sequential);
    expectValid(batched);
  });

  it('is atomic: a failure mid-batch leaves nothing to observe', () => {
    const before = createProject();
    const snapshot = structuredClone(before);

    expect(() =>
      applyCommands(before, [
        { type: 'update-element', elementId: 'api', changes: { name: 'Renamed' } },
        { type: 'delete-element', elementId: 'missing' },
      ]),
    ).toThrowError(DomainCommandError);
    expect(before).toEqual(snapshot);
  });

  it('lets a later command build on an earlier one in the same batch', () => {
    const result = applyCommands(createProject(), [
      {
        type: 'create-element',
        element: element({ id: 'search', kind: 'container', parentId: 'commerce', name: 'Search' }),
      },
      {
        type: 'create-relationship',
        relationship: relationship({
          id: 'api-uses-search',
          sourceId: 'api',
          targetId: 'search',
          name: 'Queries',
        }),
      },
    ]).project;

    expect(result.relationships['api-uses-search']).toMatchObject({ targetId: 'search' });
    expectValid(result);
  });
});

describe('command history', () => {
  const deterministicCases: readonly {
    name: string;
    command: DomainCommand;
    verifyNext?: (project: ReadonlyProject) => void;
  }[] = [
    {
      name: 'create-element',
      command: {
        type: 'create-element',
        element: element({ id: 'new-system', kind: 'softwareSystem', name: 'New system' }),
      },
      verifyNext: (project) => {
        expect(project.elements['new-system']?.name).toBe('New system');
      },
    },
    {
      name: 'update-element',
      command: {
        type: 'update-element',
        elementId: 'pricing',
        changes: { name: 'Pricing Engine', tags: ['critical'] },
      },
      verifyNext: (project) => {
        expect(project.elements.pricing?.name).toBe('Pricing Engine');
      },
    },
    {
      name: 'delete-element with destructive cascade',
      command: { type: 'delete-element', elementId: 'analytics', cascade: true },
      verifyNext: (project) => {
        for (const elementId of ['analytics', 'worker', 'adapter']) {
          expect(project.elements[elementId]).toBeUndefined();
        }
        expect(project.relationships['adapter-calls-pricing']).toBeUndefined();
        expect(project.views.context?.relationshipIds).not.toContain('adapter-calls-pricing');
        for (const itemId of ['context-analytics', 'context-worker', 'context-adapter']) {
          expect(project.views.context?.items[itemId]).toBeUndefined();
          expect(project.views.context?.placements[itemId]).toBeUndefined();
        }
      },
    },
    {
      name: 'reparent-element',
      command: { type: 'reparent-element', elementId: 'pricing', parentId: 'worker' },
      verifyNext: (project) => {
        expect(project.elements.pricing).toMatchObject({ parentId: 'worker' });
      },
    },
    {
      name: 'create-relationship',
      command: {
        type: 'create-relationship',
        relationship: relationship({
          id: 'pricing-calls-adapter',
          sourceId: 'pricing',
          targetId: 'adapter',
          name: 'Calls adapter',
        }),
      },
      verifyNext: (project) => {
        expect(project.relationships['pricing-calls-adapter']).toMatchObject({
          sourceId: 'pricing',
          targetId: 'adapter',
        });
      },
    },
    {
      name: 'move-view-items',
      command: {
        type: 'move-view-items',
        viewId: 'context',
        moves: [
          { itemId: 'context-shopper', x: 25, y: 50 },
          { itemId: 'context-commerce', x: 275, y: 75 },
        ],
      },
      verifyNext: (project) => {
        expect(project.views.context?.placements['context-shopper']).toMatchObject({
          x: 25,
          y: 50,
        });
      },
    },
    {
      name: 'update-view',
      command: {
        type: 'update-view',
        viewId: 'context',
        changes: { name: 'System landscape', description: 'Updated safely.' },
      },
      verifyNext: (project) => {
        expect(project.views.context).toMatchObject({
          name: 'System landscape',
          description: 'Updated safely.',
        });
      },
    },
  ];

  it.each(deterministicCases)(
    'produces deterministic patches and exact one-step undo/redo for $name',
    ({ command, verifyNext }) => {
      const project = createProject();
      const original = structuredClone(project);
      const first = applyCommand(project, command);
      const second = applyCommand(project, command);

      expect(first.patches).toEqual(second.patches);
      expect(first.inversePatches).toEqual(second.inversePatches);
      expect(first.project).toEqual(second.project);
      expect(project).toEqual(original);
      verifyNext?.(first.project);
      expectValid(first.project);

      const applied = applyCommandToHistory(createCommandHistory(project), command);
      expect(applied.project).toEqual(first.project);
      expect(applied.undoStack).toHaveLength(1);
      expect(applied.redoStack).toHaveLength(0);
      expectValid(applied.project);

      const undone = undoCommand(applied);
      expect(undone.project).toEqual(original);
      expect(undone.undoStack).toHaveLength(0);
      expect(undone.redoStack).toHaveLength(1);
      expectValid(undone.project);

      const redone = redoCommand(undone);
      expect(redone.project).toEqual(first.project);
      expect(redone.undoStack).toHaveLength(1);
      expect(redone.redoStack).toHaveLength(0);
      expectValid(redone.project);
    },
  );

  it('snapshots and deeply freezes the source project at history creation', () => {
    const source = createProject();
    const expected = structuredClone(source);
    const history = createCommandHistory(source);

    source.name = 'Mutated source project';
    const sourceApi = source.elements.api;
    if (sourceApi === undefined) {
      throw new Error('Expected the source API element.');
    }
    sourceApi.name = 'Mutated source API';
    (source.views.context?.relationshipIds as unknown as string[]).push('source-only-mutation');

    expect(source.name).toBe('Mutated source project');
    expect(history.project).toEqual(expected);
    expect(history.project).not.toBe(source);
    expectDeepFrozen(history);

    attemptMutation(() => {
      (history.project as unknown as { name: string }).name = 'Poisoned history';
    });
    attemptMutation(() => {
      (history.project.views.context?.relationshipIds as unknown as string[]).push('poison');
    });
    attemptMutation(() => {
      (history.undoStack as unknown as unknown[]).push({});
    });

    expect(history.project).toEqual(expected);
    expect(history.undoStack).toEqual([]);
  });

  it('snapshots and deeply freezes commands, patches, stacks, and every undo/redo state', () => {
    const source = createProject();
    const initial = createCommandHistory(source);
    const command = {
      type: 'create-element' as const,
      element: {
        ...element({ id: 'mutable', kind: 'softwareSystem', name: 'Mutable input' }),
        tags: ['original'],
        properties: { ownership: { team: 'checkout' } },
      },
    };
    const directResult = applyCommand(source, command);
    const expectedDirectResult = structuredClone(directResult);
    const applied = applyCommandToHistory(initial, command);
    const expectedProject = structuredClone(applied.project);
    const expectedEntry = structuredClone(applied.undoStack[0]);

    command.element.name = 'Mutated command';
    command.element.tags.push('mutated');
    command.element.properties.ownership = { team: 'mutated' };
    expect(command.element.name).toBe('Mutated command');

    attemptMutation(() => {
      (directResult.patches as unknown as unknown[]).push({});
    });
    attemptMutation(() => {
      (directResult.patches[0]?.path as unknown as (string | number)[]).push('poison');
    });
    attemptMutation(() => {
      (
        directResult.project.elements.mutable as unknown as {
          name: string;
        }
      ).name = 'Poisoned direct result';
    });
    expect(directResult).toEqual(expectedDirectResult);
    expectDeepFrozen(directResult);

    const exposedEntry = applied.undoStack[0];
    if (exposedEntry === undefined) {
      throw new Error('Expected one history entry.');
    }
    attemptMutation(() => {
      (applied.undoStack as unknown as unknown[]).push({});
    });
    attemptMutation(() => {
      (
        exposedEntry.command as unknown as {
          element: { name: string };
        }
      ).element.name = 'Poisoned command';
    });
    attemptMutation(() => {
      (exposedEntry.patches as unknown as unknown[]).length = 0;
    });
    attemptMutation(() => {
      (exposedEntry.patches[0]?.path as unknown as (string | number)[]).push('poison');
    });
    attemptMutation(() => {
      (exposedEntry.inversePatches as unknown as unknown[]).push({
        op: 'remove',
        path: ['elements', 'mutable'],
      });
    });
    attemptMutation(() => {
      (
        applied.project.elements.mutable as unknown as {
          name: string;
        }
      ).name = 'Poisoned project';
    });

    expect(applied.project).toEqual(expectedProject);
    expect(applied.undoStack).toHaveLength(1);
    expect(applied.undoStack[0]).toEqual(expectedEntry);
    expectDeepFrozen(applied);

    const undone = undoCommand(applied);
    expect(undone.project).toEqual(initial.project);
    expectDeepFrozen(undone);

    const redone = redoCommand(undone);
    expect(redone.project).toEqual(expectedProject);
    expect(redone.undoStack[0]).toEqual(expectedEntry);
    expectDeepFrozen(redone);
  });

  it('undoes and redoes commands end-to-end and clears redo after a new command', () => {
    const project = createProject();
    const initialHistory = createCommandHistory(project);
    const afterCreate = applyCommandToHistory(initialHistory, {
      type: 'create-element',
      element: element({ id: 'new-system', kind: 'softwareSystem', name: 'New system' }),
    });
    const afterUpdate = applyCommandToHistory(afterCreate, {
      type: 'update-element',
      elementId: 'new-system',
      changes: { name: 'Renamed system' },
    });

    expect(afterUpdate.project.elements['new-system']?.name).toBe('Renamed system');
    expect(afterUpdate.undoStack).toHaveLength(2);

    const undoUpdate = undoCommand(afterUpdate);
    expect(undoUpdate.project.elements['new-system']?.name).toBe('New system');
    expect(undoUpdate.redoStack).toHaveLength(1);
    expectValid(undoUpdate.project);

    const undoCreate = undoCommand(undoUpdate);
    expect(undoCreate.project).toEqual(project);
    expect(undoCreate.redoStack).toHaveLength(2);
    expectValid(undoCreate.project);

    const redoCreate = redoCommand(undoCreate);
    const redoUpdate = redoCommand(redoCreate);
    expect(redoUpdate.project).toEqual(afterUpdate.project);
    expect(redoUpdate.undoStack).toHaveLength(2);
    expect(redoUpdate.redoStack).toHaveLength(0);
    expectValid(redoUpdate.project);

    const branched = applyCommandToHistory(undoUpdate, {
      type: 'update-element',
      elementId: 'new-system',
      changes: { name: 'Branched name' },
    });
    expect(branched.redoStack).toHaveLength(0);
    expect(branched.project.elements['new-system']?.name).toBe('Branched name');
  });

  it('preserves the exact history and redo branch for empty and equal-value commands', () => {
    const initial = createCommandHistory(createProject());
    const applied = applyCommandToHistory(initial, {
      type: 'update-element',
      elementId: 'pricing',
      changes: { name: 'Pricing Engine' },
    });
    const undone = undoCommand(applied);
    const project = undone.project;
    const undoStack = undone.undoStack;
    const redoStack = undone.redoStack;

    const emptyMove = {
      type: 'move-view-items',
      viewId: 'context',
      moves: [],
    } as const;
    expect(applyCommand(undone.project, emptyMove)).toMatchObject({
      patches: [],
      inversePatches: [],
    });
    const afterEmptyMove = applyCommandToHistory(undone, emptyMove);
    expect(afterEmptyMove).toBe(undone);
    expect(afterEmptyMove.project).toBe(project);
    expect(afterEmptyMove.undoStack).toBe(undoStack);
    expect(afterEmptyMove.redoStack).toBe(redoStack);

    const equalUpdate = {
      type: 'update-element',
      elementId: 'pricing',
      changes: { name: 'Pricing' },
    } as const;
    expect(applyCommand(afterEmptyMove.project, equalUpdate)).toMatchObject({
      patches: [],
      inversePatches: [],
    });
    const afterEqualUpdate = applyCommandToHistory(afterEmptyMove, equalUpdate);
    expect(afterEqualUpdate).toBe(undone);
    expect(afterEqualUpdate.project).toBe(project);
    expect(afterEqualUpdate.undoStack).toBe(undoStack);
    expect(afterEqualUpdate.redoStack).toBe(redoStack);

    const redone = redoCommand(afterEqualUpdate);
    expect(redone.project.elements.pricing?.name).toBe('Pricing Engine');
    expect(redone.redoStack).toHaveLength(0);
  });

  it('preserves the exact history and redo branch when reparenting to the current parent', () => {
    const initial = createCommandHistory(createProject());
    const applied = applyCommandToHistory(initial, {
      type: 'update-element',
      elementId: 'pricing',
      changes: { name: 'Pricing Engine' },
    });
    const undone = undoCommand(applied);
    const project = undone.project;
    const undoStack = undone.undoStack;
    const redoStack = undone.redoStack;
    const sameParent = {
      type: 'reparent-element',
      elementId: 'pricing',
      parentId: 'api',
    } as const;

    expect(applyCommand(project, sameParent)).toMatchObject({
      patches: [],
      inversePatches: [],
    });
    const afterSameParent = applyCommandToHistory(undone, sameParent);
    expect(afterSameParent).toBe(undone);
    expect(afterSameParent.project).toBe(project);
    expect(afterSameParent.undoStack).toBe(undoStack);
    expect(afterSameParent.redoStack).toBe(redoStack);

    const redone = redoCommand(afterSameParent);
    expect(redone.project.elements.pricing?.name).toBe('Pricing Engine');
    expect(redone.redoStack).toHaveLength(0);
  });
});

describe('runtime command boundary', () => {
  it('rejects an unknown runtime discriminant with a stable domain error', () => {
    const project = createProject();
    const unknownCommand = JSON.parse(
      '{"type":"rename-element","elementId":"pricing","name":"Renamed"}',
    ) as DomainCommand;

    expectCommandError(
      project,
      unknownCommand,
      'INVALID_COMMAND',
      'Invalid command type "rename-element".',
    );
  });
});

describe('prototype-key record IDs', () => {
  it('treats constructor as an own key for create, lookup, move, and delete paths', () => {
    const project = createProject();
    expect(Object.hasOwn(project.elements, 'constructor')).toBe(false);
    expectCommandError(
      project,
      { type: 'update-element', elementId: 'constructor', changes: { name: 'Not inherited' } },
      'ELEMENT_NOT_FOUND',
      'Element "constructor" does not exist.',
    );
    expectCommandError(
      project,
      {
        type: 'move-view-items',
        viewId: 'constructor',
        moves: [{ itemId: 'constructor', x: 1, y: 2 }],
      },
      'VIEW_NOT_FOUND',
      'View "constructor" does not exist.',
    );

    const created = applyCommand(project, {
      type: 'create-element',
      element: element({
        id: 'constructor',
        kind: 'softwareSystem',
        name: 'Constructor System',
      }),
    });
    expect(Object.hasOwn(created.project.elements, 'constructor')).toBe(true);
    expect(created.project.elements.constructor?.name).toBe('Constructor System');

    const updated = applyCommand(created.project, {
      type: 'update-element',
      elementId: 'constructor',
      changes: { name: 'Updated Constructor System' },
    });
    expect(updated.project.elements.constructor?.name).toBe('Updated Constructor System');

    const projectWithPrototypeKeys = structuredClone(updated.project);
    const prototypeView = {
      id: 'constructor',
      type: 'context' as const,
      scopeElementId: 'commerce',
      name: 'Prototype-key view',
      items: {},
      placements: {},
      relationshipIds: [],
    };
    Object.defineProperty(prototypeView.items, 'constructor', {
      configurable: true,
      enumerable: true,
      value: { id: 'constructor', elementId: 'constructor' },
      writable: true,
    });
    Object.defineProperty(prototypeView.placements, 'constructor', {
      configurable: true,
      enumerable: true,
      value: { x: 10, y: 20, width: 160, height: 80 },
      writable: true,
    });
    Object.defineProperty(projectWithPrototypeKeys.views, 'constructor', {
      configurable: true,
      enumerable: true,
      value: prototypeView,
      writable: true,
    });
    expectValid(projectWithPrototypeKeys);

    const moved = applyCommand(projectWithPrototypeKeys, {
      type: 'move-view-items',
      viewId: 'constructor',
      moves: [{ itemId: 'constructor', x: 30, y: 40 }],
    });
    expect(Object.hasOwn(moved.project.views, 'constructor')).toBe(true);
    const movedPrototypeView = Object.getOwnPropertyDescriptor(moved.project.views, 'constructor')
      ?.value as { items: object; placements: object } | undefined;
    expect(Object.hasOwn(movedPrototypeView?.items ?? {}, 'constructor')).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(movedPrototypeView?.placements ?? {}, 'constructor')?.value,
    ).toMatchObject({ x: 30, y: 40 });

    const deleted = applyCommand(moved.project, {
      type: 'delete-element',
      elementId: 'constructor',
    });
    expect(Object.hasOwn(deleted.project.elements, 'constructor')).toBe(false);
    const deletedPrototypeView = Object.getOwnPropertyDescriptor(
      deleted.project.views,
      'constructor',
    )?.value as { items: object; placements: object } | undefined;
    expect(Object.hasOwn(deletedPrototypeView?.items ?? {}, 'constructor')).toBe(false);
    expect(Object.hasOwn(deletedPrototypeView?.placements ?? {}, 'constructor')).toBe(false);
    expectValid(deleted.project);
  });
});
