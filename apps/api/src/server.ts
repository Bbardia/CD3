import { fileURLToPath } from 'node:url';

import { startServer } from './start.js';

// `pnpm start` serves the built web app from the sibling workspace unless told otherwise.
if (process.env['CD3_WEB_DIST'] === undefined) {
  process.env['CD3_WEB_DIST'] = fileURLToPath(new URL('../../web/dist', import.meta.url));
}

try {
  await startServer();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
