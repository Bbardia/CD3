import { existsSync } from 'node:fs';

import fastifyStatic from '@fastify/static';
import { applyCommands, DomainCommandError, type DomainCommand } from '@cd3/domain';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  deleteSnapshot,
  listSnapshotVersions,
  readSnapshot,
  readSnapshotRevision,
  readSnapshotVersion,
  withSnapshotLock,
  writeSnapshot,
} from './snapshot-store.js';

/**
 * Structural ceiling for request bodies, checked iteratively before any recursive machinery
 * (structuredClone, zod) can hit the call stack: the schema allows 8 levels of JSON properties,
 * plus wrapper levels, with generous headroom.
 */
const MAX_BODY_DEPTH = 32;

function bodyTooDeep(root: unknown): boolean {
  let level: readonly unknown[] = [root];
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth > MAX_BODY_DEPTH) {
      return true;
    }
    const next: unknown[] = [];
    for (const value of level) {
      if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
          next.push((value as Record<string, unknown>)[key]);
        }
      }
    }
    level = next;
  }
  return false;
}

/** One command or a batch; a batch is atomic — either every command lands or none do. */
function commandsOf(body: unknown): readonly unknown[] | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  if ('commands' in body && Array.isArray(body.commands)) {
    return body.commands.length >= 1 && body.commands.length <= 100 ? body.commands : undefined;
  }
  if ('command' in body && typeof body.command === 'object' && body.command !== null) {
    return [body.command];
  }
  return undefined;
}

/** Finds which command a failed batch died on, applying prefixes until one fails. */
function failingIndex(
  project: Parameters<typeof applyCommands>[0],
  commands: readonly DomainCommand[],
): number {
  for (const [index] of commands.entries()) {
    try {
      applyCommands(project, commands.slice(0, index + 1));
    } catch {
      return index;
    }
  }
  return commands.length - 1;
}

function baseRevisionOf(body: unknown): string | undefined {
  return typeof body === 'object' &&
    body !== null &&
    'baseRevision' in body &&
    typeof body.baseRevision === 'string'
    ? body.baseRevision
    : undefined;
}

export function buildServer(): FastifyInstance {
  const server = Fastify({
    // A generated project of a few hundred elements serialises well under a megabyte, but the
    // default 1 MB body limit leaves no headroom for descriptions and properties.
    bodyLimit: 8 * 1024 * 1024,
    logger: process.env.NODE_ENV !== 'test',
  });

  // Production mode: when a built web app is present, this server is the whole application.
  const webDist = process.env['CD3_WEB_DIST'];
  if (webDist !== undefined && existsSync(webDist)) {
    void server.register(fastifyStatic, { root: webDist });
    server.setNotFoundHandler(async (request, reply) => {
      // The SPA owns every non-API route; unknown API routes stay honest 404s.
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: `Route ${request.url} does not exist.` });
      }
      return reply.sendFile('index.html');
    });
  }

  server.get('/api/health', async () => ({
    schemaVersion: 1,
    service: '@cd3/api',
    status: 'ok',
  }));

  server.get('/api/project', async (_request, reply) => {
    const stored = await readSnapshot();
    if (stored === undefined) {
      return reply.code(404).send({ error: 'No project snapshot has been saved yet.' });
    }
    return reply.header('etag', stored.revision).send(stored.project);
  });

  server.get('/api/project/revision', async (_request, reply) => {
    const revision = await readSnapshotRevision();
    if (revision === undefined) {
      return reply.code(404).send({ error: 'No project snapshot has been saved yet.' });
    }
    return { revision };
  });

  server.put('/api/project', async (request, reply) => {
    if (bodyTooDeep(request.body)) {
      return reply
        .code(400)
        .send({ error: `Project is invalid: nesting exceeds ${String(MAX_BODY_DEPTH)} levels.` });
    }
    // The guard and the write happen under one lock, so a writer that states where it started from
    // can never interleave with another writer and clobber a snapshot it did not read.
    return withSnapshotLock(async () => {
      const expected = request.headers['if-match'];
      if (typeof expected === 'string' && expected !== '') {
        const current = await readSnapshotRevision();
        if (current !== undefined && current !== expected) {
          return reply.code(409).header('etag', current).send({
            error: 'The stored project changed since this copy was read.',
            revision: current,
          });
        }
      }
      try {
        const stored = await writeSnapshot(request.body);
        return reply
          .code(200)
          .header('etag', stored.revision)
          .send({ id: stored.project.id, status: 'saved', revision: stored.revision });
      } catch (error) {
        if (error instanceof TypeError) {
          return reply.code(400).send({ error: `Project is invalid: ${error.message}` });
        }
        throw error;
      }
    });
  });

  server.post('/api/commands', async (request, reply) => {
    if (bodyTooDeep(request.body)) {
      return reply
        .code(400)
        .send({ error: `Command body nesting exceeds ${String(MAX_BODY_DEPTH)} levels.` });
    }
    const commands = commandsOf(request.body);
    if (commands === undefined) {
      return reply.code(400).send({
        error: 'Send { command: {...} } or { commands: [...] } with 1 to 100 domain commands.',
      });
    }
    return withSnapshotLock(async () => {
      const stored = await readSnapshot();
      if (stored === undefined) {
        return reply.code(409).send({
          error: 'No project snapshot to edit. Save one first: open the app or PUT /api/project.',
        });
      }
      const baseRevision = baseRevisionOf(request.body);
      if (baseRevision !== undefined && baseRevision !== stored.revision) {
        return reply.code(409).header('etag', stored.revision).send({
          error: 'The stored project changed since baseRevision was read.',
          revision: stored.revision,
        });
      }

      // One validation boundary for the whole batch; a failure reports its position and nothing
      // is persisted. DomainCommandError does not say which command failed, so locate it by
      // bisection-free re-application only when the cheap single pass fails.
      try {
        const { project } = applyCommands(stored.project, commands as readonly DomainCommand[]);
        const written = await writeSnapshot(project);
        return reply
          .header('etag', written.revision)
          .send({ applied: commands.length, revision: written.revision });
      } catch (error) {
        if (error instanceof DomainCommandError) {
          return reply.code(400).send({
            error: error.message,
            code: error.code,
            failedAt: failingIndex(stored.project, commands as readonly DomainCommand[]),
            revision: stored.revision,
          });
        }
        throw error;
      }
    });
  });

  server.get('/api/project/history', async () => ({ versions: await listSnapshotVersions() }));

  server.get('/api/project/history/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const snapshot = await readSnapshotVersion(id);
    if (snapshot === undefined) {
      return reply.code(404).send({ error: `Version "${id}" does not exist.` });
    }
    return snapshot;
  });

  server.delete('/api/project', async (_request, reply) => {
    await withSnapshotLock(deleteSnapshot);
    return reply.code(204).send();
  });

  return server;
}
