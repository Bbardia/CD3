import { applyCommand } from '@cd3/domain';
import { describe, expect, it } from 'vitest';

import { getWorkspaceProjection3D, getWorkspaceView, project } from './workspace';

const expectedCounts = {
  'system-context': { elements: 5, relationships: 4 },
  'core-containers': { elements: 12, relationships: 12 },
  'order-components': { elements: 9, relationships: 8 },
} as const;

describe('workspace view projections', () => {
  it.each(Object.entries(expectedCounts))(
    'keeps compiler, 2D, and separately derived 3D semantic IDs in parity for %s',
    (viewId, counts) => {
      const workspaceView = getWorkspaceView(project, viewId);
      const threeD = getWorkspaceProjection3D(project, viewId);
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
    const first = getWorkspaceView(project, 'core-containers');
    const second = getWorkspaceView(project, 'core-containers');
    const firstThreeD = getWorkspaceProjection3D(project, 'core-containers');
    const secondThreeD = getWorkspaceProjection3D(project, 'core-containers');

    expect(second).toBe(first);
    expect(secondThreeD).toBe(firstThreeD);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.twoD.viewId).toBe(project.views['core-containers']?.id);
    expect(firstThreeD.policy).toEqual(project.threeD.policy);
  });

  it('projects a moved command result without mutating or invalidating the old project cache', () => {
    const original = getWorkspaceView(project, 'core-containers');
    const originalThreeD = getWorkspaceProjection3D(project, 'core-containers');
    const originalOrderNode = original.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const originalOrderNode3D = originalThreeD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const result = applyCommand(project, {
      type: 'move-view-items',
      viewId: 'core-containers',
      moves: [{ itemId: 'core-containers-item-orders', x: 1_234, y: 432 }],
    });

    const moved = getWorkspaceView(result.project, 'core-containers');
    const movedOrderNode = moved.twoD.nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );
    const movedOrderNode3D = getWorkspaceProjection3D(result.project, 'core-containers').nodes.find(
      (node) => node.id === 'core-containers-item-orders',
    );

    expect(result.project).not.toBe(project);
    expect(moved).not.toBe(original);
    expect(movedOrderNode).toMatchObject({ x: 1_234, y: 432 });
    expect(movedOrderNode3D?.position).toEqual([24.68, 1.5, 8.64]);
    expect(getWorkspaceView(project, 'core-containers')).toBe(original);
    expect(getWorkspaceProjection3D(project, 'core-containers')).toBe(originalThreeD);
    expect(originalOrderNode).toMatchObject({ x: 980, y: 255 });
    expect(originalOrderNode3D?.position).toEqual([19.6, 1.5, 5.1]);
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
