import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProjectSchema, applyCommand, type ProjectInput } from '@cd3/domain';
import { generateSyntheticProject, northstarCommerceProject } from '@cd3/fixtures';
import { describe, expect, it } from 'vitest';

import {
  compileView,
  projectViewTo2D,
  projectViewTo3D,
  type ProjectedView2D,
} from '../src/index.js';
import { createDeterministicLayoutPreview, layoutViewWithElk } from '../src/elk.js';

function projectionPolicyProject() {
  const input = structuredClone(northstarCommerceProject) as ProjectInput;
  input.views['projection-policy'] = {
    id: 'projection-policy',
    type: 'context',
    scopeElementId: 'northstar-commerce',
    name: 'Endpoint projection policy',
    items: {
      'item-commerce': { id: 'item-commerce', elementId: 'northstar-commerce' },
      'item-edge': { id: 'item-edge', elementId: 'edge-api' },
      'item-orders': { id: 'item-orders', elementId: 'order-service' },
      'item-payments': { id: 'item-payments', elementId: 'constellation-payments' },
    },
    placements: {
      'item-commerce': { x: 10, y: 20, width: 600, height: 400 },
      'item-edge': { x: 60, y: 100, width: 200, height: 100 },
      'item-orders': { x: 320, y: 100, width: 220, height: 120 },
      'item-payments': { x: 760, y: 100, width: 240, height: 100 },
    },
    relationshipIds: [
      'edge-calls-checkout',
      'payment-adapter-calls-payments',
      'order-app-authorizes-payment',
      'shopper-uses-commerce',
    ],
  };
  return ProjectSchema.parse(input);
}

function expectedSyntheticRelationshipCount(elements: number): number {
  return elements - 1 + Math.floor((elements - 1) / 5);
}

describe('compileView', () => {
  it.each(Object.keys(northstarCommerceProject.views).sort())(
    'compiles Northstar view %s with semantic parity',
    (viewId) => {
      const view = northstarCommerceProject.views[viewId];
      expect(view).toBeDefined();

      const compiled = compileView(northstarCommerceProject, viewId);
      expect(compiled.items).toHaveLength(Object.keys(view?.items ?? {}).length);
      expect(compiled.relationships).toHaveLength(view?.relationshipIds.length ?? 0);
      expect(compiled.items.map((item) => item.viewItemId)).toEqual(
        Object.keys(view?.items ?? {}).sort(),
      );
      expect(compiled.relationships.map((relationship) => relationship.relationshipId)).toEqual(
        [...(view?.relationshipIds ?? [])].sort(),
      );
      expect(compiled.warnings).toEqual([]);
    },
  );

  it('retains element metadata, placements, hierarchy, stable keys, and relationship fields', () => {
    const compiled = compileView(northstarCommerceProject, 'core-containers');
    const orders = compiled.items.find((item) => item.elementId === 'order-service');
    const relationship = compiled.relationships.find(
      (candidate) => candidate.relationshipId === 'edge-submits-order',
    );

    expect(orders).toMatchObject({
      viewItemId: 'core-containers-item-orders',
      elementId: 'order-service',
      kind: 'container',
      name: 'Order Service',
      technology: 'Fastify and TypeScript',
      tags: ['container', 'service', 'orders'],
      placement: { x: 980, y: 255, width: 240, height: 130 },
      parentElementId: 'northstar-commerce',
      semanticDepth: 1,
      renderKey: 'view:core-containers:item:core-containers-item-orders',
    });
    expect(relationship).toMatchObject({
      relationshipId: 'edge-submits-order',
      sourceElementId: 'edge-api',
      targetElementId: 'order-service',
      sourceViewItemId: 'core-containers-item-edge',
      targetViewItemId: 'core-containers-item-orders',
      name: 'Submits checkout',
      interaction: 'synchronous',
      technology: 'Internal HTTP',
    });
  });

  it('maps direct endpoints, projects hidden children, warns for omissions, and suppresses projected loops', () => {
    const compiled = compileView(projectionPolicyProject(), 'projection-policy');

    expect(compiled.relationships).toHaveLength(2);
    expect(compiled.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationshipId: 'edge-calls-checkout',
          sourceViewItemId: 'item-edge',
          targetViewItemId: 'item-orders',
          sourceElementId: 'edge-api',
          targetElementId: 'checkout-controller',
          visibleTargetElementId: 'order-service',
        }),
        expect.objectContaining({
          relationshipId: 'payment-adapter-calls-payments',
          sourceViewItemId: 'item-orders',
          targetViewItemId: 'item-payments',
          sourceElementId: 'payment-adapter',
          visibleSourceElementId: 'order-service',
        }),
      ]),
    );
    expect(compiled.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'relationship-endpoint-not-visible',
          relationshipId: 'shopper-uses-commerce',
          endpoint: 'source',
          elementId: 'shopper',
        }),
        expect.objectContaining({
          code: 'projected-self-loop',
          relationshipId: 'order-app-authorizes-payment',
          viewItemId: 'item-orders',
        }),
      ]),
    );
    expect(
      compiled.relationships.some(
        (relationship) => relationship.relationshipId === 'order-app-authorizes-payment',
      ),
    ).toBe(false);
  });

  it('is deterministic, deeply immutable, and never mutates the project', () => {
    const project = projectionPolicyProject();
    const before = JSON.stringify(project);
    const first = compileView(project, 'projection-policy');
    const second = compileView(project, 'projection-policy');

    expect(first).toEqual(second);
    expect(JSON.stringify(project)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(Object.isFrozen(first.items[0]?.placement)).toBe(true);
    expect(Object.isFrozen(first.relationships[0]?.properties)).toBe(true);
  });

  it('rejects an unknown view without changing the project', () => {
    const before = JSON.stringify(northstarCommerceProject);
    expect(() => compileView(northstarCommerceProject, 'missing-view')).toThrow(
      'View "missing-view" does not exist',
    );
    expect(JSON.stringify(northstarCommerceProject)).toBe(before);
  });
});

describe('renderer-neutral projections', () => {
  it('compiles and projects a readonly command result without an adapter or cast', () => {
    const result = applyCommand(northstarCommerceProject, {
      type: 'move-view-items',
      viewId: 'system-context',
      moves: [{ itemId: 'system-context-item-shopper', x: 125, y: 250 }],
    });

    const compiled = compileView(result.project, 'system-context');
    const twoD = projectViewTo2D(compiled);
    const threeD = projectViewTo3D(compiled, result.project.threeD.policy);

    expect(twoD.nodes.find((node) => node.id === 'system-context-item-shopper')).toMatchObject({
      x: 125,
      y: 250,
    });
    expect(
      threeD.nodes.find((node) => node.id === 'system-context-item-shopper')?.position,
    ).toEqual([2.5, 0, 5]);
  });

  it('keeps semantic IDs/counts aligned and derives 2D/3D coordinates and hierarchy elevation', () => {
    const compiled = compileView(northstarCommerceProject, 'core-containers');
    const twoD = projectViewTo2D(compiled);
    const threeD = projectViewTo3D(compiled, northstarCommerceProject.threeD.policy);
    const orders2D = twoD.nodes.find((node) => node.elementId === 'order-service');
    const orders3D = threeD.nodes.find((node) => node.elementId === 'order-service');

    expect(twoD.nodes).toHaveLength(compiled.items.length);
    expect(threeD.nodes).toHaveLength(compiled.items.length);
    expect(twoD.edges).toHaveLength(compiled.relationships.length);
    expect(threeD.edges).toHaveLength(compiled.relationships.length);
    expect(twoD.edges.map((edge) => edge.relationshipId)).toEqual(
      threeD.edges.map((edge) => edge.relationshipId),
    );
    expect(orders2D).toMatchObject({ x: 980, y: 255, width: 240, height: 130 });
    expect(orders3D?.position).toEqual([19.6, 1.5, 5.1]);
    expect(orders3D?.size[0]).toBeCloseTo(4.8);
    expect(orders3D?.size[2]).toBeCloseTo(2.6);
    expect(threeD.platforms.some((platform) => platform.viewItemId === orders3D?.viewItemId)).toBe(
      true,
    );
    expect(threeD.edges.every((edge) => edge.path.length >= 2)).toBe(true);
  });

  it.each([25, 100, 250])(
    'compiles and projects %i visible synthetic elements with exact counts',
    (visibleElements) => {
      const project = generateSyntheticProject({ visibleElements });
      const compiled = compileView(project, 'synthetic-context');
      const twoD = projectViewTo2D(compiled);
      const threeD = projectViewTo3D(compiled, project.threeD.policy);
      const expectedRelationships = expectedSyntheticRelationshipCount(visibleElements);

      expect(compiled.items).toHaveLength(visibleElements);
      expect(twoD.nodes).toHaveLength(visibleElements);
      expect(threeD.nodes).toHaveLength(visibleElements);
      expect(compiled.relationships).toHaveLength(expectedRelationships);
      expect(twoD.edges).toHaveLength(expectedRelationships);
      expect(threeD.edges).toHaveLength(expectedRelationships);
    },
  );
});

describe('layout adapters', () => {
  it('returns deterministic fallback previews, preserves pins, and retains compound hierarchy', () => {
    const compiled = compileView(projectionPolicyProject(), 'projection-policy');
    const options = { pinnedViewItemIds: ['item-orders'] } as const;
    const before = JSON.stringify(compiled);
    const first = createDeterministicLayoutPreview(compiled, options);
    const second = createDeterministicLayoutPreview(compiled, options);
    const pinned = first.nodes.find((node) => node.viewItemId === 'item-orders');
    const child = first.nodes.find((node) => node.viewItemId === 'item-edge');

    expect(first).toEqual(second);
    expect(pinned).toMatchObject({ x: 320, y: 100 });
    expect(child?.parentViewItemId).toBe('item-commerce');
    expect(JSON.stringify(compiled)).toBe(before);
    expect(first.engine).toBe('deterministic-fallback');
  });

  it.each(['DOWN', 'LEFT', 'RIGHT', 'UP'] as const)(
    'keeps fallback rectangles non-overlapping in the %s direction',
    (direction) => {
      const project = generateSyntheticProject({ visibleElements: 25 });
      const preview = createDeterministicLayoutPreview(compileView(project, 'synthetic-context'), {
        direction,
      });

      for (const [index, node] of preview.nodes.entries()) {
        for (const other of preview.nodes.slice(index + 1)) {
          const separated =
            node.x + node.width <= other.x ||
            other.x + other.width <= node.x ||
            node.y + node.height <= other.y ||
            other.y + other.height <= node.y;
          expect(separated).toBe(true);
        }
      }
    },
  );

  it('does not freeze or mutate caller-owned projected DTOs', () => {
    const projected = structuredClone(
      projectViewTo2D(compileView(northstarCommerceProject, 'core-containers')),
    ) as ProjectedView2D;
    const before = JSON.stringify(projected);

    createDeterministicLayoutPreview(projected);

    expect(JSON.stringify(projected)).toBe(before);
    expect(Object.isFrozen(projected)).toBe(false);
    expect(Object.isFrozen(projected.nodes)).toBe(false);
    expect(Object.isFrozen(projected.nodes[0]?.tags)).toBe(false);
    expect(Object.isFrozen(projected.edges)).toBe(false);
    expect(Object.isFrozen(projected.edges[0]?.properties)).toBe(false);
  });

  it('runs ELK deterministically and restores pinned canonical coordinates', async () => {
    const compiled = compileView(northstarCommerceProject, 'core-containers');
    const options = { pinnedViewItemIds: ['core-containers-item-orders'] } as const;
    const first = await layoutViewWithElk(compiled, options);
    const second = await layoutViewWithElk(compiled, options);
    const pinned = first.nodes.find((node) => node.viewItemId === 'core-containers-item-orders');

    expect(first).toEqual(second);
    expect(first.engine).toBe('elk');
    expect(first.warnings.some((warning) => warning.code === 'elk-failed')).toBe(false);
    expect(pinned).toMatchObject({ x: 980, y: 255, width: 240, height: 130 });
    expect(first.nodes).toHaveLength(compiled.items.length);
    expect(first.edges).toHaveLength(compiled.relationships.length);
  });

  it('falls back deterministically when ELK rejects without mutating input or pins', async () => {
    const projected = structuredClone(
      projectViewTo2D(compileView(northstarCommerceProject, 'core-containers')),
    ) as ProjectedView2D;
    const options = { pinnedViewItemIds: ['core-containers-item-orders'] } as const;
    const rejectingEngine = {
      layout: () => Promise.reject(new Error('forced ELK failure')),
    };
    const before = JSON.stringify(projected);

    const first = await layoutViewWithElk(projected, options, rejectingEngine);
    const second = await layoutViewWithElk(projected, options, rejectingEngine);
    const pinned = first.nodes.find((node) => node.viewItemId === 'core-containers-item-orders');

    expect(first).toEqual(second);
    expect(first.engine).toBe('deterministic-fallback');
    expect(first.warnings).toEqual([
      expect.objectContaining({ code: 'elk-failed', message: expect.stringContaining('forced') }),
    ]);
    expect(pinned).toMatchObject({ x: 980, y: 255 });
    expect(JSON.stringify(projected)).toBe(before);
    expect(Object.isFrozen(projected.nodes)).toBe(false);
  });

  it('falls back when ELK returns an incomplete or non-finite layout', async () => {
    const compiled = compileView(northstarCommerceProject, 'system-context');
    const incompleteEngine = {
      layout: () =>
        Promise.resolve({
          id: 'incomplete',
          children: [{ id: compiled.items[0]?.viewItemId ?? 'missing', x: Number.NaN, y: 0 }],
        }),
    };

    const preview = await layoutViewWithElk(compiled, {}, incompleteEngine);

    expect(preview.engine).toBe('deterministic-fallback');
    expect(preview.warnings[0]).toMatchObject({ code: 'elk-failed' });
    expect(preview.nodes).toHaveLength(compiled.items.length);
  });

  it('keeps layout source free of renderer and browser dependencies', () => {
    const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(sourceRoot, { recursive: true }).filter(
      (entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'),
    );
    const source = files.map((file) => readFileSync(join(sourceRoot, file), 'utf8')).join('\n');

    expect(source).not.toMatch(
      /(?:from\s*|import\s*\()['"](?:react(?:\/|['"])|@xyflow\/|three(?:\/|['"]))/,
    );
    expect(source).not.toMatch(/\b(?:Window|Document|HTMLElement|HTMLCanvasElement|Worker)\b/);
  });
});
