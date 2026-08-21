/**
 * Rasterises the CD3 mark into the packaging icon: `pnpm --filter @cd3/desktop icon`.
 *
 * electron-builder wants one square PNG of at least 512px and derives every platform size from it.
 * Electron is already a dependency here, so its renderer is the rasteriser — no image toolchain.
 * Electron's own module is CommonJS, so its API arrives as the default export.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

const { app, BrowserWindow } = electron;

const SIZE = 1024;
const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../web/public/favicon.svg');
const target = join(here, '../build/icon.png');

async function main() {
  await app.whenReady();
  const svg = await readFile(source, 'utf8');
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
  });
  const page = `<body style="margin:0;background:transparent">${svg.replace(
    '<svg',
    `<svg width="${SIZE}" height="${SIZE}"`,
  )}</body>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  const image = await window.webContents.capturePage();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, image.toPNG());
  console.log(`Wrote ${target} at ${SIZE}x${SIZE}.`);
  app.exit(0);
}

void main().catch((error) => {
  console.error(error);
  app.exit(1);
});
