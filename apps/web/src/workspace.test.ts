import { describe, expect, it } from 'vitest';

import { getWorkspaceView, project } from './workspace';

const expectedCounts = {
  'system-context': { elements: 5, relationships: 4 },
  'core-containers': { elements: 12, relationships: 12 },
  'order-components': { elements: 9, relationships: 8 },
} as const;

describe('workspace view projections', () => {
  it.each(Object.entries(expectedCounts))(
    'keeps compiler, 2D, and 3D semantic IDs in parity for %s',
    (viewId, counts) => {
      const workspaceView = getWorkspaceView(viewId);
      const compiledElementIds = workspaceView.compiled.items.map((item) => item.elementId);
      const compiledRelationshipIds = workspaceView.compiled.relationships.map(
        (relationship) => relationship.relationshipId,
      );

      expect(workspaceView.compiled.items).toHaveLength(counts.elements);
      expect(workspaceView.compiled.relationships).toHaveLength(counts.relationships);
      expect(workspaceView.twoD.nodes.map((node) => node.elementId)).toEqual(compiledElementIds);
      expect(workspaceView.threeD.nodes.map((node) => node.elementId)).toEqual(compiledElementIds);
      expect(workspaceView.twoD.edges.map((edge) => edge.relationshipId)).toEqual(
        compiledRelationshipIds,
      );
      expect(workspaceView.threeD.edges.map((edge) => edge.relationshipId)).toEqual(
        compiledRelationshipIds,
      );
      expect(workspaceView.twoD.warnings).toBe(workspaceView.compiled.warnings);
      expect(workspaceView.threeD.warnings).toBe(workspaceView.compiled.warnings);
    },
  );

  it('memoizes one immutable compiled/projection set per canonical view', () => {
    const first = getWorkspaceView('core-containers');
    const second = getWorkspaceView('core-containers');

    expect(second).toBe(first);
    expect(first.twoD.viewId).toBe(project.views['core-containers']?.id);
    expect(first.threeD.policy).toEqual(project.threeD.policy);
  });
});
