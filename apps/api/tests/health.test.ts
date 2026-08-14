import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.js';

const servers = new Set<ReturnType<typeof buildServer>>();

afterEach(async () => {
  await Promise.all([...servers].map(async (server) => server.close()));
  servers.clear();
});

describe('GET /api/health', () => {
  it('reports a deterministic healthy response', async () => {
    const server = buildServer();
    servers.add(server);

    const response = await server.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      service: '@cd3/api',
      status: 'ok',
    });
  });
});
