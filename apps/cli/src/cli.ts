import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The npx entry is the production server plus sensible defaults: the same Fastify instance that
// backs `pnpm start` and the desktop shell, serving the web bundle packaged alongside this file.
import { startServer } from '@cd3/api/start';

// Without an explicit data dir, snapshots would land inside the npx cache and vanish on the next
// prune or version bump. A dotfolder in the home directory survives both.
process.env['CD3_DATA_DIR'] ??= join(homedir(), '.cd3');
process.env['CD3_WEB_DIST'] ??= join(__dirname, '../web');
process.env['NODE_ENV'] ??= 'production';

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {
    // No opener available (SSH session, minimal container): the printed URL is enough.
  });
}

startServer()
  .then((server) => {
    const address = server.server.address();
    if (address === null || typeof address === 'string') {
      return;
    }
    const url = `http://127.0.0.1:${String(address.port)}`;
    // A published instance is for other people's browsers; only a local session gets one opened.
    if (process.env['CD3_PUBLIC_ORIGIN'] === undefined && process.stdout.isTTY) {
      openBrowser(url);
    }
  })
  .catch((error: unknown) => {
    console.error('CD3 failed to start.', error);
    process.exitCode = 1;
  });
