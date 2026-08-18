# CD3

CD3 is an independent, local-first C4 model-driven architecture editor. One canonical project model
drives an editable React Flow 2D canvas and a synchronized React Three Fiber spatial view: elements
can be added, moved, connected, recoloured, and deleted from either view, and every change is one
undoable command against the model. Everything runs on loopback, ships with the fictional
**Northstar Commerce** sample, and packages as a double-clickable Mac app.

## Workspace

| Package         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `@cd3/web`      | React 19 + Vite architecture workspace                    |
| `@cd3/api`      | Fastify loopback API and snapshot store                   |
| `@cd3/desktop`  | Electron shell around the loopback server                 |
| `@cd3/domain`   | Framework-independent Zod schema and TypeScript types     |
| `@cd3/layout`   | Pure view compiler, renderer projections, and ELK adapter |
| `@cd3/fixtures` | Northstar Commerce and deterministic generated fixtures   |

## Principles

- **Model first.** Elements and relationships carry meaning; views only decide what to show and
  where.
- **One truth, multiple projections.** Both renderers consume compiled projections of the same
  project snapshot.
- **Deterministic and portable.** A versioned JSON snapshot validates, diffs, backs up, and
  reproduces.
- **Useful offline.** Loopback only, no cloud dependency, never exposed publicly.
- **Progressive depth.** 3D clarifies hierarchy without becoming a second layout: 2D placement is
  authoritative, and a 3D drag commits as a 2D move.
- **Independent visual identity.** An original visual language, borrowing no other product's trade
  dress.

## Model

| Kind            | May contain | Example            |
| --------------- | ----------- | ------------------ |
| Person          | —           | Shopper            |
| Software system | Containers  | Northstar Commerce |
| Container       | Components  | Storefront API     |
| Component       | —           | Pricing Engine     |

Relationships are normalized records with synchronous or asynchronous interaction. A view holds at
most one occurrence of an element, and a hidden relationship endpoint may project to its nearest
visible ancestor without losing the underlying relationship ID. Selection is semantic: the tree, 2D,
and 3D always select the same element. If WebGL is unavailable, the 2D workspace remains fully
usable.

Out of scope: multi-user collaboration and authentication, cloud hosting or telemetry, duplicate
occurrences of one element in a view, and Isoflow-compatible files.

## Develop

Requires Node.js 22 (`.node-version`) and pnpm 11 (pinned by `packageManager`; `corepack enable`
provides it).

```sh
pnpm install
pnpm dev
```

- Web workspace: <http://127.0.0.1:5173>
- API health: <http://127.0.0.1:3100/api/health>

With the API stopped the editor still saves to the browser, and says so. Copy
`apps/api/.env.example` only to override the API port.

## Run as an application

```sh
pnpm build && pnpm start   # one process serving the app at http://127.0.0.1:3100
pnpm dist:mac              # or package the double-clickable Mac app
```

`pnpm dist:mac` writes `apps/desktop/release/CD3-<version>-arm64.dmg` — the same Fastify server
wrapped in an Electron window, with snapshots stored under `~/Library/Application Support/CD3`. The
build is unsigned: open it the first time with right-click → Open. Pushing a `v*` tag builds the DMG
in CI and attaches it to the tag's GitHub release.

## Verify

```sh
pnpm check   # lint, typecheck, test, build
```

After changing the domain schema, regenerate the committed JSON Schema with `pnpm generate:schema`.

## Data boundary

The workspace saves itself: edits go to the browser and, when the loopback API is running, to a
versioned JSON snapshot at `apps/api/data/project.c4.json` with timestamped history beside it. On
open, disk wins over the browser copy, which wins over the bundled sample. Never commit `.env`
files, project data, backups, or secrets — `data/` and `release/` are ignored by Git.

## License and independence

CD3 is an original implementation. It borrows the general idea of synchronized model-driven
architecture views, not proprietary code, assets, examples, or visual trade dress from Isoflow or
any other product.
