import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createEditorStore } from './editor-store';
import { EditorStoreProvider, useEditorStore } from './EditorStoreProvider';
import { project, workspaceViewIds } from '../workspace';

const initialActiveViewId = workspaceViewIds[1];

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

describe('editor store', () => {
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

    store.getState().execute({
      type: 'update-element',
      elementId: 'missing-element',
      changes: { name: 'Missing' },
    });

    expect(store.getState().history).toBe(before);
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
    store.getState().setActiveView(workspaceViewIds[2]);
    store.getState().setMode('3d');

    expect(store.getState()).toMatchObject({
      selectedElementIds: ['order-service', 'shopper'],
      primarySelectedElementId: 'shopper',
      activeViewId: workspaceViewIds[2],
      mode: '3d',
    });
    expect(store.getState().history).toBe(history);
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
