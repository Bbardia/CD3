import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repositoryDirectory = fileURLToPath(new URL('..', import.meta.url));
const apiEntry = join(repositoryDirectory, 'apps/api/dist/server.js');
const webDirectory = join(repositoryDirectory, 'apps/web/dist');

async function reserveLoopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') {
    probe.close();
    throw new Error('Could not reserve a loopback port for the production smoke check.');
  }
  await new Promise((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function waitForApplication(port, child, childError, output) {
  const deadline = Date.now() + 10_000;
  let lastError;

  while (Date.now() < deadline) {
    const startupError = childError();
    if (startupError !== undefined) {
      throw new Error(`Production server could not start: ${startupError.message}\n${output()}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Production server exited before it became ready.\n${output()}`);
    }
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      const health = await healthResponse.json();
      if (!healthResponse.ok || health?.service !== '@cd3/api' || health?.status !== 'ok') {
        throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
      }

      const applicationResponse = await fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: AbortSignal.timeout(1_000),
      });
      const applicationHtml = await applicationResponse.text();
      if (!applicationResponse.ok || !applicationHtml.includes('<div id="root"></div>')) {
        throw new Error('The production server did not serve the built web application.');
      }
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Production server was not ready within 10 seconds: ${reason}\n${output()}`);
}

const port = await reserveLoopbackPort();
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cd3-production-smoke-'));
let capturedOutput = '';
let startupError;
const appendOutput = (chunk) => {
  capturedOutput = `${capturedOutput}${chunk.toString()}`.slice(-8_000);
};
const child = spawn(process.execPath, [apiEntry], {
  cwd: repositoryDirectory,
  env: {
    ...process.env,
    CD3_DATA_DIR: join(temporaryDirectory, 'data'),
    CD3_WEB_DIST: webDirectory,
    NODE_ENV: 'production',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', appendOutput);
child.stderr.on('data', appendOutput);
child.once('error', (error) => {
  startupError = error;
  appendOutput(error.stack ?? error.message);
});
const childExit = new Promise((resolve) => {
  child.once('error', resolve);
  child.once('exit', resolve);
});

try {
  await waitForApplication(
    port,
    child,
    () => startupError,
    () => capturedOutput,
  );
  console.log(`Production smoke check passed on 127.0.0.1:${String(port)}.`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    forceKill.unref();
    await childExit;
    clearTimeout(forceKill);
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
}
