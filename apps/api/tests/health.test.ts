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

    for (const host of ['localhost', 'localhost:5173', '127.0.0.1:6985', '[::1]:6985']) {
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
      headers: { host: '127.0.0.1:6985', origin: 'https://attacker.example' },
    });
    const allowedBrowser = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: '127.0.0.1:6985', origin: 'http://localhost:5173' },
    });
    const allowedCli = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: '127.0.0.1:6985' },
    });

    expect(rejected.statusCode).toBe(403);
    expect(allowedBrowser.statusCode).toBe(404);
    expect(allowedCli.statusCode).toBe(404);
  });
});

describe('a published instance (CD3_PUBLIC_ORIGIN)', () => {
  afterEach(() => {
    delete process.env['CD3_PUBLIC_ORIGIN'];
  });

  it('answers to the published address and still refuses every other hostname', async () => {
    process.env['CD3_PUBLIC_ORIGIN'] = 'http://cd3.lan:6985, 192.168.1.50:6985';
    const server = buildServer();
    servers.add(server);

    for (const host of ['cd3.lan:6985', 'CD3.LAN:6985', '192.168.1.50:6985', '127.0.0.1:6985']) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host },
      });
      expect(response.statusCode).toBe(200);
    }
    const stranger = await server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'attacker.example' },
    });
    expect(stranger.statusCode).toBe(403);
  });

  it('accepts any hostname under "*" but never a cross-origin mutation', async () => {
    process.env['CD3_PUBLIC_ORIGIN'] = '*';
    const server = buildServer();
    servers.add(server);

    const anyHost = await server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'cd3.internal:8080' },
    });
    // A TLS proxy forwards the browser's https Origin against a plain Host: same authority, so the
    // request is same-origin even though the schemes differ.
    const behindProxy = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: 'cd3.example', origin: 'https://cd3.example' },
    });
    const crossOrigin = await server.inject({
      method: 'POST',
      url: '/api/not-a-route',
      headers: { host: 'cd3.example', origin: 'https://attacker.example' },
    });

    expect(anyHost.statusCode).toBe(200);
    expect(behindProxy.statusCode).toBe(404);
    expect(crossOrigin.statusCode).toBe(403);
  });
});
