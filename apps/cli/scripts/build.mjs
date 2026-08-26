import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'esbuild';

const cliDirectory = fileURLToPath(new URL('..', import.meta.url));

await build({
  banner: {
    // The API normally uses import.meta.url to locate its data directory. This CJS bundle sets
    // CD3_DATA_DIR explicitly, but keeping a valid module URL preserves the fallback as well.
    js: `#!/usr/bin/env node
const __cd3ImportMetaUrl = require('node:url').pathToFileURL(__filename).href;`,
  },
  bundle: true,
  define: { 'import.meta.url': '__cd3ImportMetaUrl' },
  entryPoints: [join(cliDirectory, 'src/cli.ts')],
  format: 'cjs',
  logLevel: 'warning',
  outfile: join(cliDirectory, 'dist/cd3.cjs'),
  platform: 'node',
});

// npm only auto-includes a LICENSE that sits in the package directory itself.
cpSync(join(cliDirectory, '../../LICENSE'), join(cliDirectory, 'LICENSE'));

// The published package serves the web app from its own tree, not the workspace.
const webDist = join(cliDirectory, '../web/dist');
const webOut = join(cliDirectory, 'web');
rmSync(webOut, { recursive: true, force: true });
cpSync(webDist, webOut, { recursive: true });
