import type { DeepReadonly, Element, ElementId, ReadonlyProject, Relationship } from '@cd3/domain';

import { cloneJsonValue, compareIds, deepFreeze } from './immutable.js';
import type {
  CompileWarning,
  CompiledRelationship,
  CompiledView,
  CompiledViewItem,
} from './types.js';

interface ResolvedEndpoint {
  readonly item: CompiledViewItem;
  readonly projected: boolean;
}

/** Author-chosen accent stored as a plain element property, validated as a hex colour here. */
function elementColor(element: DeepReadonly<Element>): string | undefined {
  const color = element.properties['color'];
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

/** Author-chosen prop key stored as a plain element property; renderers decide what it maps to. */
function elementIcon(element: DeepReadonly<Element>): string | undefined {
  const icon = element.properties['icon'];
  return typeof icon === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(icon) ? icon : undefined;
}

function semanticDepth(project: ReadonlyProject, element: DeepReadonly<Element>): number {
  let depth = 0;
  let current: DeepReadonly<Element> | undefined = element;
  const visited = new Set<string>();

  while (current !== undefined && 'parentId' in current && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = Object.hasOwn(project.elements, current.parentId)
      ? project.elements[current.parentId]
      : undefined;
  }
  return depth;
}

function resolveEndpoint(
  project: ReadonlyProject,
  originalElementId: ElementId,
  itemByElementId: ReadonlyMap<string, CompiledViewItem>,
): ResolvedEndpoint | undefined {
  let elementId: string | undefined = originalElementId;
  const visited = new Set<string>();

  while (elementId !== undefined && !visited.has(elementId)) {
    visited.add(elementId);
    const visibleItem = itemByElementId.get(elementId);
    if (visibleItem !== undefined) {
      return { item: visibleItem, projected: elementId !== originalElementId };
    }
    const element: DeepReadonly<Element> | undefined = Object.hasOwn(project.elements, elementId)
      ? project.elements[elementId]
      : undefined;
    elementId = element !== undefined && 'parentId' in element ? element.parentId : undefined;
  }
  return undefined;
}

function compileRelationship(
  viewId: string,
  relationship: DeepReadonly<Relationship>,
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
): CompiledRelationship {
  return {
    relationshipId: relationship.id,
    name: relationship.name,
    ...(relationship.description === undefined ? {} : { description: relationship.description }),
    interaction: relationship.interaction,
    ...(relationship.technology === undefined ? {} : { technology: relationship.technology }),
    tags: [...relationship.tags],
    properties: cloneJsonValue(relationship.properties),
    externalRefs: relationship.externalRefs.map((reference) => cloneJsonValue(reference)),
    sourceElementId: relationship.sourceId,
    targetElementId: relationship.targetId,
    sourceViewItemId: source.item.viewItemId,
    targetViewItemId: target.item.viewItemId,
    visibleSourceElementId: source.item.elementId,
    visibleTargetElementId: target.item.elementId,
    sourceProjected: source.projected,
    targetProjected: target.projected,
    renderKey: `view:${viewId}:relationship:${relationship.id}`,
  };
}

/**
 * Compiles one canonical C4 view into a deterministic, renderer-neutral immutable DTO.
 *
 * The project is assumed to have already passed `ProjectSchema`. Semantic relationships are only
 * represented by their original IDs. Hidden endpoints walk upward through `parentId`; relationships
 * with no visible endpoint or with a projected self-loop are omitted with a warning.
 */
export function compileView(project: ReadonlyProject, viewId: string): CompiledView {
  const view = Object.hasOwn(project.views, viewId) ? project.views[viewId] : undefined;
  if (view === undefined) {
    throw new RangeError(`View "${viewId}" does not exist in project "${project.id}".`);
  }

  const rawItems = Object.values(view.items).sort((left, right) => compareIds(left.id, right.id));
  const itemByElementId = new Map<string, CompiledViewItem>();

  const items = rawItems.map((viewItem): CompiledViewItem => {
    const element = Object.hasOwn(project.elements, viewItem.elementId)
      ? project.elements[viewItem.elementId]
      : undefined;
    if (element === undefined) {
      throw new TypeError(
        `View item "${viewItem.id}" references missing element "${viewItem.elementId}".`,
      );
    }
    const placement = Object.hasOwn(view.placements, viewItem.id)
      ? view.placements[viewItem.id]
      : undefined;
    if (placement === undefined) {
      throw new TypeError(`View item "${viewItem.id}" has no 2D placement.`);
    }
    const parentElementId = 'parentId' in element ? element.parentId : undefined;
    const color = elementColor(element);
    const icon = elementIcon(element);
    const item: CompiledViewItem = {
      viewItemId: viewItem.id,
      elementId: element.id,
      kind: element.kind,
      name: element.name,
      ...(viewItem.label === undefined ? {} : { label: viewItem.label }),
      ...(element.description === undefined ? {} : { description: element.description }),
      ...(element.technology === undefined ? {} : { technology: element.technology }),
      ...(color === undefined ? {} : { color }),
      ...(icon === undefined ? {} : { icon }),
      tags: [...element.tags],
      placement: { ...placement },
      ...(parentElementId === undefined ? {} : { parentElementId }),
      semanticDepth: semanticDepth(project, element),
      renderKey: `view:${view.id}:item:${viewItem.id}`,
    };
    itemByElementId.set(element.id, item);
    return item;
  });

  // Attach renderer-neutral compound hierarchy only after all visible items have been indexed.
  const itemsWithParents = items.map((item): CompiledViewItem => {
    const parentViewItemId =
      item.parentElementId === undefined
        ? undefined
        : itemByElementId.get(item.parentElementId)?.viewItemId;
    if (parentViewItemId === undefined) {
      return item;
    }
    const withParent: CompiledViewItem = { ...item, parentViewItemId };
    itemByElementId.set(item.elementId, withParent);
    return withParent;
  });

  const relationships: CompiledRelationship[] = [];
  const warnings: CompileWarning[] = [];
  const relationshipIds = [...view.relationshipIds].sort(compareIds);

  for (const relationshipId of relationshipIds) {
    const relationship = Object.hasOwn(project.relationships, relationshipId)
      ? project.relationships[relationshipId]
      : undefined;
    if (relationship === undefined) {
      warnings.push({
        code: 'relationship-not-found',
        relationshipId,
        message: `Relationship "${relationshipId}" does not exist and was omitted.`,
      });
      continue;
    }

    const source = resolveEndpoint(project, relationship.sourceId, itemByElementId);
    const target = resolveEndpoint(project, relationship.targetId, itemByElementId);

    if (source === undefined) {
      warnings.push({
        code: 'relationship-endpoint-not-visible',
        relationshipId: relationship.id,
        endpoint: 'source',
        elementId: relationship.sourceId,
        message: `Source "${relationship.sourceId}" for relationship "${relationship.id}" has no visible ancestor.`,
      });
    }
    if (target === undefined) {
      warnings.push({
        code: 'relationship-endpoint-not-visible',
        relationshipId: relationship.id,
        endpoint: 'target',
        elementId: relationship.targetId,
        message: `Target "${relationship.targetId}" for relationship "${relationship.id}" has no visible ancestor.`,
      });
    }
    if (source === undefined || target === undefined) {
      continue;
    }

    if (source.item.viewItemId === target.item.viewItemId) {
      warnings.push({
        code: 'projected-self-loop',
        relationshipId: relationship.id,
        sourceElementId: relationship.sourceId,
        targetElementId: relationship.targetId,
        viewItemId: source.item.viewItemId,
        message: `Relationship "${relationship.id}" projected both endpoints to view item "${source.item.viewItemId}" and was suppressed.`,
      });
      continue;
    }

    relationships.push(compileRelationship(view.id, relationship, source, target));
  }

  const compiled: CompiledView = {
    projectId: project.id,
    viewId: view.id,
    type: view.type,
    scopeElementId: view.scopeElementId,
    name: view.name,
    ...(view.description === undefined ? {} : { description: view.description }),
    items: itemsWithParents,
    relationships,
    warnings,
  };
  return deepFreeze(compiled);
}
