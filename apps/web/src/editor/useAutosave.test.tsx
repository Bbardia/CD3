import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import type { ReadonlyProject } from '@cd3/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLocalProject,
  readConflictProject,
  readLocalProject,
  type ProjectSource,
} from './persistence';
import { useAutosave } from './useAutosave';
import { project } from '../workspace';

function AutosaveProbe({
  adoptedValue,
  source = 'disk',
  value,
}: {
  readonly adoptedValue?: ReadonlyProject;
  readonly source?: ProjectSource;
  readonly value: ReadonlyProject;
}) {
  const adopted = useRef<ReadonlyProject | null>(null);
  adopted.current = adoptedValue ?? null;
  const status = useAutosave(value, adopted, source);
  return <span data-testid="save-status">{status}</span>;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAutosave', () => {
  it('writes an edit locally before the disk debounce and restores it on pagehide', () => {
    const edited = { ...project, name: 'Last-second edit' };
    const view = render(<AutosaveProbe value={project} />);

    view.rerender(<AutosaveProbe value={edited} />);

    expect(readLocalProject()).toEqual(edited);
    expect(screen.getByTestId('save-status')).toHaveTextContent('saving');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    expect(clearLocalProject()).toBe(true);
    fireEvent(window, new Event('pagehide'));
    expect(readLocalProject()).toEqual(edited);
  });

  it('seeds a sample project with a guarded disk create', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/revision')) {
          return new Response(null, { status: 404 });
        }
        calls.push(init ?? {});
        return new Response(null, { status: 200, headers: { etag: 'rev-created' } });
      }),
    );

    render(
      <StrictMode>
        <AutosaveProbe source="sample" value={project} />
      </StrictMode>,
    );
    expect(readLocalProject()).toEqual(project);

    await act(async () => vi.advanceTimersByTimeAsync(600));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({ 'if-none-match': '*' });
    expect(screen.getByTestId('save-status')).toHaveTextContent('saved-disk');
  });

  it('clears stale conflict status after adoption without clearing the recovery copy', async () => {
    const edited = { ...project, name: 'Losing local edit' };
    const firstExternal = { ...project, name: 'First external edit' };
    const secondExternal = { ...project, name: 'Second external edit' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 409, headers: { etag: 'rev-external' } })),
    );
    const view = render(<AutosaveProbe value={project} />);
    view.rerender(<AutosaveProbe value={edited} />);
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByTestId('save-status')).toHaveTextContent('conflict');
    expect(readConflictProject()).toEqual(edited);

    view.rerender(<AutosaveProbe adoptedValue={firstExternal} value={firstExternal} />);
    expect(screen.getByTestId('save-status')).toHaveTextContent('saved-disk');
    view.rerender(<AutosaveProbe adoptedValue={secondExternal} value={secondExternal} />);

    expect(screen.getByTestId('save-status')).toHaveTextContent('saved-disk');
    expect(readConflictProject()).toEqual(edited);
  });
});
