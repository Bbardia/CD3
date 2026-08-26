import type { FastifyInstance } from 'fastify';

import { buildServer, publicAuthorities } from './app.js';

const LOOPBACK_HOST = '127.0.0.1';
const ALL_INTERFACES = '0.0.0.0';
const DEFAULT_PORT = 6985;

function readPort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

// Publishing an address is the whole opt-in: it says who may reach CD3, so it also decides whether
// the socket leaves loopback. CD3 has no accounts — everyone who can reach a published instance
// shares one project and may edit it. Put an authenticating proxy in front for anything else.
export async function startServer(): Promise<FastifyInstance> {
  const server = buildServer();
  const published = publicAuthorities();
  const host = published === 'any' || published.length > 0 ? ALL_INTERFACES : LOOPBACK_HOST;

  const port = readPort(process.env.PORT);
  await server.listen({ host, port });
  if (host === ALL_INTERFACES) {
    server.log.warn(
      `CD3 is reachable from the network on port ${String(port)}. Anyone who can reach it can read and edit the project.`,
    );
  }
  return server;
}
