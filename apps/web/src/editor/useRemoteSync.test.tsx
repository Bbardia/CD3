import { act, render } from '@testing-library/react';
import type { ReadonlyProject } from '@cd3/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadProject, remoteRevision } from './persistence';
import { useRemoteSync } from './useRemoteSync';
import { project } from '../workspace';

function RemoteSyncProbe({
  canAdopt,
  onExternalProject,
}: {
  readonly canAdopt: () => boolean;
  readonly onExternalProject: (value: ReadonlyProject) => void;
}) {
  useRemoteSync(onExternalProject, canAdopt);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useRemoteSync', () => {
  it('does not advance the base or adopt when an edit begins during the remote read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(project), { status: 200, headers: { etag: 'rev-a' } }),
      ),
    );
    await loadProject(project);

    let canAdopt = true;
    let releaseProject: (() => void) | undefined;
    const projectGate = new Promise<void>((resolve) => {
      releaseProject = resolve;
    });
    let signalProjectRequested: (() => void) | undefined;
    const projectRequested = new Promise<void>((resolve) => {
      signalProjectRequested = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/revision')) {
          return new Response(JSON.stringify({ revision: 'rev-b' }), { status: 200 });
        }
        signalProjectRequested?.();
        await projectGate;
        return new Response(JSON.stringify({ ...project, name: 'External edit' }), {
          status: 200,
          headers: { etag: 'rev-b' },
        });
      }),
    );
    const onExternalProject = vi.fn();
    render(<RemoteSyncProbe canAdopt={() => canAdopt} onExternalProject={onExternalProject} />);

    act(() => vi.advanceTimersByTime(3_000));
    await projectRequested;
    canAdopt = false;
    releaseProject?.();
    await act(async () => Promise.resolve());

    expect(onExternalProject).not.toHaveBeenCalled();
    expect(remoteRevision()).toBe('rev-a');
  });
});
