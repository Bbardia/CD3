import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetProject,
  loadProject,
  readConflictProject,
  readLocalProject,
  readRemoteProject,
  remoteRevision,
  saveProject,
  stashConflictProject,
  writeLocalProject,
} from './persistence';
import { project } from '../workspace';

const offline = () => Promise.reject(new Error('offline'));
const remoteProject = (value = project, revision = 'rev-1') =>
  new Response(JSON.stringify(value), { status: 200, headers: { etag: revision } });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(offline));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.sequential('project persistence', () => {
  it('round-trips a project through the browser copy', () => {
    expect(writeLocalProject(project)).toBe(true);
    expect(readLocalProject()).toEqual(project);
  });

  it('ignores a stored copy the domain would reject', () => {
    localStorage.setItem('cd3.project.v1', JSON.stringify({ ...project, elements: 'nonsense' }));

    expect(readLocalProject()).toBeUndefined();
  });

  it('ignores stored text that is not a project at all', () => {
    localStorage.setItem('cd3.project.v1', '{ not json');

    expect(readLocalProject()).toBeUndefined();
  });

  it('prefers a dirty browser recovery over disk, then uses disk and sample as fallbacks', async () => {
    const disk = { ...project, name: 'From disk' };
    const recovery = { ...project, name: 'Unsaved browser edit' };
    writeLocalProject(recovery);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(disk, 'rev-disk')),
    );

    await expect(loadProject(project)).resolves.toEqual({ project: recovery, source: 'browser' });

    localStorage.clear();
    await expect(loadProject(project)).resolves.toEqual({ project: disk, source: 'disk' });

    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(offline));
    await expect(loadProject(project)).resolves.toEqual({ project, source: 'sample' });
    expect(readLocalProject()).toEqual(project);
  });

  it("does not let a slow startup read overwrite another tab's newly-dirty browser copy", async () => {
    let releaseRemote: (() => void) | undefined;
    const remoteGate = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await remoteGate;
        return remoteProject(project, 'rev-disk');
      }),
    );
    const loaded = loadProject(project);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const otherTabProject = { ...project, name: 'Other tab unsaved edit' };
    localStorage.setItem(
      'cd3.project.v1',
      JSON.stringify({
        baseRevision: 'rev-old',
        changeId: 'another-tab:1:1',
        formatVersion: 2,
        project: otherTabProject,
        state: 'dirty',
        updatedAt: Date.now(),
      }),
    );

    releaseRemote?.();
    await expect(loaded).resolves.toEqual({ project, source: 'disk' });
    expect(readLocalProject()).toEqual(otherTabProject);
  });

  it('upgrades an identical legacy browser copy without manufacturing a conflict', async () => {
    localStorage.setItem('cd3.project.v1', JSON.stringify(project));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-current')),
    );

    await expect(loadProject(project)).resolves.toEqual({ project, source: 'disk' });
    expect(remoteRevision()).toBe('rev-current');
  });

  it('preserves a differing legacy browser copy as recovery state', async () => {
    const legacyEdit = { ...project, name: 'Legacy unsaved edit' };
    localStorage.setItem('cd3.project.v1', JSON.stringify(legacyEdit));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-current')),
    );

    await expect(loadProject(project)).resolves.toEqual({
      project: legacyEdit,
      source: 'browser',
    });
  });

  it('keeps the browser copy dirty when the loopback service is unreachable', async () => {
    await loadProject(project);

    await expect(saveProject(project)).resolves.toBe('browser');
    expect(readLocalProject()).toEqual(project);
  });

  it('creates only after an explicit absent response and uses If-None-Match', async () => {
    await loadProject(project);
    const puts: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/revision')) {
          return new Response(null, { status: 404 });
        }
        if (init?.method === 'PUT') {
          puts.push(init);
          return new Response(null, { status: 200, headers: { etag: 'rev-created' } });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(saveProject(project)).resolves.toBe('disk');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.headers).toMatchObject({ 'if-none-match': '*' });
  });

  it('does not attempt an unguarded PUT when revision lookup fails', async () => {
    await loadProject(project);
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveProject(project)).resolves.toBe('browser');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not advance the save base merely by reading an external project', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-a')),
    );
    await loadProject(project);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject({ ...project, name: 'External edit' }, 'rev-b')),
    );

    await expect(readRemoteProject()).resolves.toMatchObject({ status: 'found' });
    expect(remoteRevision()).toBe('rev-a');
  });

  it('states its base revision and preserves the copy that loses a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-a')),
    );
    await loadProject(project);
    const edited = { ...project, name: 'Locally edited' };
    const puts: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        puts.push(init ?? {});
        return new Response(JSON.stringify({ revision: 'rev-b' }), {
          status: 409,
          headers: { etag: 'rev-b' },
        });
      }),
    );

    await expect(saveProject(edited)).resolves.toBe('conflict');

    expect(puts[0]?.headers).toMatchObject({ 'if-match': 'rev-a' });
    expect(readConflictProject()).toEqual(edited);
  });

  it('blocks external adoption when a conflicting edit cannot be stashed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-a')),
    );
    await loadProject(project);
    const edited = { ...project, name: 'Only in memory' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 409, headers: { etag: 'rev-b' } })),
    );
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'cd3.project.conflict.v1') {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });

    await expect(saveProject(edited)).resolves.toBe('failed');
    expect(readLocalProject()).toEqual(edited);
    expect(readConflictProject()).toBeUndefined();
  });

  it('serializes overlapping saves and advances the next write to the accepted revision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-0')),
    );
    await loadProject(project);
    const first = { ...project, name: 'First edit' };
    const second = { ...project, name: 'Second edit' };
    const puts: RequestInit[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        puts.push(init ?? {});
        if (puts.length === 1) {
          await firstGate;
          return new Response(null, { status: 200, headers: { etag: 'rev-1' } });
        }
        return new Response(null, { status: 200, headers: { etag: 'rev-2' } });
      }),
    );

    const firstSave = saveProject(first);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    const secondSave = saveProject(second);
    await Promise.resolve();
    expect(puts).toHaveLength(1);
    releaseFirst?.();

    await expect(firstSave).resolves.toBe('disk');
    await expect(secondSave).resolves.toBe('disk');
    expect(puts[0]?.headers).toMatchObject({ 'if-match': 'rev-0' });
    expect(puts[1]?.headers).toMatchObject({ 'if-match': 'rev-1' });
    expect(readLocalProject()).toEqual(second);
  });

  it('uses a separate save acknowledgment to restore the guarded base after reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-0')),
    );
    await loadProject(project);
    const edited = { ...project, name: 'Saved before reload' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200, headers: { etag: 'rev-1' } })),
    );
    await expect(saveProject(edited)).resolves.toBe('disk');

    vi.stubGlobal('fetch', vi.fn(offline));
    await expect(loadProject(project)).resolves.toEqual({ project: edited, source: 'browser' });
    const puts: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        puts.push(init ?? {});
        return new Response(null, { status: 200, headers: { etag: 'rev-2' } });
      }),
    );

    await expect(saveProject(edited)).resolves.toBe('disk');
    expect(puts[0]?.headers).toMatchObject({ 'if-match': 'rev-1' });
  });

  it("does not advance another tab's dirty snapshot to an unrelated accepted revision", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-0')),
    );
    await loadProject(project);
    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await saveGate;
        return new Response(null, { status: 200, headers: { etag: 'rev-1' } });
      }),
    );
    const save = saveProject({ ...project, name: 'This tab' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    localStorage.setItem(
      'cd3.project.v1',
      JSON.stringify({
        baseRevision: 'rev-0',
        changeId: 'another-tab:1:1',
        formatVersion: 2,
        project: { ...project, name: 'Another tab' },
        state: 'dirty',
        updatedAt: Date.now(),
      }),
    );

    releaseSave?.();
    await expect(save).resolves.toBe('disk');

    const stored = JSON.parse(localStorage.getItem('cd3.project.v1') ?? '{}') as {
      baseRevision?: unknown;
    };
    expect(stored.baseRevision).toBe('rev-0');
  });

  it('drains pending saves before reset and clears primary and recovery copies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => remoteProject(project, 'rev-0')),
    );
    await loadProject(project);
    const events: string[] = [];
    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          events.push('put');
          await saveGate;
          return new Response(null, { status: 200, headers: { etag: 'rev-1' } });
        }
        if (_url.endsWith('/revision')) {
          events.push('revision');
          return new Response(JSON.stringify({ revision: 'rev-1' }), { status: 200 });
        }
        if (init?.method === 'DELETE') {
          events.push('delete');
          expect(init.headers).toMatchObject({ 'if-match': 'rev-1' });
          return new Response(null, { status: 204 });
        }
        throw new Error('Unexpected request');
      }),
    );
    stashConflictProject({ ...project, name: 'Recovery' });
    const pendingSave = saveProject({ ...project, name: 'Pending' });
    await vi.waitFor(() => expect(events).toEqual(['put']));

    const reset = forgetProject();
    await Promise.resolve();
    expect(events).toEqual(['put']);
    releaseSave?.();

    await expect(pendingSave).resolves.toBe('disk');
    await expect(reset).resolves.toBe('forgotten');
    expect(events).toEqual(['put', 'revision', 'delete']);
    expect(readLocalProject()).toBeUndefined();
    expect(readConflictProject()).toBeUndefined();
    expect(localStorage.getItem('cd3.project.ack.v1')).toBeNull();
  });

  it('keeps browser recovery state when reset cannot delete disk', async () => {
    await loadProject(project);
    stashConflictProject(project);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(forgetProject()).resolves.toBe('disk-failed');
    expect(readLocalProject()).toEqual(project);
    expect(readConflictProject()).toEqual(project);
  });

  it('resumes persistence when browser storage prevents reset from completing', async () => {
    await loadProject(project);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });

    await expect(forgetProject()).resolves.toBe('browser-failed');
    remove.mockRestore();

    expect(writeLocalProject({ ...project, name: 'Edit after failed reset' })).toBe(true);
    expect(readLocalProject()?.name).toBe('Edit after failed reset');
  });
});
