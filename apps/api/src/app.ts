import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  server.get('/api/health', async () => ({
    schemaVersion: 1,
    service: '@cd3/api',
    status: 'ok',
  }));

  return server;
}
