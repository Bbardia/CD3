import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'esbuild';

const desktopDirectory = fileURLToPath(new URL('..', import.meta.url));

await build({
  banner: {
    // The API normally uses import.meta.url to locate its data directory. This CJS bundle sets
    // CD3_DATA_DIR explicitly, but keeping a valid module URL preserves the fallback as well.
    js: `const __cd3ImportMetaUrl = require('node:url').pathToFileURL(__filename).href;`,
  },
  bundle: true,
  define: { 'import.meta.url': '__cd3ImportMetaUrl' },
  entryPoints: [join(desktopDirectory, 'src/main.ts')],
  external: ['electron'],
  format: 'cjs',
  logLevel: 'warning',
  outfile: join(desktopDirectory, 'dist/main.cjs'),
  platform: 'node',
});
