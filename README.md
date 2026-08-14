# CD3

CD3 is an independent, local-first C4 model-driven architecture editor. One canonical project model
drives a read-only React Flow 2D canvas and a synchronized React Three Fiber spatial view. The
foundation runs entirely on loopback and ships with the fictional **Northstar Commerce** sample.

## Workspace

| Package         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `@cd3/web`      | React 19 + Vite architecture workspace                    |
| `@cd3/api`      | Fastify loopback API shell                                |
| `@cd3/domain`   | Framework-independent Zod schema and TypeScript types     |
| `@cd3/layout`   | Pure view compiler, renderer projections, and ELK adapter |
| `@cd3/fixtures` | Northstar Commerce and deterministic generated fixtures   |

See [`docs/product-brief.md`](docs/product-brief.md) and [`docs/architecture/`](docs/architecture/)
for product scope and accepted decisions.

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

Both development servers bind to loopback by default. Copy `apps/api/.env.example` only if you need
to override the API port; never commit local environment files.

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

Project snapshots will live under ignored runtime directories and use a versioned JSON format. Do
not commit `.env` files, project data, databases, backups, secrets, or machine-specific paths. This
repository intentionally has no configured Git remote.

## License and independence

CD3 is an original implementation. It borrows the general idea of synchronized model-driven
architecture views, not proprietary code, assets, examples, or visual trade dress from Isoflow or
any other product.
