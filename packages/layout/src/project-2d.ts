import { deepFreeze } from './immutable.js';
import type { CompiledView, ProjectedView2D, ViewEdge2D, ViewNode2D } from './types.js';

/** Projects a compiled view to plain 2D graph DTOs without renderer-specific types. */
export function projectViewTo2D(compiled: CompiledView): ProjectedView2D {
  const nodes = compiled.items.map((item): ViewNode2D => {
    const { x, y, width, height } = item.placement;
    return {
      ...item,
      id: item.viewItemId,
      x,
      y,
      width,
      height,
      position: { x, y },
    };
  });
  const edges = compiled.relationships.map((relationship): ViewEdge2D => ({
    ...relationship,
    id: relationship.relationshipId,
    source: relationship.sourceViewItemId,
    target: relationship.targetViewItemId,
  }));

  const projected: ProjectedView2D = {
    projectId: compiled.projectId,
    viewId: compiled.viewId,
    type: compiled.type,
    scopeElementId: compiled.scopeElementId,
    name: compiled.name,
    ...(compiled.description === undefined ? {} : { description: compiled.description }),
    nodes,
    edges,
    warnings: compiled.warnings,
  };
  return deepFreeze(projected);
}
