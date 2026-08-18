import type { Element, ThreeDPolicy } from '@cd3/domain';

import { deepFreeze } from './immutable.js';
import type {
  CompiledView,
  ProjectedView3D,
  Vector3Tuple,
  ViewEdge3D,
  ViewNode3D,
  ViewPlatform3D,
} from './types.js';

const MAX_ELEVATED_DEPTH = 2;
const NODE_HEIGHT_BY_KIND: Readonly<Record<Element['kind'], number>> = {
  person: 0.55,
  softwareSystem: 0.75,
  container: 0.6,
  component: 0.45,
};

function cleanNumber(value: number): number {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(12));
}

function scale(value: number, coordinateScale: number): number {
  return cleanNumber(value * coordinateScale);
}

function centerAnchor(node: ViewNode3D): Vector3Tuple {
  return [
    cleanNumber(node.position[0] + node.size[0] / 2),
    cleanNumber(node.position[1] + node.size[1] / 2),
    cleanNumber(node.position[2] + node.size[2] / 2),
  ];
}

/** Derives a plain-object 3D scene projection from authoritative 2D placement. */
export function projectViewTo3D(
  compiled: CompiledView,
  policy: Readonly<ThreeDPolicy>,
): ProjectedView3D {
  const nodes = compiled.items.map((item): ViewNode3D => {
    const elevation = cleanNumber(
      Math.min(item.semanticDepth, MAX_ELEVATED_DEPTH) * policy.elevationStep,
    );
    return {
      viewItemId: item.viewItemId,
      elementId: item.elementId,
      kind: item.kind,
      name: item.name,
      ...(item.label === undefined ? {} : { label: item.label }),
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.technology === undefined ? {} : { technology: item.technology }),
      ...(item.color === undefined ? {} : { color: item.color }),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      tags: item.tags,
      ...(item.parentElementId === undefined ? {} : { parentElementId: item.parentElementId }),
      ...(item.parentViewItemId === undefined ? {} : { parentViewItemId: item.parentViewItemId }),
      semanticDepth: item.semanticDepth,
      renderKey: item.renderKey,
      id: item.viewItemId,
      placement2D: item.placement,
      position: [
        scale(item.placement.x, policy.coordinateScale),
        elevation,
        scale(item.placement.y, policy.coordinateScale),
      ],
      size: [
        scale(item.placement.width, policy.coordinateScale),
        NODE_HEIGHT_BY_KIND[item.kind],
        scale(item.placement.height, policy.coordinateScale),
      ],
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.viewItemId, node]));
  const platformThickness = cleanNumber(
    Math.max(0.05, Math.min(0.2, policy.elevationStep * 0.1 || 0.1)),
  );
  const platforms = nodes
    .filter((node) => node.kind === 'softwareSystem' || node.kind === 'container')
    .map((node): ViewPlatform3D => {
      const padding = policy.platformPadding;
      return {
        id: `platform:${compiled.viewId}:${node.viewItemId}`,
        viewItemId: node.viewItemId,
        elementId: node.elementId,
        ...(node.parentViewItemId === undefined ? {} : { parentViewItemId: node.parentViewItemId }),
        semanticDepth: node.semanticDepth,
        position: [
          cleanNumber(node.position[0] - padding),
          cleanNumber(Math.max(0, node.position[1] - platformThickness)),
          cleanNumber(node.position[2] - padding),
        ],
        size: [
          cleanNumber(node.size[0] + padding * 2),
          platformThickness,
          cleanNumber(node.size[2] + padding * 2),
        ],
      };
    });
  const edges = compiled.relationships.map((relationship): ViewEdge3D => {
    const sourceNode = nodeById.get(relationship.sourceViewItemId);
    const targetNode = nodeById.get(relationship.targetViewItemId);
    if (sourceNode === undefined || targetNode === undefined) {
      throw new TypeError(
        `Compiled relationship "${relationship.relationshipId}" has an unresolved 3D endpoint.`,
      );
    }
    const sourcePosition = centerAnchor(sourceNode);
    const targetPosition = centerAnchor(targetNode);
    return {
      ...relationship,
      id: relationship.relationshipId,
      source: relationship.sourceViewItemId,
      target: relationship.targetViewItemId,
      sourcePosition,
      targetPosition,
      path: [sourcePosition, targetPosition],
    };
  });

  const projected: ProjectedView3D = {
    projectId: compiled.projectId,
    viewId: compiled.viewId,
    type: compiled.type,
    scopeElementId: compiled.scopeElementId,
    name: compiled.name,
    ...(compiled.description === undefined ? {} : { description: compiled.description }),
    policy: { ...policy },
    nodes,
    edges,
    platforms,
    warnings: compiled.warnings,
  };
  return deepFreeze(projected);
}
