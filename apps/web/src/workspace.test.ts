import { applyCommand, createCommandHistory } from '@cd3/domain';
import { describe, expect, it } from 'vitest';

import { getWorkspaceProjection3D, getWorkspaceView, project } from './workspace';

const expectedCounts = {
  'system-context': { elements: 5, relationships: 4 },
  'core-containers': { elements: 12, relationships: 12 },
  'order-components': { elements: 9, relationships: 8 },
} as const;
const parityProject = createCommandHistory(project).project;

function proxyFrozenTarget<T extends object>(backing: T): T {
  return new Proxy(Object.freeze({}), {
    get: (_target, property) => Reflect.get(backing, property),
  }) as T;
}

function freezeDataGraph<T>(value: T, visited = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return value;
  }

  visited.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      freezeDataGraph(descriptor.value, visited);
    }
  }
  return Object.freeze(value);
}

describe('workspace view projections', () => {
  it.each(Object.entries(expectedCounts))(
    'keeps compiler, 2D, and separately derived 3D semantic IDs in parity for %s',
    (viewId, counts) => {
      const workspaceView = getWorkspaceView(parityProject, viewId);
      const threeD = getWorkspaceProjection3D(parityProject, viewId);
      const compiledElementIds = workspaceView.compiled.items.map((item) => item.elementId);
      const compiledRelationshipIds = workspaceView.compiled.relationships.map(
        (relationship) => relationship.relationshipId,
      );

      expect(workspaceView.compiled.items).toHaveLength(counts.elements);
      expect(workspaceView.compiled.relationships).toHaveLength(counts.relationships);
      expect(workspaceView.twoD.nodes.map((node) => node.elementId)).toEqual(compiledElementIds);
      expect(threeD.nodes.map((node) => node.elementId)).toEqual(compiledElementIds);
      expect(workspaceView.twoD.edges.map((edge) => edge.relationshipId)).toEqual(
        compiledRelationshipIds,
      );
      expect(threeD.edges.map((edge) => edge.relationshipId)).toEqual(compiledRelationshipIds);
      expect(workspaceView.twoD.warnings).toBe(workspaceView.compiled.warnings);
      expect(threeD.warnings).toBe(workspaceView.compiled.warnings);
    },
  );

  it('memoizes immutable projections by project identity and view', () => {
    const immutableProject = createCommandHistory(project).project;
    const first = getWorkspaceView(immutableProject, 'core-containers');
    const second = getWorkspaceView(immutableProject, 'core-containers');
    const firstThreeD = getWorkspaceProjection3D(immutableProject, 'core-containers');
    const secondThreeD = getWorkspaceProjection3D(immutableProject, 'core-containers');

    expect(second).toBe(first);
    expect(secondThreeD).toBe(firstThreeD);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.twoD.viewId).toBe(immutableProject.views['core-containers']?.id);
    expect(firstThreeD.policy).toEqual(immutableProject.threeD.policy);
  });

  it('recomputes a mutable same-identity 2D projection after a nested placement changes', () => {
    const mutableProject = structuredClone(project);
    const mutableView = mutableProject.views['core-containers'];
    if (mutableView === undefined) {
      throw new Error('The fixture must include the core-containers view.');
    }
    const first = getWorkspaceView(mutableProject, 'core-containers');
    const firstOrderNode = first.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    mutableView.placements['core-containers-item-orders'] = {
      x: 1_234,
      y: 432,
      width: 240,
      height: 130,
    };

    const updated = getWorkspaceView(mutableProject, 'core-containers');
    const updatedOrderNode = updated.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(updated).not.toBe(first);
    expect(firstOrderNode).toMatchObject({ x: 980, y: 255 });
    expect(updatedOrderNode).toMatchObject({ x: 1_234, y: 432 });
  });

  it('recomputes a proxy-backed same-identity 2D projection after its backing placement changes', () => {
    const backingProject = structuredClone(project);
    const proxyProject = proxyFrozenTarget(backingProject);
    const backingView = backingProject.views['core-containers'];
    if (backingView === undefined) {
      throw new Error('The fixture must include the core-containers view.');
    }
    const first = getWorkspaceView(proxyProject, 'core-containers');
    const firstOrderNode = first.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    backingView.placements['core-containers-item-orders'] = {
      x: 1_234,
      y: 432,
      width: 240,
      height: 130,
    };

    const updated = getWorkspaceView(proxyProject, 'core-containers');
    const updatedOrderNode = updated.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(updated).not.toBe(first);
    expect(firstOrderNode).toMatchObject({ x: 980, y: 255 });
    expect(updatedOrderNode).toMatchObject({ x: 1_234, y: 432 });
  });

  it('recomputes a shallow-root-frozen same-identity 3D projection after nested inputs change', () => {
    const shallowFrozenProject = Object.freeze(structuredClone(project));
    const shallowFrozenView = shallowFrozenProject.views['core-containers'];
    if (shallowFrozenView === undefined) {
      throw new Error('The fixture must include the core-containers view.');
    }
    const first = getWorkspaceProjection3D(shallowFrozenProject, 'core-containers');
    const firstOrderNode = first.nodes.find((node) => node.id === 'core-containers-item-orders');

    shallowFrozenView.placements['core-containers-item-orders'] = {
      x: 1_234,
      y: 432,
      width: 240,
      height: 130,
    };
    shallowFrozenProject.threeD.policy.coordinateScale = 0.03;
    shallowFrozenProject.threeD.policy.elevationStep = 2.25;

    const updated = getWorkspaceProjection3D(shallowFrozenProject, 'core-containers');
    const updatedOrderNode = updated.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(updated).not.toBe(first);
    expect(first.policy).toMatchObject({ coordinateScale: 0.02, elevationStep: 0 });
    expect(firstOrderNode?.position).toEqual([19.6, 0, 5.1]);
    expect(updated.policy).toMatchObject({ coordinateScale: 0.03, elevationStep: 2.25 });
    expect(updatedOrderNode?.position).toEqual([37.02, 2.25, 12.96]);
  });

  it('recomputes a nested-proxy-backed same-identity 3D projection after backing inputs change', () => {
    const backingProject = structuredClone(project);
    const proxyBackedProject = structuredClone(project);
    const backingView = backingProject.views['core-containers'];
    if (backingView === undefined) {
      throw new Error('The fixture must include the core-containers view.');
    }
    proxyBackedProject.views['core-containers'] = proxyFrozenTarget(backingView);
    proxyBackedProject.threeD = proxyFrozenTarget(backingProject.threeD);
    freezeDataGraph(proxyBackedProject);

    const first = getWorkspaceProjection3D(proxyBackedProject, 'core-containers');
    const firstOrderNode = first.nodes.find((node) => node.id === 'core-containers-item-orders');

    backingView.placements['core-containers-item-orders'] = {
      x: 1_234,
      y: 432,
      width: 240,
      height: 130,
    };
    backingProject.threeD.policy.coordinateScale = 0.03;
    backingProject.threeD.policy.elevationStep = 2.25;

    const updated = getWorkspaceProjection3D(proxyBackedProject, 'core-containers');
    const updatedOrderNode = updated.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(updated).not.toBe(first);
    expect(first.policy).toMatchObject({ coordinateScale: 0.02, elevationStep: 0 });
    expect(firstOrderNode?.position).toEqual([19.6, 0, 5.1]);
    expect(updated.policy).toMatchObject({ coordinateScale: 0.03, elevationStep: 2.25 });
    expect(updatedOrderNode?.position).toEqual([37.02, 2.25, 12.96]);
  });

  it('projects a moved command result without mutating or invalidating the old project cache', () => {
    const originalProject = createCommandHistory(project).project;
    const original = getWorkspaceView(originalProject, 'core-containers');
    const originalThreeD = getWorkspaceProjection3D(originalProject, 'core-containers');
    const originalOrderNode = original.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const originalOrderNode3D = originalThreeD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const result = applyCommand(originalProject, {
      type: 'move-view-items',
      viewId: 'core-containers',
      moves: [{ itemId: 'core-containers-item-orders', x: 1_234, y: 432 }],
    });

    const moved = getWorkspaceView(result.project, 'core-containers');
    const movedOrderNode = moved.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const movedThreeD = getWorkspaceProjection3D(result.project, 'core-containers');
    const movedOrderNode3D = movedThreeD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(result.project).not.toBe(originalProject);
    expect(moved).not.toBe(original);
    expect(movedOrderNode).toMatchObject({ x: 1_234, y: 432 });
    expect(movedOrderNode3D?.position).toEqual([24.68, 0, 8.64]);
    expect(getWorkspaceView(result.project, 'core-containers')).toBe(moved);
    expect(getWorkspaceProjection3D(result.project, 'core-containers')).toBe(movedThreeD);
    expect(getWorkspaceView(originalProject, 'core-containers')).toBe(original);
    expect(getWorkspaceProjection3D(originalProject, 'core-containers')).toBe(originalThreeD);
    expect(originalOrderNode).toMatchObject({ x: 980, y: 255 });
    expect(originalOrderNode3D?.position).toEqual([19.6, 0, 5.1]);
  });

  it('rejects unsupported workspace views predictably', () => {
    const getBase = () => getWorkspaceView(project, 'missing-view');
    const getThreeD = () => getWorkspaceProjection3D(project, 'missing-view');

    expect(getBase).toThrowError(RangeError);
    expect(getBase).toThrow('Unsupported workspace view "missing-view".');
    expect(getThreeD).toThrowError(RangeError);
    expect(getThreeD).toThrow('Unsupported workspace view "missing-view".');
  });
});
