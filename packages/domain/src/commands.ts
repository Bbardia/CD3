import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { ZodError } from 'zod';

import {
  ElementSchema,
  Placement2DSchema,
  ProjectSchema,
  RelationshipSchema,
  ViewItemSchema,
  ViewSchema,
  type Element,
  type ElementInput,
  type Placement2DInput,
  type Project,
  type RelationshipInput,
  type ViewInput,
} from './schema.js';

export type DomainCommandErrorCode =
  | 'CASCADE_REQUIRED'
  | 'DUPLICATE_ELEMENT_ID'
  | 'DUPLICATE_RELATIONSHIP_ID'
  | 'DUPLICATE_VIEW_ID'
  | 'DUPLICATE_VIEW_ITEM'
  | 'DUPLICATE_VIEW_ITEM_MOVE'
  | 'ELEMENT_ALREADY_IN_VIEW'
  | 'ELEMENT_CANNOT_BE_REPARENTED'
  | 'ELEMENT_NOT_FOUND'
  | 'INVALID_COMMAND'
  | 'INVALID_COORDINATE'
  | 'INVALID_PROJECT'
  | 'LAST_VIEW'
  | 'PARENT_ELEMENT_NOT_FOUND'
  | 'PROTECTED_ELEMENT_FIELD'
  | 'PROTECTED_VIEW_FIELD'
  | 'PROTECTED_RELATIONSHIP_FIELD'
  | 'RELATIONSHIP_ENDPOINT_NOT_FOUND'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'REPARENT_CYCLE'
  | 'VIEW_ITEM_NOT_FOUND'
  | 'VIEW_NOT_FOUND'
  | 'VIEW_SCOPE_WOULD_DANGLE';

export class DomainCommandError extends Error {
  override readonly name = 'DomainCommandError';
  readonly code: DomainCommandErrorCode;

  constructor(code: DomainCommandErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export type DeepReadonly<T> = T extends
  null | undefined | string | number | boolean | bigint | symbol
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ReadonlyProject = DeepReadonly<Project>;
export type ReadonlyPatch = DeepReadonly<Patch>;

export type ElementChanges = DeepReadonly<
  Partial<
    Pick<
      ElementInput,
      'description' | 'externalRefs' | 'name' | 'properties' | 'tags' | 'technology'
    >
  >
>;

export type RelationshipChanges = DeepReadonly<
  Partial<
    Pick<
      RelationshipInput,
      'description' | 'externalRefs' | 'interaction' | 'name' | 'properties' | 'tags' | 'technology'
    >
  >
>;

export type ViewChanges = DeepReadonly<
  Partial<Pick<ViewInput, 'description' | 'name' | 'relationshipIds' | 'scopeElementId' | 'type'>>
>;

/** Places a newly created element in a view as part of the same command. */
export interface ViewPlacement {
  readonly viewId: string;
  readonly itemId: string;
  readonly placement: DeepReadonly<Placement2DInput>;
  readonly label?: string;
}

export interface CreateElementCommand {
  readonly type: 'create-element';
  readonly element: DeepReadonly<ElementInput>;
  /** Authoring an element and showing it are one intent, so one command, and one undo. */
  readonly placeInView?: ViewPlacement;
}

export interface UpdateElementCommand {
  readonly type: 'update-element';
  readonly elementId: string;
  readonly changes: ElementChanges;
}

export interface DeleteElementCommand {
  readonly type: 'delete-element';
  readonly elementId: string;
  readonly cascade?: boolean;
}

export interface ReparentElementCommand {
  readonly type: 'reparent-element';
  readonly elementId: string;
  readonly parentId: string;
}

export interface CreateRelationshipCommand {
  readonly type: 'create-relationship';
  readonly relationship: DeepReadonly<RelationshipInput>;
  /** View that should show the new relationship, added in the same command. */
  readonly showInViewId?: string;
}

export interface UpdateRelationshipCommand {
  readonly type: 'update-relationship';
  readonly relationshipId: string;
  readonly changes: RelationshipChanges;
}

export interface DeleteRelationshipCommand {
  readonly type: 'delete-relationship';
  readonly relationshipId: string;
}

export interface ViewItemMove {
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
}

export interface MoveViewItemsCommand {
  readonly type: 'move-view-items';
  readonly viewId: string;
  readonly moves: readonly ViewItemMove[];
}

export interface CreateViewCommand {
  readonly type: 'create-view';
  readonly view: DeepReadonly<ViewInput>;
}

export interface DeleteViewCommand {
  readonly type: 'delete-view';
  readonly viewId: string;
}

/** Shows an element that already exists in the model inside one more view. */
export interface AddViewItemCommand {
  readonly type: 'add-view-item';
  readonly viewId: string;
  readonly itemId: string;
  readonly elementId: string;
  readonly placement: DeepReadonly<Placement2DInput>;
  readonly label?: string;
}

/** Hides an element in one view without touching the canonical model. */
export interface RemoveViewItemCommand {
  readonly type: 'remove-view-item';
  readonly viewId: string;
  readonly itemId: string;
}

export interface UpdateViewCommand {
  readonly type: 'update-view';
  readonly viewId: string;
  readonly changes: ViewChanges;
}

export type DomainCommand =
  | CreateElementCommand
  | UpdateElementCommand
  | DeleteElementCommand
  | ReparentElementCommand
  | CreateRelationshipCommand
  | UpdateRelationshipCommand
  | DeleteRelationshipCommand
  | MoveViewItemsCommand
  | CreateViewCommand
  | DeleteViewCommand
  | AddViewItemCommand
  | RemoveViewItemCommand
  | UpdateViewCommand;

export interface CommandResult {
  readonly project: ReadonlyProject;
  readonly patches: readonly ReadonlyPatch[];
  readonly inversePatches: readonly ReadonlyPatch[];
}

export interface CommandHistoryEntry {
  readonly command: DeepReadonly<DomainCommand>;
  readonly patches: readonly ReadonlyPatch[];
  readonly inversePatches: readonly ReadonlyPatch[];
}

export interface CommandHistory {
  readonly project: ReadonlyProject;
  readonly undoStack: readonly CommandHistoryEntry[];
  readonly redoStack: readonly CommandHistoryEntry[];
}

interface PreparedCommand {
  mutate(draft: Draft<Project>): void;
}

const elementChangeFields = new Set([
  'description',
  'externalRefs',
  'name',
  'properties',
  'tags',
  'technology',
]);
const relationshipChangeFields = new Set([
  'description',
  'externalRefs',
  'interaction',
  'name',
  'properties',
  'tags',
  'technology',
]);

const viewChangeFields = new Set([
  'description',
  'name',
  'relationshipIds',
  'scopeElementId',
  'type',
]);
let patchesEnabled = false;

function ensurePatchesEnabled(): void {
  if (!patchesEnabled) {
    enablePatches();
    patchesEnabled = true;
  }
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.hasOwn(record, key);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }

  const leftKeys = Object.keys(left).sort(compareCodeUnits);
  const rightKeys = Object.keys(right).sort(compareCodeUnits);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        structurallyEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
}

function deepFreeze<T>(value: T, seen = new Set<object>()): DeepReadonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as DeepReadonly<T>;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

function immutableSnapshot<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value));
}

function validationMessage(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}

function invalidProject(message: string, cause?: ZodError): DomainCommandError {
  return new DomainCommandError(
    'INVALID_PROJECT',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function formatCommandType(type: unknown): string {
  try {
    const serialized = JSON.stringify(type);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall through to a non-throwing representation for non-JSON runtime input.
  }
  try {
    return String(type);
  } catch {
    return `<${typeof type}>`;
  }
}

function invalidCommand(command: unknown): DomainCommandError {
  let receivedType: unknown;
  if (command !== null && (typeof command === 'object' || typeof command === 'function')) {
    try {
      receivedType = Reflect.get(command, 'type');
    } catch {
      receivedType = '<unreadable>';
    }
  }
  return new DomainCommandError(
    'INVALID_COMMAND',
    `Invalid command type ${formatCommandType(receivedType)}.`,
  );
}

function assertValidProject(project: ReadonlyProject): void {
  const result = ProjectSchema.safeParse(project);
  if (!result.success) {
    throw invalidProject(
      `Project document is invalid: ${validationMessage(result.error)}`,
      result.error,
    );
  }
}

function assertValidResult(project: ReadonlyProject): void {
  const result = ProjectSchema.safeParse(project);
  if (!result.success) {
    throw invalidProject(
      `Command would produce an invalid project: ${validationMessage(result.error)}`,
      result.error,
    );
  }
}

function parseElement(input: unknown): Element {
  const result = ElementSchema.safeParse(input);
  if (!result.success) {
    throw invalidProject(`Element is invalid: ${validationMessage(result.error)}`, result.error);
  }
  return result.data;
}

function parseRelationship(input: unknown) {
  const result = RelationshipSchema.safeParse(input);
  if (!result.success) {
    throw invalidProject(
      `Relationship is invalid: ${validationMessage(result.error)}`,
      result.error,
    );
  }
  return result.data;
}

function parseViewItem(input: unknown) {
  const result = ViewItemSchema.safeParse(input);
  if (!result.success) {
    throw invalidProject(`View item is invalid: ${validationMessage(result.error)}`, result.error);
  }
  return result.data;
}

function parsePlacement(input: unknown) {
  const result = Placement2DSchema.safeParse(input);
  if (!result.success) {
    throw invalidProject(`Placement is invalid: ${validationMessage(result.error)}`, result.error);
  }
  return result.data;
}

function parseView(input: unknown) {
  const result = ViewSchema.safeParse(input);
  if (!result.success) {
    throw invalidProject(`View is invalid: ${validationMessage(result.error)}`, result.error);
  }
  return result.data;
}

function getElement(project: Project, elementId: string): Element {
  const element = hasOwn(project.elements, elementId) ? project.elements[elementId] : undefined;
  if (element === undefined) {
    throw new DomainCommandError('ELEMENT_NOT_FOUND', `Element "${elementId}" does not exist.`);
  }
  return element;
}

function getView(project: Project, viewId: string) {
  const view = hasOwn(project.views, viewId) ? project.views[viewId] : undefined;
  if (view === undefined) {
    throw new DomainCommandError('VIEW_NOT_FOUND', `View "${viewId}" does not exist.`);
  }
  return view;
}

function assertOnlyFields(
  changes: object,
  allowedFields: ReadonlySet<string>,
  errorCode: 'PROTECTED_ELEMENT_FIELD' | 'PROTECTED_RELATIONSHIP_FIELD' | 'PROTECTED_VIEW_FIELD',
  subject: 'update-element' | 'update-relationship' | 'update-view',
): void {
  for (const field of Object.keys(changes)) {
    if (!allowedFields.has(field)) {
      throw new DomainCommandError(
        errorCode,
        `${subject} cannot change protected field "${field}".`,
      );
    }
  }
}

function prepareCreateElement(project: Project, command: CreateElementCommand): PreparedCommand {
  const element = parseElement(command.element);
  if (hasOwn(project.elements, element.id)) {
    throw new DomainCommandError('DUPLICATE_ELEMENT_ID', `Element "${element.id}" already exists.`);
  }

  const target = command.placeInView;
  if (target === undefined) {
    return {
      mutate(draft) {
        draft.elements[element.id] = element;
      },
    };
  }

  const view = getView(project, target.viewId);
  if (hasOwn(view.items, target.itemId)) {
    throw new DomainCommandError(
      'DUPLICATE_VIEW_ITEM',
      `View item "${target.itemId}" already exists in view "${target.viewId}".`,
    );
  }
  const item = parseViewItem({
    id: target.itemId,
    elementId: element.id,
    ...(target.label === undefined ? {} : { label: target.label }),
  });
  const placement = parsePlacement(target.placement);

  return {
    mutate(draft) {
      draft.elements[element.id] = element;
      const draftView = draft.views[target.viewId];
      if (draftView === undefined) {
        return;
      }
      draftView.items[item.id] = item;
      draftView.placements[item.id] = placement;
    },
  };
}

function prepareUpdateElement(project: Project, command: UpdateElementCommand): PreparedCommand {
  const element = getElement(project, command.elementId);
  assertOnlyFields(
    command.changes,
    elementChangeFields,
    'PROTECTED_ELEMENT_FIELD',
    'update-element',
  );
  const updatedElement = parseElement({ ...element, ...command.changes });

  if (structurallyEqual(element, updatedElement)) {
    return { mutate() {} };
  }

  return {
    mutate(draft) {
      draft.elements[command.elementId] = updatedElement;
    },
  };
}

function collectRemovedElementIds(project: Project, rootId: string): Set<string> {
  const removedIds = new Set([rootId]);
  let foundDescendant = true;

  while (foundDescendant) {
    foundDescendant = false;
    for (const elementId of Object.keys(project.elements).sort()) {
      const element = project.elements[elementId];
      if (
        element !== undefined &&
        'parentId' in element &&
        removedIds.has(element.parentId) &&
        !removedIds.has(elementId)
      ) {
        removedIds.add(elementId);
        foundDescendant = true;
      }
    }
  }

  return removedIds;
}

function prepareDeleteElement(project: Project, command: DeleteElementCommand): PreparedCommand {
  getElement(project, command.elementId);
  const removedElementIds = collectRemovedElementIds(project, command.elementId);
  if (removedElementIds.size > 1 && command.cascade !== true) {
    throw new DomainCommandError(
      'CASCADE_REQUIRED',
      `Element "${command.elementId}" has descendants; set cascade to true to delete them.`,
    );
  }

  const affectedViewIds = Object.keys(project.views)
    .filter((viewId) => {
      const view = project.views[viewId];
      return view !== undefined && removedElementIds.has(view.scopeElementId);
    })
    .sort((leftId, rightId) => {
      const leftIsDirect = project.views[leftId]?.scopeElementId === command.elementId;
      const rightIsDirect = project.views[rightId]?.scopeElementId === command.elementId;
      return Number(rightIsDirect) - Number(leftIsDirect) || compareCodeUnits(leftId, rightId);
    });

  for (const viewId of affectedViewIds) {
    const view = project.views[viewId];
    if (view !== undefined) {
      throw new DomainCommandError(
        'VIEW_SCOPE_WOULD_DANGLE',
        `Element "${view.scopeElementId}" scopes view "${viewId}"; delete or rescope that view first.`,
      );
    }
  }

  const removedRelationshipIds = new Set<string>();
  for (const relationshipId of Object.keys(project.relationships).sort()) {
    const relationship = project.relationships[relationshipId];
    if (
      relationship !== undefined &&
      (removedElementIds.has(relationship.sourceId) || removedElementIds.has(relationship.targetId))
    ) {
      removedRelationshipIds.add(relationshipId);
    }
  }

  return {
    mutate(draft) {
      for (const elementId of [...removedElementIds].sort()) {
        delete draft.elements[elementId];
      }
      for (const relationshipId of [...removedRelationshipIds].sort()) {
        delete draft.relationships[relationshipId];
      }
      for (const viewId of Object.keys(project.views).sort()) {
        const sourceView = project.views[viewId];
        const draftView = draft.views[viewId];
        if (sourceView === undefined || draftView === undefined) {
          continue;
        }
        for (const itemId of Object.keys(sourceView.items).sort()) {
          const item = sourceView.items[itemId];
          if (item !== undefined && removedElementIds.has(item.elementId)) {
            delete draftView.items[itemId];
            delete draftView.placements[itemId];
          }
        }
        if (
          sourceView.relationshipIds.some((relationshipId) =>
            removedRelationshipIds.has(relationshipId),
          )
        ) {
          draftView.relationshipIds = sourceView.relationshipIds.filter(
            (relationshipId) => !removedRelationshipIds.has(relationshipId),
          );
        }
      }
    },
  };
}

function wouldCreateCycle(project: Project, elementId: string, parentId: string): boolean {
  let currentId: string | undefined = parentId;
  const visited = new Set<string>();

  while (currentId !== undefined && !visited.has(currentId)) {
    if (currentId === elementId) {
      return true;
    }
    visited.add(currentId);
    const current: Element | undefined = hasOwn(project.elements, currentId)
      ? project.elements[currentId]
      : undefined;
    currentId = current !== undefined && 'parentId' in current ? current.parentId : undefined;
  }

  return false;
}

function prepareReparentElement(
  project: Project,
  command: ReparentElementCommand,
): PreparedCommand {
  const element = getElement(project, command.elementId);
  if (!('parentId' in element)) {
    throw new DomainCommandError(
      'ELEMENT_CANNOT_BE_REPARENTED',
      `${element.kind} element "${command.elementId}" cannot have a parent.`,
    );
  }
  if (!hasOwn(project.elements, command.parentId)) {
    throw new DomainCommandError(
      'PARENT_ELEMENT_NOT_FOUND',
      `Parent element "${command.parentId}" does not exist.`,
    );
  }
  if (wouldCreateCycle(project, command.elementId, command.parentId)) {
    throw new DomainCommandError(
      'REPARENT_CYCLE',
      `Reparenting element "${command.elementId}" beneath "${command.parentId}" would create a cycle.`,
    );
  }
  const updatedElement = parseElement({ ...element, parentId: command.parentId });

  if (structurallyEqual(element, updatedElement)) {
    return { mutate() {} };
  }

  return {
    mutate(draft) {
      draft.elements[command.elementId] = updatedElement;
    },
  };
}

function prepareCreateRelationship(
  project: Project,
  command: CreateRelationshipCommand,
): PreparedCommand {
  const relationship = parseRelationship(command.relationship);
  if (hasOwn(project.relationships, relationship.id)) {
    throw new DomainCommandError(
      'DUPLICATE_RELATIONSHIP_ID',
      `Relationship "${relationship.id}" already exists.`,
    );
  }
  if (!hasOwn(project.elements, relationship.sourceId)) {
    throw new DomainCommandError(
      'RELATIONSHIP_ENDPOINT_NOT_FOUND',
      `Source element "${relationship.sourceId}" does not exist.`,
    );
  }
  if (!hasOwn(project.elements, relationship.targetId)) {
    throw new DomainCommandError(
      'RELATIONSHIP_ENDPOINT_NOT_FOUND',
      `Target element "${relationship.targetId}" does not exist.`,
    );
  }

  const viewId = command.showInViewId;
  const view = viewId === undefined ? undefined : getView(project, viewId);

  return {
    mutate(draft) {
      draft.relationships[relationship.id] = relationship;
      if (viewId === undefined || view === undefined) {
        return;
      }
      const draftView = draft.views[viewId];
      if (draftView !== undefined && !view.relationshipIds.includes(relationship.id)) {
        draftView.relationshipIds = [...view.relationshipIds, relationship.id];
      }
    },
  };
}

function getRelationship(project: Project, relationshipId: string) {
  const relationship = hasOwn(project.relationships, relationshipId)
    ? project.relationships[relationshipId]
    : undefined;
  if (relationship === undefined) {
    throw new DomainCommandError(
      'RELATIONSHIP_NOT_FOUND',
      `Relationship "${relationshipId}" does not exist.`,
    );
  }
  return relationship;
}

function prepareUpdateRelationship(
  project: Project,
  command: UpdateRelationshipCommand,
): PreparedCommand {
  const relationship = getRelationship(project, command.relationshipId);
  assertOnlyFields(
    command.changes,
    relationshipChangeFields,
    'PROTECTED_RELATIONSHIP_FIELD',
    'update-relationship',
  );
  const updated = parseRelationship({ ...relationship, ...command.changes });

  if (structurallyEqual(relationship, updated)) {
    return { mutate() {} };
  }

  return {
    mutate(draft) {
      draft.relationships[command.relationshipId] = updated;
    },
  };
}

function prepareDeleteRelationship(
  project: Project,
  command: DeleteRelationshipCommand,
): PreparedCommand {
  getRelationship(project, command.relationshipId);
  // Views list relationships by ID, so a deleted relationship has to leave those lists with it.
  const affectedViewIds = Object.keys(project.views)
    .filter((viewId) =>
      project.views[viewId]?.relationshipIds.some(
        (relationshipId) => relationshipId === command.relationshipId,
      ),
    )
    .sort(compareCodeUnits);

  return {
    mutate(draft) {
      delete draft.relationships[command.relationshipId];
      for (const viewId of affectedViewIds) {
        const sourceView = project.views[viewId];
        const draftView = draft.views[viewId];
        if (sourceView !== undefined && draftView !== undefined) {
          draftView.relationshipIds = sourceView.relationshipIds.filter(
            (relationshipId) => relationshipId !== command.relationshipId,
          );
        }
      }
    },
  };
}

function prepareCreateView(project: Project, command: CreateViewCommand): PreparedCommand {
  const view = parseView(command.view);
  if (hasOwn(project.views, view.id)) {
    throw new DomainCommandError('DUPLICATE_VIEW_ID', `View "${view.id}" already exists.`);
  }
  if (!hasOwn(project.elements, view.scopeElementId)) {
    throw new DomainCommandError(
      'ELEMENT_NOT_FOUND',
      `Scope element "${view.scopeElementId}" does not exist.`,
    );
  }

  return {
    mutate(draft) {
      draft.views[view.id] = view;
    },
  };
}

function prepareDeleteView(project: Project, command: DeleteViewCommand): PreparedCommand {
  getView(project, command.viewId);
  if (Object.keys(project.views).length <= 1) {
    throw new DomainCommandError('LAST_VIEW', 'A project needs at least one view.');
  }

  return {
    mutate(draft) {
      delete draft.views[command.viewId];
    },
  };
}

function prepareAddViewItem(project: Project, command: AddViewItemCommand): PreparedCommand {
  const view = getView(project, command.viewId);
  getElement(project, command.elementId);
  if (hasOwn(view.items, command.itemId)) {
    throw new DomainCommandError(
      'DUPLICATE_VIEW_ITEM',
      `View item "${command.itemId}" already exists in view "${command.viewId}".`,
    );
  }
  for (const itemId of Object.keys(view.items)) {
    if (view.items[itemId]?.elementId === command.elementId) {
      throw new DomainCommandError(
        'ELEMENT_ALREADY_IN_VIEW',
        `Element "${command.elementId}" already occurs in view "${command.viewId}".`,
      );
    }
  }
  const item = parseViewItem({
    id: command.itemId,
    elementId: command.elementId,
    ...(command.label === undefined ? {} : { label: command.label }),
  });
  const placement = parsePlacement(command.placement);

  return {
    mutate(draft) {
      const draftView = draft.views[command.viewId];
      if (draftView !== undefined) {
        draftView.items[item.id] = item;
        draftView.placements[item.id] = placement;
      }
    },
  };
}

function prepareRemoveViewItem(project: Project, command: RemoveViewItemCommand): PreparedCommand {
  const view = getView(project, command.viewId);
  if (!hasOwn(view.items, command.itemId)) {
    throw new DomainCommandError(
      'VIEW_ITEM_NOT_FOUND',
      `View item "${command.itemId}" does not exist in view "${command.viewId}".`,
    );
  }

  return {
    mutate(draft) {
      const draftView = draft.views[command.viewId];
      if (draftView !== undefined) {
        delete draftView.items[command.itemId];
        delete draftView.placements[command.itemId];
      }
    },
  };
}

function prepareMoveViewItems(project: Project, command: MoveViewItemsCommand): PreparedCommand {
  const view = getView(project, command.viewId);
  const seenItemIds = new Set<string>();

  for (const move of command.moves) {
    if (seenItemIds.has(move.itemId)) {
      throw new DomainCommandError(
        'DUPLICATE_VIEW_ITEM_MOVE',
        `View item "${move.itemId}" may be moved only once per command.`,
      );
    }
    seenItemIds.add(move.itemId);
    if (!hasOwn(view.items, move.itemId)) {
      throw new DomainCommandError(
        'VIEW_ITEM_NOT_FOUND',
        `View item "${move.itemId}" does not exist in view "${command.viewId}".`,
      );
    }
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) {
      throw new DomainCommandError(
        'INVALID_COORDINATE',
        `View item "${move.itemId}" must have finite coordinates.`,
      );
    }
  }

  return {
    mutate(draft) {
      const draftView = draft.views[command.viewId];
      if (draftView === undefined) {
        return;
      }
      for (const move of command.moves) {
        const placement = draftView.placements[move.itemId];
        if (placement !== undefined) {
          placement.x = move.x;
          placement.y = move.y;
        }
      }
    },
  };
}

function prepareUpdateView(project: Project, command: UpdateViewCommand): PreparedCommand {
  const view = getView(project, command.viewId);
  assertOnlyFields(command.changes, viewChangeFields, 'PROTECTED_VIEW_FIELD', 'update-view');
  const updatedView = parseView({ ...view, ...command.changes });

  if (structurallyEqual(view, updatedView)) {
    return { mutate() {} };
  }

  return {
    mutate(draft) {
      draft.views[command.viewId] = updatedView;
    },
  };
}

function prepareCommand(project: Project, command: DomainCommand): PreparedCommand {
  const runtimeCommand: unknown = command;
  if (runtimeCommand === null || typeof runtimeCommand !== 'object') {
    throw invalidCommand(runtimeCommand);
  }

  switch (command.type) {
    case 'create-element':
      return prepareCreateElement(project, command);
    case 'update-element':
      return prepareUpdateElement(project, command);
    case 'delete-element':
      return prepareDeleteElement(project, command);
    case 'reparent-element':
      return prepareReparentElement(project, command);
    case 'create-relationship':
      return prepareCreateRelationship(project, command);
    case 'update-relationship':
      return prepareUpdateRelationship(project, command);
    case 'delete-relationship':
      return prepareDeleteRelationship(project, command);
    case 'move-view-items':
      return prepareMoveViewItems(project, command);
    case 'create-view':
      return prepareCreateView(project, command);
    case 'delete-view':
      return prepareDeleteView(project, command);
    case 'add-view-item':
      return prepareAddViewItem(project, command);
    case 'remove-view-item':
      return prepareRemoveViewItem(project, command);
    case 'update-view':
      return prepareUpdateView(project, command);
    default: {
      const exhaustiveCommand: never = command;
      throw invalidCommand(exhaustiveCommand);
    }
  }
}

/** Apply one validated, immutable domain change and return its deterministic undo data. */
export function applyCommand(project: ReadonlyProject, command: DomainCommand): CommandResult {
  assertValidProject(project);
  const projectSnapshot = immutableSnapshot(project) as Project;
  const commandSnapshot = immutableSnapshot(command) as DomainCommand;
  const prepared = prepareCommand(projectSnapshot, commandSnapshot);
  ensurePatchesEnabled();
  const [nextProject, patches, inversePatches] = produceWithPatches(projectSnapshot, (draft) => {
    prepared.mutate(draft);
  });
  assertValidResult(nextProject);

  return deepFreeze({ project: nextProject, patches, inversePatches });
}

/** Start an empty history around an already-valid canonical project. */
export function createCommandHistory(project: ReadonlyProject): CommandHistory {
  assertValidProject(project);
  return deepFreeze({
    project: immutableSnapshot(project),
    undoStack: [],
    redoStack: [],
  });
}

/** Apply one command and record an undo entry only when the project changes. */
export function applyCommandToHistory(
  history: CommandHistory,
  command: DomainCommand,
): CommandHistory {
  const result = applyCommand(history.project, command);
  if (result.patches.length === 0 && result.inversePatches.length === 0) {
    return history;
  }
  const entry: CommandHistoryEntry = deepFreeze({
    command: immutableSnapshot(command),
    patches: immutableSnapshot(result.patches),
    inversePatches: immutableSnapshot(result.inversePatches),
  });
  return deepFreeze({
    project: result.project,
    undoStack: [...history.undoStack, entry],
    redoStack: [],
  });
}

function applyHistoryPatches(
  project: ReadonlyProject,
  patches: readonly ReadonlyPatch[],
): ReadonlyProject {
  const projectSnapshot = structuredClone(project) as Project;
  const patchSnapshot = structuredClone(patches) as Patch[];
  ensurePatchesEnabled();
  const nextProject = applyPatches(projectSnapshot, patchSnapshot);
  assertValidResult(nextProject);
  return deepFreeze(nextProject);
}

/** Undo the most recent history entry. Empty histories are returned unchanged. */
export function undoCommand(history: CommandHistory): CommandHistory {
  const entry = history.undoStack.at(-1);
  if (entry === undefined) {
    return history;
  }
  const project = applyHistoryPatches(history.project, entry.inversePatches);
  return deepFreeze({
    project,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, entry],
  });
}

/** Redo the most recently undone entry. Empty redo stacks are returned unchanged. */
export function redoCommand(history: CommandHistory): CommandHistory {
  const entry = history.redoStack.at(-1);
  if (entry === undefined) {
    return history;
  }
  const project = applyHistoryPatches(history.project, entry.patches);
  return deepFreeze({
    project,
    undoStack: [...history.undoStack, entry],
    redoStack: history.redoStack.slice(0, -1),
  });
}

/** Concise aliases for editor stores that model history actions directly. */
export const executeCommand = applyCommandToHistory;
export const undo = undoCommand;
export const redo = redoCommand;
