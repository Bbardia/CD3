import Fastify, { type FastifyInstance } from 'fastify';

import { deleteSnapshot, readSnapshot, writeSnapshot } from './snapshot-store.js';

export function buildServer(): FastifyInstance {
  const server = Fastify({
    // A generated project of a few hundred elements serialises well under a megabyte, but the
    // default 1 MB body limit leaves no headroom for descriptions and properties.
    bodyLimit: 8 * 1024 * 1024,
    logger: process.env.NODE_ENV !== 'test',
  });

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

  server.delete('/api/project', async (_request, reply) => {
    await deleteSnapshot();
    return reply.code(204).send();
  });

  return server;
}
