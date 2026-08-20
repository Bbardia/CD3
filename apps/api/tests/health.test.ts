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

  it('accepts only literal loopback Host authorities', async () => {
    const server = buildServer();
    servers.add(server);

    for (const host of ['localhost', 'localhost:5173', '127.0.0.1:3100', '[::1]:3100']) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host },
      });
      expect(response.statusCode).toBe(200);
    }

    for (const host of ['attacker.example', '127.0.0.1.attacker.example', 'localhost:99999']) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('rejects non-loopback browser origins on API mutations', async () => {
    const server = buildServer();
    servers.add(server);

    const rejected = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: '127.0.0.1:3100', origin: 'https://attacker.example' },
    });
    const allowedBrowser = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: '127.0.0.1:3100', origin: 'http://localhost:5173' },
    });
    const allowedCli = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: '127.0.0.1:3100' },
    });

    expect(rejected.statusCode).toBe(403);
    expect(allowedBrowser.statusCode).toBe(404);
    expect(allowedCli.statusCode).toBe(404);
  });
});
