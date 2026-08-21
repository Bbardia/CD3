import { fileURLToPath } from 'node:url';

import { buildServer, publicAuthorities } from './app.js';

const LOOPBACK_HOST = '127.0.0.1';
const ALL_INTERFACES = '0.0.0.0';

// `pnpm start` serves the built web app from the sibling workspace unless told otherwise.
if (process.env['CD3_WEB_DIST'] === undefined) {
  process.env['CD3_WEB_DIST'] = fileURLToPath(new URL('../../web/dist', import.meta.url));
}
const DEFAULT_PORT = 3100;

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

const server = buildServer();

// Publishing an address is the whole opt-in: it says who may reach CD3, so it also decides whether
// the socket leaves loopback. CD3 has no accounts — everyone who can reach a published instance
// shares one project and may edit it. Put an authenticating proxy in front for anything else.
const published = publicAuthorities();
const host = published === 'any' || published.length > 0 ? ALL_INTERFACES : LOOPBACK_HOST;

try {
  const port = readPort(process.env.PORT);
  await server.listen({ host, port });
  if (host === ALL_INTERFACES) {
    server.log.warn(
      `CD3 is reachable from the network on port ${String(port)}. Anyone who can reach it can read and edit the project.`,
    );
  }
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
