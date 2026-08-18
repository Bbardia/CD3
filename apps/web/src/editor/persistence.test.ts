import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadProject, readLocalProject, saveProject, writeLocalProject } from './persistence';
import { project } from '../workspace';

const offline = () => Promise.reject(new Error('offline'));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(offline));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project persistence', () => {
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

  it('prefers the disk snapshot, then the browser copy, then the sample', async () => {
    const stored = { ...project, name: 'From disk' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(stored), { status: 200 })),
    );
    await expect(loadProject(project)).resolves.toMatchObject({ source: 'disk' });

    vi.stubGlobal('fetch', vi.fn(offline));
    writeLocalProject(project);
    await expect(loadProject(project)).resolves.toMatchObject({ source: 'browser' });

    localStorage.clear();
    await expect(loadProject(project)).resolves.toEqual({ project, source: 'sample' });
  });

  it('still saves to the browser when the loopback service is down', async () => {
    await expect(saveProject(project)).resolves.toBe('browser');
    expect(readLocalProject()).toEqual(project);
  });

  it('reports disk once the service accepts the snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    await expect(saveProject(project)).resolves.toBe('disk');
  });
});
