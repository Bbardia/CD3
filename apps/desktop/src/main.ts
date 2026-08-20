import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

// The desktop shell is the production server plus a window: the same Fastify instance that
// backs `pnpm start` serves the built web app and owns snapshot persistence on loopback.
import { buildServer } from '@cd3/api/app';

// A stable origin is part of persistence: localStorage is keyed by host and port, so changing the
// port between launches would make a last-second browser recovery copy unreachable after restart.
const DESKTOP_PORT = 43_173;
let mainWindow: BrowserWindow | undefined;

async function start(): Promise<void> {
  await app.whenReady();

  // Snapshots belong in the user's profile, not inside the read-only app bundle.
  process.env['CD3_DATA_DIR'] = join(app.getPath('userData'), 'data');
  process.env['CD3_WEB_DIST'] = app.isPackaged
    ? join(process.resourcesPath, 'web')
    : join(__dirname, '../../web/dist');
  process.env['NODE_ENV'] ??= 'production';

  const server = buildServer();
  try {
    await server.listen({ host: '127.0.0.1', port: DESKTOP_PORT });
  } catch (error) {
    throw new Error(
      `CD3 could not claim its dedicated loopback port ${String(DESKTOP_PORT)}. Close the program using that port and reopen CD3.`,
      { cause: error },
    );
  }
  const address = server.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The loopback server did not report a port.');
  }
  const url = `http://127.0.0.1:${String(address.port)}`;
  console.log(`CD3 listening on ${url}`);

  // Register lifecycle ownership before navigation: a window closed during its initial load must
  // still stop the server instead of leaving a headless process holding the dedicated port.
  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('before-quit', () => {
    void server.close();
  });

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    title: 'CD3',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow = window;
  window.once('closed', () => {
    mainWindow = undefined;
  });

  // This shell has no reason to create another renderer or leave its loopback application.
  // Keeping navigation on the exact application origin also prevents untrusted pages from gaining
  // a privileged-looking desktop window if project content ever contains an external link.
  const allowedOrigin = new URL(url).origin;
  const navigationIsAllowed = (navigationUrl: string): boolean => {
    try {
      const target = new URL(navigationUrl);
      return target.protocol === 'http:' && target.origin === allowedOrigin;
    } catch {
      return false;
    }
  };
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    if (!navigationIsAllowed(event.url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('will-redirect', (event) => {
    if (!navigationIsAllowed(event.url)) {
      event.preventDefault();
    }
  });
  await window.loadURL(url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
  void start().catch((error: unknown) => {
    console.error('CD3 failed to start.', error);
    app.exit(1);
  });
}
