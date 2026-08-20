# CD3

CD3 is an independent, local-first C4 architecture editor. One canonical project model drives an
editable 2D canvas and a synchronized low-poly 3D view: add, move, connect, recolour, and delete in
either, and every change is one undoable command against the model. Both views are projections of
the same truth — 2D placement stays authoritative, a 3D drag commits as a 2D move — and everything
runs on loopback: no cloud, no telemetry. Ships with the fictional **Northstar Commerce** sample.

## Install

Download `CD3-<version>-arm64.dmg` from [Releases](https://github.com/Bbardia/CD3/releases) — the
whole app in one double-clickable, offline Mac bundle. The build is unsigned, so the first launch is
right-click → Open. Projects are stored under `~/Library/Application Support/CD3`.

Pushing a `v*` tag builds and attaches the DMG in CI; `pnpm dist:mac` builds the same thing locally.

## Work the canvas

Double-click empty canvas to add at the pointer (elements, regions, notes); double-click an element
to drill into the view scoped to it. Click a relationship line to rename, retype, or delete it.
`V`/`C` switch the Select and Connect tools; **Arrange** lays the view out via ELK as one undoable
move. **Export image (PNG)** captures the active canvas and embeds the whole project in the image,
so **Open project…** accepts the PNG back. Regions and notes are per-view decoration, never model
elements.

Import a running stack — one system, a container per service (tagged by image so icons resolve),
`depends_on` as relationships, and a ready-made view:

```sh
docker compose config --format json | node scripts/import-compose.mjs my-stack
```

## Automate

The loopback API behind the app is also its scripting surface: read the project, replace it, or
apply the same validated, revision-guarded commands the UI executes — from a terminal, CI, or any
local tool. Full reference: [apps/api/README.md](apps/api/README.md).

## Model

| Kind            | May contain | Example            |
| --------------- | ----------- | ------------------ |
| Person          | —           | Shopper            |
| Software system | Containers  | Northstar Commerce |
| Container       | Components  | Storefront API     |
| Component       | —           | Pricing Engine     |

Relationships are normalized records with synchronous or asynchronous interaction. A view holds at
most one occurrence of an element, and a hidden relationship endpoint projects to its nearest
visible ancestor without losing the underlying relationship. Selection is semantic: the tree, 2D,
and 3D always select the same element. Without WebGL, the 2D workspace stays fully usable.

Out of scope: multi-user collaboration and authentication, cloud hosting or telemetry, duplicate
occurrences of one element in a view, and Isoflow-compatible files.

## Develop

Requires Node.js 22.12+ (`.node-version`) and pnpm 11 (pinned by `packageManager`; `corepack enable`
provides it).

```sh
pnpm install
pnpm dev     # web on http://127.0.0.1:5173, API on http://127.0.0.1:3100
pnpm check   # format, lint, typecheck, test, build, production smoke check
```

`pnpm build && pnpm start` serves the whole app as one process on `127.0.0.1:3100`. With the API
stopped the editor still saves to the browser, and says so. After changing the domain schema,
regenerate the committed JSON Schema with `pnpm generate:schema`.

| Package         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `@cd3/web`      | React 19 + Vite architecture workspace                    |
| `@cd3/api`      | Fastify loopback API and snapshot store                   |
| `@cd3/desktop`  | Electron shell around the loopback server                 |
| `@cd3/domain`   | Framework-independent Zod schema and TypeScript types     |
| `@cd3/layout`   | Pure view compiler, renderer projections, and ELK adapter |
| `@cd3/fixtures` | Northstar Commerce and deterministic generated fixtures   |

Edits save to the browser and, when the API runs, to a versioned JSON snapshot with timestamped
history under `apps/api/data/`. On open, an unsynced browser recovery wins; otherwise disk wins over
the synced browser cache, and the bundled sample is the final fallback. Never commit `.env` files,
project data, or backups — `data/` and `release/` are ignored by Git.

CD3 is an original implementation: it borrows the general idea of synchronized model-driven
architecture views, not code, assets, examples, or visual trade dress from Isoflow or any other
product.
