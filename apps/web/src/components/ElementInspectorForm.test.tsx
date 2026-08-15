import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCommandToHistory,
  createCommandHistory,
  type DeepReadonly,
  type Element,
  type ElementChanges,
} from '@cd3/domain';

import { ElementInspectorForm } from './ElementInspectorForm';
import { project } from '../workspace';

function elementOf(elementId: string): DeepReadonly<Element> {
  const element = project.elements[elementId];
  if (element === undefined) {
    throw new Error(`Expected fixture element "${elementId}".`);
  }
  return element;
}

const orderService = elementOf('order-service');

/** Rebuild the element the way a real accepted command would, so identity changes like production. */
function elementAfter(changes: ElementChanges): DeepReadonly<Element> {
  const history = applyCommandToHistory(createCommandHistory(project), {
    type: 'update-element',
    elementId: 'order-service',
    changes,
  });
  const element = history.project.elements['order-service'];
  if (element === undefined) {
    throw new Error('The command removed the element under test.');
  }
  return element;
}

function renderForm(element: DeepReadonly<Element> = orderService) {
  const onSubmit = vi.fn<(changes: ElementChanges) => undefined>();
  const view = render(<ElementInspectorForm element={element} onSubmit={onSubmit} />);
  return { ...view, onSubmit };
}

const nameField = () => screen.getByLabelText('Name');
const descriptionField = () => screen.getByLabelText('Description');
const technologyField = () => screen.getByLabelText('Technology');
const tagsField = () => screen.getByLabelText('Tags');
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });

describe('ElementInspectorForm', () => {
  it('seeds every editable field from the canonical element', () => {
    renderForm();

    expect(nameField()).toHaveValue(orderService.name);
    expect(descriptionField()).toHaveValue(orderService.description ?? '');
    expect(technologyField()).toHaveValue(orderService.technology ?? '');
    expect(tagsField()).toHaveValue(orderService.tags.join(', '));
  });

  it('never exposes the protected identity, kind, or parent fields', () => {
    renderForm();

    expect(screen.queryByLabelText('ID')).toBeNull();
    expect(screen.queryByLabelText('Kind')).toBeNull();
    expect(screen.queryByLabelText('Parent')).toBeNull();
  });

  it('keeps typing local and emits nothing until the form is submitted', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'Renamed Service');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved draft')).toBeVisible();
  });

  it('submits only the fields that actually changed', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'Renamed Service');
    await user.click(saveButton());

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Renamed Service' });
  });

  it('submits cleared optional fields as undefined so the domain can remove them', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(technologyField());
    await user.click(saveButton());

    expect(onSubmit).toHaveBeenCalledWith({ technology: undefined });
  });

  it('parses comma separated tags into a trimmed list', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(tagsField());
    await user.type(tagsField(), ' checkout ,  billing ,, core ');
    await user.click(saveButton());

    expect(onSubmit).toHaveBeenCalledWith({ tags: ['checkout', 'billing', 'core'] });
  });

  it('treats a whitespace-only edit as no change and never emits a command', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(nameField(), '   ');

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('Matches current model')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a rejected command next to the form and keeps the typed draft', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => ({
      code: 'INVALID_PROJECT' as const,
      message: 'Element is invalid: name: Too small',
    }));
    render(<ElementInspectorForm element={orderService} onSubmit={onSubmit} />);

    await user.clear(nameField());
    await user.type(nameField(), 'x');
    await user.click(saveButton());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('INVALID_PROJECT');
    expect(alert).toHaveTextContent('Too small');
    expect(nameField()).toHaveValue('x');
  });

  it('clears a previous error as soon as the user edits again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => ({ code: 'INVALID_PROJECT' as const, message: 'rejected' }));
    render(<ElementInspectorForm element={orderService} onSubmit={onSubmit} />);

    await user.clear(nameField());
    await user.type(nameField(), 'x');
    await user.click(saveButton());
    expect(screen.getByRole('alert')).toBeVisible();

    await user.type(nameField(), 'y');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores canonical values when the edit is cancelled', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'Discarded');
    await user.click(cancelButton());

    expect(nameField()).toHaveValue(orderService.name);
    expect(saveButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cancels with the Escape key without letting it reach the surrounding app', async () => {
    const user = userEvent.setup();
    const keyDownOnParent = vi.fn<(event: { key: string }) => void>();
    render(
      <div onKeyDown={keyDownOnParent}>
        <ElementInspectorForm element={orderService} onSubmit={vi.fn()} />
      </div>,
    );

    await user.clear(nameField());
    await user.type(nameField(), 'Discarded');
    await user.keyboard('{Escape}');

    expect(nameField()).toHaveValue(orderService.name);
    // Ordinary typing must still bubble; only Escape is consumed by the form.
    expect(keyDownOnParent).toHaveBeenCalled();
    expect(keyDownOnParent.mock.calls.filter(([event]) => event.key === 'Escape')).toHaveLength(0);
  });

  it('submits from the keyboard when Enter is pressed in a single-line field', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'Keyboard Save{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Keyboard Save' });
  });

  it('adopts canonical values without prompting when the form has no unsaved draft', () => {
    const { rerender } = renderForm();
    const renamed = elementAfter({ name: 'Renamed By Undo' });

    rerender(<ElementInspectorForm element={renamed} onSubmit={vi.fn()} />);

    expect(nameField()).toHaveValue('Renamed By Undo');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adopts canonical values silently when they match what the user just saved', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'Renamed Service');
    await user.click(saveButton());

    rerender(
      <ElementInspectorForm
        element={elementAfter({ name: 'Renamed Service' })}
        onSubmit={vi.fn()}
      />,
    );

    expect(nameField()).toHaveValue('Renamed Service');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Matches current model')).toBeVisible();
  });

  it('asks before replacing an unsaved draft when the element changes underneath', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'My Unsaved Draft');

    rerender(
      <ElementInspectorForm
        element={elementAfter({ name: 'Changed Elsewhere' })}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('changed outside the form');
    expect(nameField()).toHaveValue('My Unsaved Draft');

    await user.click(screen.getByRole('button', { name: 'Discard my edits' }));

    expect(nameField()).toHaveValue('Changed Elsewhere');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the draft and stops asking when the user chooses to keep editing', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();

    await user.clear(nameField());
    await user.type(nameField(), 'My Unsaved Draft');

    rerender(
      <ElementInspectorForm
        element={elementAfter({ name: 'Changed Elsewhere' })}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(nameField()).toHaveValue('My Unsaved Draft');
    expect(saveButton()).toBeEnabled();
  });
});
