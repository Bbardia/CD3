import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceMenu } from './WorkspaceMenu';
import { stashConflictProject, writeLocalProject } from '../editor/persistence';
import { project } from '../workspace';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkspaceMenu persistence actions', () => {
  it('exposes a preserved conflict as a user-downloadable recovery copy', async () => {
    const user = userEvent.setup();
    stashConflictProject({ ...project, name: 'Recovered edits' });
    render(
      <WorkspaceMenu
        project={project}
        status="conflict"
        onExportPng={vi.fn()}
        onReplaceProject={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('Workspace menu'));

    expect(screen.getByRole('button', { name: 'Download recovery copy (JSON)' })).toBeVisible();
    expect(screen.getByText('Preserved after a save conflict.')).toBeVisible();
  });

  it('reports a failed reset and retains the browser project', async () => {
    const user = userEvent.setup();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    writeLocalProject(project);
    render(
      <WorkspaceMenu
        project={project}
        status="saved-browser"
        onExportPng={vi.fn()}
        onReplaceProject={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText('Workspace menu'));

    await user.click(screen.getByRole('button', { name: 'Reset to sample project' }));

    expect(alert).toHaveBeenCalledWith(
      'Reset failed because the disk copy could not be deleted. Your browser copy was kept.',
    );
    expect(localStorage.getItem('cd3.project.v1')).not.toBeNull();
  });
});
