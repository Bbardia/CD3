import { buildServer } from './app.js';

const LOOPBACK_HOST = '127.0.0.1';
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

try {
  await server.listen({ host: LOOPBACK_HOST, port: readPort(process.env.PORT) });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
