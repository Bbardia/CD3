import { readFile } from 'node:fs/promises';
import { ProjectSchema } from '@cd3/domain';
import { describe, expect, it } from 'vitest';
import { generateSyntheticProject, northstarCommerceProject } from '../src/index.js';

const syntheticSizes = [25, 100, 250] as const;

function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

describe('Northstar Commerce', () => {
  it('validates against the canonical project schema', () => {
    expect(ProjectSchema.parse(northstarCommerceProject)).toEqual(northstarCommerceProject);
  });

  it('contains a polished minimum C4 model and rich metadata', () => {
    const elements = Object.values(northstarCommerceProject.elements);
    const people = elements.filter((element) => element.kind === 'person');
    const systems = elements.filter((element) => element.kind === 'softwareSystem');
    const coreContainers = elements.filter(
      (element) => element.kind === 'container' && element.parentId === 'northstar-commerce',
    );
    const orderComponents = elements.filter(
      (element) => element.kind === 'component' && element.parentId === 'order-service',
    );

    expect(northstarCommerceProject.name).toBe('Northstar Commerce');
    expect(people.length).toBeGreaterThanOrEqual(2);
    expect(systems.length).toBeGreaterThanOrEqual(3);
    expect(systems.some((system) => system.tags.includes('external'))).toBe(true);
    expect(coreContainers.length).toBeGreaterThanOrEqual(6);
    expect(orderComponents.length).toBeGreaterThanOrEqual(4);
    expect(elements.every((element) => element.description !== undefined)).toBe(true);
    expect(elements.every((element) => element.tags.length > 0)).toBe(true);
    expect(elements.some((element) => element.technology !== undefined)).toBe(true);
    expect(northstarCommerceProject.elements['northstar-commerce']?.properties).toEqual(
      expect.objectContaining({
        criticality: 'high',
        capabilities: expect.any(Array),
      }),
    );

    const externalReferences = elements.flatMap((element) => element.externalRefs);
    expect(externalReferences.length).toBeGreaterThan(0);
    expect(externalReferences.every((reference) => reference.url.includes('example'))).toBe(true);
  });

  it('models directional synchronous, asynchronous, cross-boundary, and component interactions', () => {
    const relationships = Object.values(northstarCommerceProject.relationships);

    expect(new Set(relationships.map((relationship) => relationship.interaction))).toEqual(
      new Set(['synchronous', 'asynchronous']),
    );
    expect(northstarCommerceProject.relationships['shopper-uses-commerce']).toEqual(
      expect.objectContaining({ sourceId: 'shopper', targetId: 'northstar-commerce' }),
    );
    expect(northstarCommerceProject.relationships['commerce-authorizes-payment']).toEqual(
      expect.objectContaining({
        sourceId: 'northstar-commerce',
        targetId: 'constellation-payments',
      }),
    );
    expect(northstarCommerceProject.relationships['storefront-calls-edge']).toEqual(
      expect.objectContaining({ sourceId: 'storefront-web', targetId: 'edge-api' }),
    );
    expect(northstarCommerceProject.relationships['order-publishes-order-placed']).toEqual(
      expect.objectContaining({ sourceId: 'order-service', interaction: 'asynchronous' }),
    );
    expect(northstarCommerceProject.relationships['order-app-applies-pricing']).toEqual(
      expect.objectContaining({ sourceId: 'order-application', targetId: 'pricing-policy' }),
    );
    expect(
      relationships.every((relationship) => relationship.sourceId !== relationship.targetId),
    ).toBe(true);
  });

  it('provides useful context, container, and component views plus orthographic 3D metadata', () => {
    const views = Object.values(northstarCommerceProject.views);

    expect(new Set(views.map((view) => view.type))).toEqual(
      new Set(['context', 'container', 'component']),
    );
    for (const view of views) {
      expect(sortedKeys(view.items)).toEqual(sortedKeys(view.placements));
      expect(
        Object.values(view.items).every(
          (item) =>
            String(item.id) !== String(item.elementId) && item.id.startsWith(`${view.id}-item-`),
        ),
      ).toBe(true);
      expect(
        new Set(Object.values(view.placements).map(({ x, y }) => `${String(x)},${String(y)}`)).size,
      ).toBe(Object.keys(view.placements).length);
    }

    expect(Object.keys(northstarCommerceProject.views['system-context']?.items ?? {})).toHaveLength(
      5,
    );
    expect(
      Object.keys(northstarCommerceProject.views['core-containers']?.items ?? {}).length,
    ).toBeGreaterThanOrEqual(10);
    expect(northstarCommerceProject.threeD.policy.defaultProjection).toBe('orthographic');
    expect(Object.values(northstarCommerceProject.threeD.bookmarks).length).toBeGreaterThan(0);
    expect(
      Object.values(northstarCommerceProject.threeD.bookmarks).some(
        (bookmark) => bookmark.projection === 'orthographic',
      ),
    ).toBe(true);
  });

  it('matches the committed stable, pretty-printed JSON artifact byte-for-byte', async () => {
    const fixtureUrl = new URL('../projects/northstar-commerce.c4.json', import.meta.url);
    const committedJson = await readFile(fixtureUrl, 'utf8');
    const validatedProject = ProjectSchema.parse(northstarCommerceProject);

    expect(committedJson).toBe(`${JSON.stringify(validatedProject, null, 2)}\n`);
    expect(JSON.parse(committedJson)).toEqual(validatedProject);
  });
});

describe('generateSyntheticProject', () => {
  it.each(syntheticSizes)('validates with exactly %i visible elements', (visibleElements) => {
    const project = generateSyntheticProject({ visibleElements });
    const view = project.views['synthetic-context'];

    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(Object.keys(project.elements)).toHaveLength(visibleElements);
    expect(Object.keys(view?.items ?? {})).toHaveLength(visibleElements);
    expect(Object.keys(view?.placements ?? {})).toHaveLength(visibleElements);
    expect(Object.keys(project.relationships).length).toBeGreaterThanOrEqual(visibleElements - 1);
    expect(
      Object.values(project.relationships).every(
        (relationship) => relationship.sourceId !== relationship.targetId,
      ),
    ).toBe(true);
    expect(
      Object.values(view?.placements ?? {}).every(
        (placement) =>
          Number.isFinite(placement.x) &&
          Number.isFinite(placement.y) &&
          placement.x % 240 === 0 &&
          placement.y % 140 === 0,
      ),
    ).toBe(true);
  });

  it('is repeatable and keeps shared IDs and placements stable across fixture sizes', () => {
    const first = generateSyntheticProject({ visibleElements: 100 });
    const repeated = generateSyntheticProject({ visibleElements: 100 });
    const smaller = generateSyntheticProject({ visibleElements: 25 });

    expect(repeated).toEqual(first);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect(sortedKeys(smaller.elements)).toEqual(sortedKeys(first.elements).slice(0, 25));

    const firstView = first.views['synthetic-context'];
    const smallerView = smaller.views['synthetic-context'];
    for (const itemId of Object.keys(smallerView?.items ?? {})) {
      expect(smallerView?.placements[itemId]).toEqual(firstView?.placements[itemId]);
    }
  });

  it('never serializes private home paths in sample or performance fixtures', () => {
    const serialized = JSON.stringify({
      northstarCommerceProject,
      performance: syntheticSizes.map((visibleElements) =>
        generateSyntheticProject({ visibleElements }),
      ),
    });

    expect(serialized).not.toMatch(/(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)/u);
  });
});
