import { createServer } from 'node:net';

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

function portIsFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** Walks up from `start` to the first bindable port so a busy default is a hop, not a crash. */
export async function findFreePort(host: string, start: number, tries = 20): Promise<number> {
  for (let candidate = start; candidate < start + tries && candidate <= 65_535; candidate++) {
    if (await portIsFree(host, candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free port found between ${String(start)} and ${String(start + tries - 1)}.`);
}

// Publishing an address is the whole opt-in: it says who may reach CD3, so it also decides whether
// the socket leaves loopback. CD3 has no accounts — everyone who can reach a published instance
// shares one project and may edit it. Put an authenticating proxy in front for anything else.
export async function startServer(): Promise<FastifyInstance> {
  const server = buildServer();
  const published = publicAuthorities();
  const host = published === 'any' || published.length > 0 ? ALL_INTERFACES : LOOPBACK_HOST;

  // An explicit PORT and a published address both name an exact port people rely on, so those
  // must bind or fail loudly. Only the local default may hop when another program holds it.
  // ponytail: the probe-then-listen gap is a benign race — the loser still fails with EADDRINUSE.
  const requested = readPort(process.env.PORT);
  const port =
    process.env.PORT === undefined && host === LOOPBACK_HOST
      ? await findFreePort(host, requested)
      : requested;
  if (port !== requested) {
    server.log.warn(
      `Port ${String(requested)} is already in use; CD3 moved to ${String(port)}. Set PORT to pin one.`,
    );
  }
  await server.listen({ host, port });
  if (host === ALL_INTERFACES) {
    server.log.warn(
      `CD3 is reachable from the network on port ${String(port)}. Anyone who can reach it can read and edit the project.`,
    );
  }
  return server;
}
