import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { northstarCommerceProject } from '@cd3/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/app.js';

const servers = new Set<ReturnType<typeof buildServer>>();
let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'cd3-snapshot-'));
  process.env['CD3_DATA_DIR'] = dataDirectory;
});

afterEach(async () => {
  await Promise.all([...servers].map(async (server) => server.close()));
  servers.clear();
  delete process.env['CD3_DATA_DIR'];
  await rm(dataDirectory, { force: true, recursive: true });
});

function startServer() {
  const server = buildServer();
  servers.add(server);
  return server;
}

describe('project snapshots', () => {
  it('reports no snapshot before anything has been saved', async () => {
    const response = await startServer().inject({ method: 'GET', url: '/api/project' });

    expect(response.statusCode).toBe(404);
  });

  it('round-trips a saved project byte-for-byte', async () => {
    const server = startServer();

    const saved = await server.inject({
      method: 'PUT',
      url: '/api/project',
      payload: northstarCommerceProject,
    });
    const loaded = await server.inject({ method: 'GET', url: '/api/project' });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ id: northstarCommerceProject.id, status: 'saved' });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(northstarCommerceProject);
  });

  it('forgets the snapshot on delete so the next load falls back to the sample', async () => {
    const server = startServer();
    await server.inject({ method: 'PUT', url: '/api/project', payload: northstarCommerceProject });

    const deleted = await server.inject({ method: 'DELETE', url: '/api/project' });
    const loaded = await server.inject({ method: 'GET', url: '/api/project' });

    expect(deleted.statusCode).toBe(204);
    expect(loaded.statusCode).toBe(404);
  });

  it('checkpoints the previous snapshot and serves it back as a version', async () => {
    const server = startServer();
    const renamed = { ...northstarCommerceProject, name: 'Northstar v2' };

    await server.inject({ method: 'PUT', url: '/api/project', payload: northstarCommerceProject });
    await server.inject({ method: 'PUT', url: '/api/project', payload: renamed });

    const listed = await server.inject({ method: 'GET', url: '/api/project/history' });
    const { versions } = listed.json() as { versions: string[] };
    expect(versions).toHaveLength(1);

    const version = await server.inject({
      method: 'GET',
      url: `/api/project/history/${versions[0] ?? ''}`,
    });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toEqual(northstarCommerceProject);

    // A third save inside the checkpoint interval must not mint another version.
    await server.inject({ method: 'PUT', url: '/api/project', payload: northstarCommerceProject });
    const relisted = await server.inject({ method: 'GET', url: '/api/project/history' });
    expect((relisted.json() as { versions: string[] }).versions).toHaveLength(1);

    // Reset clears history with the snapshot.
    await server.inject({ method: 'DELETE', url: '/api/project' });
    const cleared = await server.inject({ method: 'GET', url: '/api/project/history' });
    expect((cleared.json() as { versions: string[] }).versions).toHaveLength(0);
  });

  it('rejects a traversal-shaped version id', async () => {
    const response = await startServer().inject({
      method: 'GET',
      url: '/api/project/history/..%2Fproject',
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a project the domain would not accept, leaving the stored one intact', async () => {
    const server = startServer();
    await server.inject({ method: 'PUT', url: '/api/project', payload: northstarCommerceProject });

    const rejected = await server.inject({
      method: 'PUT',
      url: '/api/project',
      payload: { ...northstarCommerceProject, elements: { broken: { kind: 'nonsense' } } },
    });
    const loaded = await server.inject({ method: 'GET', url: '/api/project' });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toContain('Project is invalid');
    expect(loaded.json()).toEqual(northstarCommerceProject);
  });
});
