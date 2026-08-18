import type { ElementId, ReadonlyProject } from '@cd3/domain';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createEditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStore } from './EditorStoreProvider';
import { project, workspaceViewIdsOf } from '../workspace';

const workspaceViewIds = workspaceViewIdsOf(project);
const initialActiveViewId = workspaceViewIds[1] ?? '';

function existingElementId(elementId: string) {
  const element = project.elements[elementId];
  if (element === undefined) {
    throw new Error(`Expected fixture element "${elementId}".`);
  }
  return element.id;
}

const orderServiceId = existingElementId('order-service');
const shopperId = existingElementId('shopper');
const constellationPaymentsId = existingElementId('constellation-payments');

function createTestStore() {
  return createEditorStore({
    project,
    activeViewId: initialActiveViewId,
  });
}

function projectWithoutView(viewId: string): ReadonlyProject {
  return {
    ...project,
    views: Object.fromEntries(
      Object.entries(project.views).filter(([candidateViewId]) => candidateViewId !== viewId),
    ),
    threeD: {
      ...project.threeD,
      bookmarks: Object.fromEntries(
        Object.entries(project.threeD.bookmarks).filter(
          ([, bookmark]) => bookmark.viewId !== viewId,
        ),
      ),
    },
  };
}

const newlyCreatedElement = {
  id: 'newly-created-system',
  kind: 'softwareSystem',
  name: 'Newly Created System',
  externalRefs: [],
  properties: {},
  tags: [],
} as const;
const newlyCreatedElementId = newlyCreatedElement.id as ElementId;

describe('replaceProject', () => {
  it('starts history fresh and keeps a still-existing active view', () => {
    const store = createTestStore();
    store.getState().execute({
      type: 'update-element',
      elementId: 'order-service',
      changes: { name: 'Renamed' },
    });

    store.getState().replaceProject(project);

    expect(store.getState().history.project).toEqual(project);
    expect(store.getState().history.undoStack).toHaveLength(0);
    expect(store.getState().selectedElementIds).toHaveLength(0);
    expect(store.getState().activeViewId).toBe(initialActiveViewId);
  });

  it('falls back to the first view when the active one is gone from the new project', () => {
    const store = createTestStore();

    store.getState().replaceProject(projectWithoutView(initialActiveViewId));

    expect(store.getState().activeViewId).toBe(
      Object.keys(projectWithoutView(initialActiveViewId).views)[0],
    );
  });
});

describe('editor store', () => {
  it('rejects unsupported or project-absent initial active views', () => {
    const unsupportedViewId = 'missing-view';

    expect(() => createEditorStore({ project, activeViewId: unsupportedViewId })).toThrowError(
      new RangeError(`View "missing-view" does not exist in project "${project.id}".`),
    );
    expect(() =>
      createEditorStore({
        project: projectWithoutView(initialActiveViewId),
        activeViewId: initialActiveViewId,
      }),
    ).toThrowError(
      new RangeError(`View "${initialActiveViewId}" does not exist in project "${project.id}".`),
    );
  });

  it('rejects unsupported or project-absent active view changes without updating state', () => {
    const unsupportedViewId = 'missing-view';
    const store = createTestStore();
    const before = store.getState();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(() => store.getState().setActiveView(unsupportedViewId)).toThrowError(
      new RangeError(`View "missing-view" does not exist in project "${project.id}".`),
    );
    expect(store.getState()).toBe(before);
    expect(store.getState().history).toBe(before.history);
    expect(notifications).toBe(0);
    unsubscribe();

    const absentViewId = workspaceViewIds[0] ?? '';
    const storeWithoutView = createEditorStore({
      project: projectWithoutView(absentViewId),
      activeViewId: initialActiveViewId,
    });
    const beforeAbsentChange = storeWithoutView.getState();
    let absentNotifications = 0;
    const unsubscribeAbsent = storeWithoutView.subscribe(() => {
      absentNotifications += 1;
    });

    expect(() => storeWithoutView.getState().setActiveView(absentViewId)).toThrowError(
      new RangeError(`View "${absentViewId}" does not exist in project "${project.id}".`),
    );
    expect(storeWithoutView.getState()).toBe(beforeAbsentChange);
    expect(storeWithoutView.getState().history).toBe(beforeAbsentChange.history);
    expect(absentNotifications).toBe(0);
    unsubscribeAbsent();
  });

  it('exposes a frozen read-only facade that still supports state and subscriptions', () => {
    const store = createTestStore();
    const initialState = store.getInitialState();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(Object.hasOwn(store, 'setState')).toBe(false);
    expect('setState' in store).toBe(false);
    expect(Object.isFrozen(store)).toBe(true);

    store.getState().setMode('3d');

    expect(store.getState().mode).toBe('3d');
    expect(initialState.mode).toBe('2d');
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it('creates isolated instances with stable actions', () => {
    const first = createTestStore();
    const second = createTestStore();
    const firstActions = {
      execute: first.getState().execute,
      undo: first.getState().undo,
      redo: first.getState().redo,
      setSelection: first.getState().setSelection,
      setActiveView: first.getState().setActiveView,
      setMode: first.getState().setMode,
      clearError: first.getState().clearError,
    };

    first.getState().setMode('3d');
    first.getState().setSelection([orderServiceId], orderServiceId);

    expect(first.getState().mode).toBe('3d');
    expect(second.getState().mode).toBe('2d');
    expect(second.getState().selectedElementIds).toEqual([]);
    expect(first.getState()).toMatchObject(firstActions);
  });

  it('applies a real command to the active project and records one undo entry', () => {
    const store = createTestStore();
    const before = store.getState().history;

    store.getState().execute({
      type: 'update-element',
      elementId: 'order-service',
      changes: { name: 'Order Service Updated' },
    });

    const after = store.getState().history;
    expect(after).not.toBe(before);
    expect(after.project).not.toBe(before.project);
    expect(after.project.elements['order-service']?.name).toBe('Order Service Updated');
    expect(after.undoStack).toHaveLength(1);
    expect(after.redoStack).toHaveLength(0);
  });

  it('preserves history identity for a semantic no-op', () => {
    const store = createTestStore();
    const initialState = store.getState();
    const before = store.getState().history;
    const currentName = before.project.elements['order-service']?.name;
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(currentName).toBeDefined();
    store.getState().execute({
      type: 'update-element',
      elementId: 'order-service',
      changes: { name: currentName! },
    });

    expect(store.getState().history).toBe(before);
    expect(store.getState()).toBe(initialState);
    expect(notifications).toBe(0);

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });
    store.getState().execute({
      type: 'update-element',
      elementId: 'order-service',
      changes: { name: currentName! },
    });

    expect(store.getState().history).toBe(before);
    expect(store.getState().lastCommandError).toBeUndefined();
    unsubscribe();
  });

  it('preserves the exact history and exposes stable data for a domain command error', () => {
    const store = createTestStore();
    const before = store.getState().history;
    store.getState().setSelection([orderServiceId], orderServiceId);
    const selectedElementIds = store.getState().selectedElementIds;

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });

    expect(store.getState().history).toBe(before);
    expect(store.getState().selectedElementIds).toBe(selectedElementIds);
    expect(store.getState().primarySelectedElementId).toBe(orderServiceId);
    expect(store.getState().lastCommandError).toEqual({
      code: 'ELEMENT_NOT_FOUND',
      message: 'Element "missing-element" does not exist.',
    });
    const commandError = store.getState().lastCommandError;

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });

    expect(store.getState().lastCommandError).toBe(commandError);
  });

  it('undoes and redoes commands, clears errors, and preserves identity at history boundaries', () => {
    const store = createTestStore();
    const initialHistory = store.getState().history;

    store.getState().undo();
    store.getState().redo();
    expect(store.getState().history).toBe(initialHistory);

    store.getState().execute({
      type: 'update-element',
      elementId: 'order-service',
      changes: { name: 'Order Service Updated' },
    });
    const updatedHistory = store.getState().history;
    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });
    expect(store.getState().lastCommandError).toBeDefined();

    store.getState().undo();
    expect(store.getState().history.project).toEqual(initialHistory.project);
    expect(store.getState().history.redoStack).toHaveLength(1);
    expect(store.getState().lastCommandError).toBeUndefined();

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Still Missing' },
    });
    store.getState().redo();
    expect(store.getState().history.project).toEqual(updatedHistory.project);
    expect(store.getState().history.undoStack).toHaveLength(1);
    expect(store.getState().lastCommandError).toBeUndefined();
  });

  it('keeps selection, active view, and mode outside command history', () => {
    const store = createTestStore();
    const history = store.getState().history;

    store.getState().setSelection([orderServiceId, shopperId], shopperId);
    store.getState().setActiveView(workspaceViewIds[2] ?? '');
    store.getState().setMode('3d');

    expect(store.getState()).toMatchObject({
      selectedElementIds: ['order-service', 'shopper'],
      primarySelectedElementId: 'shopper',
      activeViewId: workspaceViewIds[2],
      mode: '3d',
    });
    expect(store.getState().history).toBe(history);
  });

  it('toggles elements into and out of the selection and keeps history untouched', () => {
    const store = createTestStore();
    const history = store.getState().history;

    store.getState().toggleSelection(orderServiceId);
    expect(store.getState().selectedElementIds).toEqual(['order-service']);
    expect(store.getState().primarySelectedElementId).toBe('order-service');

    store.getState().toggleSelection(shopperId);
    expect(store.getState().selectedElementIds).toEqual(['order-service', 'shopper']);
    expect(store.getState().primarySelectedElementId).toBe('shopper');

    store.getState().toggleSelection(shopperId);
    expect(store.getState().selectedElementIds).toEqual(['order-service']);
    expect(store.getState().primarySelectedElementId).toBe('order-service');

    store.getState().toggleSelection(orderServiceId);
    expect(store.getState().selectedElementIds).toEqual([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();
    expect(store.getState().history).toBe(history);
  });

  it('keeps the primary selection stable when a different element is toggled off', () => {
    const store = createTestStore();

    store.getState().setSelection([orderServiceId, shopperId, constellationPaymentsId], shopperId);
    store.getState().toggleSelection(orderServiceId);

    expect(store.getState().selectedElementIds).toEqual(['shopper', 'constellation-payments']);
    expect(store.getState().primarySelectedElementId).toBe('shopper');
  });

  it('hands the primary role to the first survivor when the primary is toggled off', () => {
    const store = createTestStore();

    store.getState().setSelection([orderServiceId, shopperId, constellationPaymentsId], shopperId);
    store.getState().toggleSelection(shopperId);

    expect(store.getState().selectedElementIds).toEqual([
      'order-service',
      'constellation-payments',
    ]);
    expect(store.getState().primarySelectedElementId).toBe('order-service');
  });

  it('ignores toggling an element that does not exist in the project', () => {
    const store = createTestStore();
    store.getState().setSelection([orderServiceId], orderServiceId);
    const before = store.getState();

    store.getState().toggleSelection('missing-element' as ElementId);

    expect(store.getState()).toBe(before);
  });

  it('deduplicates in first-seen order and appends a missing explicit primary', () => {
    const store = createTestStore();

    store
      .getState()
      .setSelection(
        [orderServiceId, shopperId, orderServiceId, shopperId],
        constellationPaymentsId,
      );

    expect(store.getState().selectedElementIds).toEqual([
      'order-service',
      'shopper',
      'constellation-payments',
    ]);
    expect(store.getState().primarySelectedElementId).toBe('constellation-payments');

    store.getState().setSelection([shopperId, orderServiceId, shopperId]);
    expect(store.getState().selectedElementIds).toEqual(['shopper', 'order-service']);
    expect(store.getState().primarySelectedElementId).toBe('shopper');

    store.getState().setSelection([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();
  });

  it('drops missing and inherited element IDs and preserves identity for unchanged selection', () => {
    const store = createTestStore();
    const missingElementId = 'missing-element' as ElementId;
    const inheritedElementId = 'toString' as ElementId;

    store
      .getState()
      .setSelection(
        [missingElementId, orderServiceId, orderServiceId, shopperId],
        missingElementId,
      );

    expect(store.getState().selectedElementIds).toEqual(['order-service', 'shopper']);
    expect(store.getState().primarySelectedElementId).toBe(orderServiceId);

    const before = store.getState();
    const selectedElementIds = before.selectedElementIds;
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store
      .getState()
      .setSelection(
        [inheritedElementId, orderServiceId, orderServiceId, shopperId],
        inheritedElementId,
      );

    expect(store.getState()).toBe(before);
    expect(store.getState().selectedElementIds).toBe(selectedElementIds);
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it('removes a deleted selection and falls back to the first surviving selected ID', () => {
    const store = createTestStore();

    store.getState().setSelection([shopperId, orderServiceId], shopperId);
    store.getState().execute({ type: 'delete-element', elementId: shopperId });

    expect(store.getState().history.project.elements.shopper).toBeUndefined();
    expect(store.getState().selectedElementIds).toEqual(['order-service']);
    expect(store.getState().primarySelectedElementId).toBe(orderServiceId);

    store.getState().undo();

    expect(store.getState().history.project.elements.shopper).toBeDefined();
    expect(store.getState().selectedElementIds).toEqual(['order-service']);
    expect(store.getState().primarySelectedElementId).toBe(orderServiceId);
  });

  it('clears a newly created current selection when creation is undone and does not redo it', () => {
    const store = createTestStore();

    store.getState().execute({ type: 'create-element', element: newlyCreatedElement });
    store.getState().setSelection([newlyCreatedElementId], newlyCreatedElementId);
    store.getState().undo();

    expect(store.getState().history.project.elements[newlyCreatedElement.id]).toBeUndefined();
    expect(store.getState().selectedElementIds).toEqual([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();

    store.getState().redo();

    expect(store.getState().history.project.elements[newlyCreatedElement.id]).toBeDefined();
    expect(store.getState().selectedElementIds).toEqual([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();
  });

  it('clears a restored element selected before its deletion is redone without restoring it on undo', () => {
    const store = createTestStore();

    store.getState().execute({ type: 'delete-element', elementId: shopperId });
    store.getState().undo();
    store.getState().setSelection([shopperId], shopperId);
    store.getState().redo();

    expect(store.getState().history.project.elements.shopper).toBeUndefined();
    expect(store.getState().selectedElementIds).toEqual([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();

    store.getState().undo();

    expect(store.getState().history.project.elements.shopper).toBeDefined();
    expect(store.getState().selectedElementIds).toEqual([]);
    expect(store.getState().primarySelectedElementId).toBeUndefined();
  });

  it('preserves selected ID array identity when history changes without invalidating selection', () => {
    const store = createTestStore();
    store.getState().setSelection([orderServiceId], orderServiceId);
    const selectedElementIds = store.getState().selectedElementIds;

    store.getState().execute({
      type: 'update-element',
      elementId: orderServiceId,
      changes: { name: 'Order Service Updated' },
    });
    expect(store.getState().selectedElementIds).toBe(selectedElementIds);

    store.getState().undo();
    expect(store.getState().selectedElementIds).toBe(selectedElementIds);

    store.getState().redo();
    expect(store.getState().selectedElementIds).toBe(selectedElementIds);
  });

  it('clears command errors explicitly', () => {
    const store = createTestStore();

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });
    store.getState().clearError();

    expect(store.getState().lastCommandError).toBeUndefined();
  });
});

describe('EditorStoreProvider', () => {
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(
      EditorStoreProvider,
      { initialProject: project, initialActiveViewId: initialActiveViewId },
      children,
    );
  }

  it('provides selector-based access to one isolated store instance', () => {
    const { result, rerender } = renderHook(
      () => ({
        mode: useEditorStore((state) => state.mode),
        setMode: useEditorStore((state) => state.setMode),
      }),
      { wrapper: Wrapper },
    );
    const setMode = result.current.setMode;

    act(() => result.current.setMode('3d'));
    rerender();

    expect(result.current.mode).toBe('3d');
    expect(result.current.setMode).toBe(setMode);
  });

  it('fails clearly when the selector hook is used without a provider', () => {
    expect(() => renderHook(() => useEditorStore((state) => state.mode))).toThrow(
      'useEditorStore must be used within an EditorStoreProvider.',
    );
  });
});
