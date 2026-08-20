import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function saveSample(server: ReturnType<typeof startServer>): Promise<string> {
  const saved = await server.inject({
    method: 'PUT',
    url: '/api/project',
    payload: northstarCommerceProject,
  });
  return (saved.json() as { revision: string }).revision;
}

describe('project snapshots', () => {
  it('reports no snapshot before anything has been saved', async () => {
    const response = await startServer().inject({ method: 'GET', url: '/api/project' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
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
    expect(saved.json()).toMatchObject({ id: northstarCommerceProject.id, status: 'saved' });
    expect((saved.json() as { revision: string }).revision).toMatch(/^[0-9a-f]{16}$/);
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

  it('rejects a project with no view before it can reach the editor', async () => {
    const server = startServer();
    const revision = await saveSample(server);

    const rejected = await server.inject({
      method: 'PUT',
      url: '/api/project',
      headers: { 'if-match': revision },
      payload: {
        ...northstarCommerceProject,
        threeD: { ...northstarCommerceProject.threeD, bookmarks: {} },
        views: {},
      },
    });

    expect(rejected.statusCode).toBe(400);
    expect((rejected.json() as { error: string }).error).toContain(
      'A project needs at least one view.',
    );
    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    expect(loaded.headers.etag).toBe(revision);
    expect(loaded.json()).toEqual(northstarCommerceProject);
  });

  it('does not classify an existing legacy-invalid snapshot as absent or overwrite it on create', async () => {
    const server = startServer();
    const legacyInvalid = {
      ...northstarCommerceProject,
      threeD: { ...northstarCommerceProject.threeD, bookmarks: {} },
      views: {},
    };
    const path = join(dataDirectory, 'project.c4.json');
    await writeFile(path, JSON.stringify(legacyInvalid), 'utf8');

    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    const revision = await server.inject({ method: 'GET', url: '/api/project/revision' });
    const createOnly = await server.inject({
      method: 'PUT',
      url: '/api/project',
      headers: { 'if-none-match': '*' },
      payload: northstarCommerceProject,
    });

    expect(loaded.statusCode).toBe(500);
    expect(loaded.json()).toMatchObject({ code: 'SNAPSHOT_INVALID' });
    expect(revision.statusCode).toBe(500);
    expect(createOnly.statusCode).toBe(409);
    expect(createOnly.json()).toMatchObject({ code: 'REVISION_CONFLICT', revision: null });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(legacyInvalid);

    // An explicit unguarded replace remains available after the user has recovered the old bytes.
    const replaced = await server.inject({
      method: 'PUT',
      url: '/api/project',
      payload: northstarCommerceProject,
    });
    expect(replaced.statusCode).toBe(200);
  });
});

describe('snapshot preconditions', () => {
  it('rejects malformed revision conditions instead of treating them as unguarded writes', async () => {
    const server = startServer();

    for (const value of ['W/', 'W/*', '*, "other"', '"unterminated']) {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/project',
        headers: { 'if-none-match': value },
        payload: northstarCommerceProject,
      });
      expect(response.statusCode).toBe(400);
    }

    expect((await server.inject({ method: 'GET', url: '/api/project' })).statusCode).toBe(404);
  });

  it('serializes concurrent create-only writers so exactly one initial snapshot wins', async () => {
    const server = startServer();
    const writerA = { ...northstarCommerceProject, name: 'Writer A' };
    const writerB = { ...northstarCommerceProject, name: 'Writer B' };

    const [first, second] = await Promise.all([
      server.inject({
        method: 'PUT',
        url: '/api/project',
        headers: { 'if-none-match': '*' },
        payload: writerA,
      }),
      server.inject({
        method: 'PUT',
        url: '/api/project',
        headers: { 'if-none-match': '*' },
        payload: writerB,
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 409 ? first : second;
    const winningRevision = (winner.json() as { revision: string }).revision;
    expect(loser.headers.etag).toBe(winningRevision);
    expect(loser.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      revision: winningRevision,
    });

    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    expect((loaded.json() as { name: string }).name).toBe(
      first.statusCode === 200 ? 'Writer A' : 'Writer B',
    );
  });

  it('rejects a stale If-Match after deletion instead of recreating the snapshot', async () => {
    const server = startServer();
    const revision = await saveSample(server);
    await server.inject({ method: 'DELETE', url: '/api/project' });

    const staleWrite = await server.inject({
      method: 'PUT',
      url: '/api/project',
      headers: { 'if-match': revision },
      payload: { ...northstarCommerceProject, name: 'Must not return' },
    });

    expect(staleWrite.statusCode).toBe(409);
    expect(staleWrite.headers.etag).toBeUndefined();
    expect(staleWrite.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      revision: null,
    });
    expect((await server.inject({ method: 'GET', url: '/api/project' })).statusCode).toBe(404);
  });

  it('lets only one guarded update or delete win from the same revision', async () => {
    const server = startServer();
    const revision = await saveSample(server);

    const [updated, deleted] = await Promise.all([
      server.inject({
        method: 'PUT',
        url: '/api/project',
        headers: { 'if-match': `"${revision}"` },
        payload: { ...northstarCommerceProject, name: 'Guarded update' },
      }),
      server.inject({
        method: 'DELETE',
        url: '/api/project',
        headers: { 'if-match': revision },
      }),
    ]);

    expect(
      [updated.statusCode, deleted.statusCode].filter((status) => status === 409),
    ).toHaveLength(1);
    expect(updated.statusCode === 200 || deleted.statusCode === 204).toBe(true);

    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    if (updated.statusCode === 200) {
      expect(deleted.statusCode).toBe(409);
      expect(loaded.statusCode).toBe(200);
      expect((loaded.json() as { name: string }).name).toBe('Guarded update');
    } else {
      expect(updated.statusCode).toBe(409);
      expect(deleted.statusCode).toBe(204);
      expect(loaded.statusCode).toBe(404);
    }
  });

  it('rejects a guarded delete after the snapshot changes and returns the current revision', async () => {
    const server = startServer();
    const staleRevision = await saveSample(server);
    const replacement = await server.inject({
      method: 'PUT',
      url: '/api/project',
      headers: { 'if-match': staleRevision },
      payload: { ...northstarCommerceProject, name: 'Replacement' },
    });
    const currentRevision = (replacement.json() as { revision: string }).revision;

    const deleted = await server.inject({
      method: 'DELETE',
      url: '/api/project',
      headers: { 'if-match': staleRevision },
    });

    expect(deleted.statusCode).toBe(409);
    expect(deleted.headers.etag).toBe(currentRevision);
    expect(deleted.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      revision: currentRevision,
    });
    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    expect((loaded.json() as { name: string }).name).toBe('Replacement');
  });
});

describe('command endpoint', () => {
  it('applies a command against the stored snapshot and bumps the revision', async () => {
    const server = startServer();
    const revision = await saveSample(server);

    const response = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: {
        command: {
          type: 'update-element',
          elementId: 'order-service',
          changes: { name: 'Order Orchestrator' },
        },
      },
    });
    const body = response.json() as { applied: number; revision: string };

    expect(response.statusCode).toBe(200);
    expect(body.applied).toBe(1);
    expect(body.revision).not.toBe(revision);

    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    expect(loaded.headers.etag).toBe(body.revision);
    expect(
      (loaded.json() as typeof northstarCommerceProject).elements['order-service'],
    ).toMatchObject({ name: 'Order Orchestrator' });
  });

  it('keeps a failing batch atomic and reports the failing position', async () => {
    const server = startServer();
    const revision = await saveSample(server);

    const response = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: {
        commands: [
          { type: 'update-element', elementId: 'order-service', changes: { name: 'Renamed' } },
          { type: 'delete-element', elementId: 'does-not-exist' },
        ],
      },
    });
    const body = response.json() as { code: string; failedAt: number };

    expect(response.statusCode).toBe(400);
    expect(body.code).toBe('ELEMENT_NOT_FOUND');
    expect(body.failedAt).toBe(1);

    const loaded = await server.inject({ method: 'GET', url: '/api/project' });
    expect(loaded.headers.etag).toBe(revision);
    expect(
      (loaded.json() as typeof northstarCommerceProject).elements['order-service'],
    ).toMatchObject({ name: 'Order Service' });
  });

  it('rejects a stale baseRevision and a stale If-Match PUT with the current revision', async () => {
    const server = startServer();
    await saveSample(server);

    const staleCommand = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: {
        baseRevision: 'stale',
        command: { type: 'delete-relationship', relationshipId: 'shopper-buys' },
      },
    });
    expect(staleCommand.statusCode).toBe(409);
    expect((staleCommand.json() as { revision: string }).revision).toBeTruthy();

    const stalePut = await server.inject({
      method: 'PUT',
      url: '/api/project',
      headers: { 'if-match': 'stale' },
      payload: northstarCommerceProject,
    });
    expect(stalePut.statusCode).toBe(409);
  });

  it('refuses to edit before any snapshot exists and rejects malformed bodies', async () => {
    const server = startServer();

    const noSnapshot = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { command: { type: 'delete-element', elementId: 'x' } },
    });
    expect(noSnapshot.statusCode).toBe(409);

    await saveSample(server);
    const malformed = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { nothing: true },
    });
    expect(malformed.statusCode).toBe(400);

    const unknown = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { command: { type: 'rename-element', elementId: 'order-service' } },
    });
    expect(unknown.statusCode).toBe(400);
    expect((unknown.json() as { code: string }).code).toBe('INVALID_COMMAND');
  });

  it('serializes concurrent guarded writers: exactly one wins, one gets 409', async () => {
    const server = startServer();
    const revision = await saveSample(server);

    const [put, post] = await Promise.all([
      server.inject({
        method: 'PUT',
        url: '/api/project',
        headers: { 'if-match': revision },
        payload: { ...northstarCommerceProject, name: 'Writer A' },
      }),
      server.inject({
        method: 'POST',
        url: '/api/commands',
        payload: {
          baseRevision: revision,
          command: {
            type: 'update-element',
            elementId: 'order-service',
            changes: { name: 'Writer B' },
          },
        },
      }),
    ]);

    const statuses = [put.statusCode, post.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const loaded = (await server.inject({ method: 'GET', url: '/api/project' })).json() as {
      name: string;
      elements: Record<string, { name: string }>;
    };
    const winnerWasPut = put.statusCode === 200;
    expect(winnerWasPut ? loaded.name : loaded.elements['order-service']?.name).toBe(
      winnerWasPut ? 'Writer A' : 'Writer B',
    );
  });

  it('rejects absurdly deep bodies with 400 instead of overflowing the stack', async () => {
    const server = startServer();
    await saveSample(server);
    let deep: unknown = 1;
    for (let i = 0; i < 4000; i += 1) {
      deep = [deep];
    }

    const command = await server.inject({
      method: 'POST',
      url: '/api/commands',
      payload: {
        command: {
          type: 'update-element',
          elementId: 'order-service',
          changes: { properties: { d: deep } },
        },
      },
    });
    const put = await server.inject({
      method: 'PUT',
      url: '/api/project',
      payload: { ...northstarCommerceProject, elements: { deep } },
    });

    expect(command.statusCode).toBe(400);
    expect(put.statusCode).toBe(400);
  });

  it('reports a corrupt snapshot as invalid instead of absent or crashing', async () => {
    const server = startServer();
    await saveSample(server);
    await writeFile(join(dataDirectory, 'project.c4.json'), '{ not json', 'utf8');

    expect((await server.inject({ method: 'GET', url: '/api/project' })).statusCode).toBe(500);
    expect((await server.inject({ method: 'GET', url: '/api/project/revision' })).statusCode).toBe(
      500,
    );
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { command: { type: 'delete-element', elementId: 'x' } },
        })
      ).statusCode,
    ).toBe(500);
  });

  it('keeps the revision stable when identical content is written again', async () => {
    const server = startServer();
    const revision = await saveSample(server);
    const again = await server.inject({
      method: 'PUT',
      url: '/api/project',
      payload: northstarCommerceProject,
    });

    expect((again.json() as { revision: string }).revision).toBe(revision);
  });
});

describe('production web serving', () => {
  it('serves the built app and falls back to index.html for SPA routes', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'cd3-webdist-'));
    await writeFile(join(webDist, 'index.html'), '<title>CD3</title>', 'utf8');
    process.env['CD3_WEB_DIST'] = webDist;
    try {
      const server = startServer();

      const root = await server.inject({ method: 'GET', url: '/' });
      const spaRoute = await server.inject({ method: 'GET', url: '/some/client/route' });
      const missingApi = await server.inject({ method: 'GET', url: '/api/missing' });

      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('CD3');
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain('CD3');
      expect(missingApi.statusCode).toBe(404);
    } finally {
      delete process.env['CD3_WEB_DIST'];
      await rm(webDist, { force: true, recursive: true });
    }
  });
});
