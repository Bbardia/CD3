import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

// The desktop shell is the production server plus a window: the same Fastify instance that
// backs `pnpm start` serves the built web app and owns snapshot persistence on loopback.
import { buildServer } from '@cd3/api/dist/app.js';

async function start(): Promise<void> {
  await app.whenReady();

  // Snapshots belong in the user's profile, not inside the read-only app bundle.
  process.env['CD3_DATA_DIR'] = join(app.getPath('userData'), 'data');
  process.env['CD3_WEB_DIST'] = app.isPackaged
    ? join(process.resourcesPath, 'web')
    : join(__dirname, '../../web/dist');
  process.env['NODE_ENV'] ??= 'production';

  const server = buildServer();
  // Port 0 lets the OS pick a free port, so a dev API on 3100 never collides with the app.
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The loopback server did not report a port.');
  }
  const url = `http://127.0.0.1:${String(address.port)}`;
  console.log(`CD3 listening on ${url}`);

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    title: 'CD3',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(url);

  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('before-quit', () => {
    void server.close();
  });
}

void start();
