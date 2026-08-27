import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WelcomeDialog } from './WelcomeDialog';
import { project } from '../workspace';

describe('WelcomeDialog first-run choice', () => {
  it('offers the sample and dismisses when the user chooses to explore it', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<WelcomeDialog onOpenProject={vi.fn()} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Explore the sample' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('opens a chosen project file and closes', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <WelcomeDialog onOpenProject={onOpenProject} onDismiss={onDismiss} />,
    );

    const file = new File([JSON.stringify(project)], 'mine.c4.json', {
      type: 'application/json',
    });
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (picker === null) {
      throw new Error('The dialog lost its file picker.');
    }
    await user.upload(picker, file);

    await waitFor(() => {
      expect(onOpenProject).toHaveBeenCalledTimes(1);
    });
    expect(onOpenProject.mock.calls[0]?.[0]).toMatchObject({ id: project.id });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that is not a project and stays open', async () => {
    const user = userEvent.setup();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const onOpenProject = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <WelcomeDialog onOpenProject={onOpenProject} onDismiss={onDismiss} />,
    );

    const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (picker === null) {
      throw new Error('The dialog lost its file picker.');
    }
    await user.upload(picker, new File(['not json'], 'notes.json', { type: 'application/json' }));

    await waitFor(() => {
      expect(alert).toHaveBeenCalledTimes(1);
    });
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
