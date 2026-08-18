import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { CommandErrorBanner, EditorToolbar } from './EditorToolbar';
import { EditorStoreProvider, useEditorStore } from '../editor/EditorStoreProvider';
import { project, workspaceViewIdsOf } from '../workspace';

const movedItemId = 'core-containers-item-orders';

function restorePlatform(): void {
  Reflect.deleteProperty(window.navigator, 'platform');
}

function stubApplePlatform(): void {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    get: () => 'MacIntel',
  });
}

function CommandHarness() {
  const execute = useEditorStore((state) => state.execute);
  const placement = useEditorStore(
    (state) => state.history.project.views['core-containers']?.placements[movedItemId],
  );

  return (
    <>
      <span data-testid="orders-x">{placement === undefined ? 'absent' : placement.x}</span>
      <button
        type="button"
        onClick={() =>
          execute({
            type: 'move-view-items',
            viewId: 'core-containers',
            moves: [{ itemId: movedItemId, x: 1_234, y: 432 }],
          })
        }
      >
        Move orders
      </button>
      <button
        type="button"
        onClick={() =>
          execute({
            type: 'move-view-items',
            viewId: 'core-containers',
            moves: [{ itemId: 'core-containers-item-missing', x: 10, y: 10 }],
          })
        }
      >
        Move a missing item
      </button>
      <input aria-label="Draft field" />
    </>
  );
}

function renderToolbar() {
  return render(
    <EditorStoreProvider
      initialProject={project}
      initialActiveViewId={workspaceViewIdsOf(project)[1] ?? ''}
    >
      <EditorToolbar />
      <CommandErrorBanner />
      <CommandHarness />
    </EditorStoreProvider>,
  );
}

function undoButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Undo/ });
}

function redoButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Redo/ });
}

describe('EditorToolbar', () => {
  afterEach(() => {
    restorePlatform();
  });

  it('disables both controls while the history is empty', () => {
    renderToolbar();

    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
  });

  it('enables undo after a command and restores the exact previous coordinate', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move orders' }));

    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();

    await user.click(undoButton());

    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();
  });

  it('redoes an undone command back to the accepted coordinate', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Move orders' }));
    await user.click(undoButton());
    await user.click(redoButton());

    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();
  });

  it('undoes and redoes with Control shortcuts on non-Apple platforms', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move orders' }));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');
  });

  it('uses Command shortcuts and ignores Control on Apple platforms', async () => {
    stubApplePlatform();
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move orders' }));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');
  });

  it('does not treat Control+Y as redo on Apple platforms', async () => {
    stubApplePlatform();
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move orders' }));
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));
  });

  it('names the platform shortcut in each accessible label', () => {
    stubApplePlatform();
    renderToolbar();

    expect(undoButton()).toHaveAccessibleName('Undo (⌘Z)');
    expect(redoButton()).toHaveAccessibleName('Redo (⇧⌘Z)');
  });

  it('ignores history shortcuts while focus is inside text entry', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Move orders' }));
    const draftField = screen.getByRole('textbox', { name: 'Draft field' });
    await user.click(draftField);

    fireEvent.keyDown(draftField, { key: 'z', ctrlKey: true });

    expect(screen.getByTestId('orders-x')).toHaveTextContent('1234');
    expect(undoButton()).toBeEnabled();
  });

  it('leaves the controls disabled when a command changes nothing', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move orders' }));
    await user.click(undoButton());

    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));
    expect(undoButton()).toBeDisabled();
  });

  it('surfaces a rejected command as a dismissible alert without changing history', async () => {
    const user = userEvent.setup();
    renderToolbar();
    const originalX = screen.getByTestId('orders-x').textContent;

    await user.click(screen.getByRole('button', { name: 'Move a missing item' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('VIEW_ITEM_NOT_FOUND');
    expect(screen.getByTestId('orders-x')).toHaveTextContent(String(originalX));
    expect(undoButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Dismiss command error' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears a previous error once a valid command succeeds', async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Move a missing item' }));
    expect(screen.getByRole('alert')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Move orders' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
