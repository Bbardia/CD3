# CD3

CD3 is an independent, local-first C4 model-driven architecture editor. One canonical project model
drives an editable React Flow 2D canvas and a synchronized React Three Fiber spatial view: elements
can be added, moved, connected, recoloured, and deleted from either view, and every change is one
undoable command against the model. The application runs entirely on loopback and ships with the
fictional **Northstar Commerce** sample.

## Workspace

| Package         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `@cd3/web`      | React 19 + Vite architecture workspace                    |
| `@cd3/api`      | Fastify loopback API shell                                |
| `@cd3/domain`   | Framework-independent Zod schema and TypeScript types     |
| `@cd3/layout`   | Pure view compiler, renderer projections, and ELK adapter |
| `@cd3/fixtures` | Northstar Commerce and deterministic generated fixtures   |

See [`docs/architecture/`](docs/architecture/) for accepted decisions.

## Principles

- **Model first.** Elements and relationships carry meaning; views only decide what to show and
  where.
- **One truth, multiple projections.** Both renderers consume compiled projections of the same
  project snapshot.
- **Deterministic and portable.** A versioned JSON snapshot validates, diffs, backs up, and
  reproduces.
- **Useful offline.** Services bind to loopback only, with no cloud runtime dependency, and must not
  be exposed publicly.
- **Progressive depth.** 3D clarifies hierarchy and topology without becoming a second layout: 2D
  placement is authoritative, and a 3D drag commits as a 2D move.
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
most one occurrence of an element, keyed separately from the element ID, and a hidden relationship
endpoint may project to its nearest visible ancestor without losing the underlying relationship ID.

Selection is semantic — the tree, 2D, and 3D always select the same element, and switching modes
preserves it. Add, move, connect, recolour, and delete work from either view; every change is one
undoable command. If WebGL is unavailable, the 2D workspace and a clear 3D fallback remain usable.

Out of scope: multi-user collaboration and authentication, cloud hosting or telemetry, perspective
and split-mode presentation, duplicate occurrences of one element in a view, and Isoflow-compatible
files.

## Requirements

- Node.js 22 (see `.node-version`)
- pnpm 11.21.0 (pinned by `packageManager`)

## Develop

```sh
pnpm install
pnpm dev
```

- Web workspace: <http://127.0.0.1:5173>
- API health: <http://127.0.0.1:3100/api/health>
- Project snapshot: <http://127.0.0.1:3100/api/project>

Run both: with the API stopped the editor still saves to the browser, and says so.

Both development servers bind to loopback by default. Copy `apps/api/.env.example` only if you need
to override the API port; never commit local environment files.

## Clone on macOS

Authenticate the GitHub CLI as an account with access to this private repository, then run:

```sh
gh repo clone Bbardia/CD3
cd CD3
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Alternatively, clone over SSH with `git clone git@github.com:Bbardia/CD3.git`. The application stays
local to the Mac and the development services continue to bind to loopback only.

## Verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# or all four:
pnpm check
```

Generate the committed JSON Schema after changing the domain schema:

```sh
pnpm generate:schema
```

## Data boundary

The workspace saves itself. Edits are written to the browser and, whenever the loopback API is
running, to a versioned JSON snapshot at `apps/api/data/project.c4.json`; on open, that snapshot
wins over the browser copy, which wins over the bundled sample. `data/` is ignored by Git.

Do not commit `.env` files, project data, databases, backups, secrets, or machine-specific paths.

## License and independence

CD3 is an original implementation. It borrows the general idea of synchronized model-driven
architecture views, not proprietary code, assets, examples, or visual trade dress from Isoflow or
any other product.
