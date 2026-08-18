import { existsSync } from 'node:fs';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  deleteSnapshot,
  listSnapshotVersions,
  readSnapshot,
  readSnapshotVersion,
  writeSnapshot,
} from './snapshot-store.js';

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
    const project = await readSnapshot();
    if (project === undefined) {
      return reply.code(404).send({ error: 'No project snapshot has been saved yet.' });
    }
    return project;
  });

  server.put('/api/project', async (request, reply) => {
    try {
      const project = await writeSnapshot(request.body);
      return reply.code(200).send({ id: project.id, status: 'saved' });
    } catch (error) {
      if (error instanceof TypeError) {
        return reply.code(400).send({ error: `Project is invalid: ${error.message}` });
      }
      throw error;
    }
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
    await deleteSnapshot();
    return reply.code(204).send();
  });

  return server;
}
