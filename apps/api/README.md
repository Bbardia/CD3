# @cd3/api

The Fastify loopback server behind the CD3 app — and its scripting surface. Anything on the same
machine (a terminal, CI, editor tooling) can read the project and apply the same validated domain
commands the UI executes.

Base URL: `http://127.0.0.1:3100` with `pnpm dev` or `pnpm start` (`PORT` in `apps/api/.env`
overrides, see `.env.example`). The packaged Mac app runs its own copy on a random port that stops
with the app — script against a `pnpm start` server instead.

## Endpoints

| Method   | Path                       | Purpose                                                 |
| -------- | -------------------------- | ------------------------------------------------------- |
| `GET`    | `/api/health`              | Liveness and schema version                             |
| `GET`    | `/api/project`             | The whole project; `ETag` is the revision               |
| `PUT`    | `/api/project`             | Replace the snapshot (honors `If-Match`)                |
| `DELETE` | `/api/project`             | Forget the snapshot and its history                     |
| `GET`    | `/api/project/revision`    | `{"revision":"…"}` — cheap to poll                      |
| `GET`    | `/api/project/history`     | Checkpoint ids, newest first                            |
| `GET`    | `/api/project/history/:id` | One checkpoint, restorable via `PUT /api/project`       |
| `POST`   | `/api/commands`            | Apply validated domain commands                         |

```sh
curl 127.0.0.1:3100/api/project             # the whole project, ETag = revision
curl 127.0.0.1:3100/api/project/revision
curl -X PUT 127.0.0.1:3100/api/project -d @my.c4.json -H 'content-type: application/json'
curl 127.0.0.1:3100/api/project/history
```

## Commands

`POST /api/commands` takes one command as `{"command": {…}}` or an atomic batch as
`{"commands": […]}` (1–100 per batch). The same domain rules the UI enforces (unique ids,
containment, one occurrence per view) hold no matter who is typing. On failure the response carries
the domain error code and the `failedAt` index, and nothing is persisted.

```sh
curl -X POST 127.0.0.1:3100/api/commands -H 'content-type: application/json' -d '{
  "commands": [
    { "type": "create-element",
      "element": { "id": "search", "kind": "container", "parentId": "northstar-commerce",
                   "name": "Search", "technology": "OpenSearch", "tags": ["service"],
                   "properties": {}, "externalRefs": [] },
      "placeInView": { "viewId": "core-containers", "itemId": "core-containers-item-search",
                       "placement": { "x": 1660, "y": 700, "width": 240, "height": 110 } } },
    { "type": "create-relationship",
      "relationship": { "id": "orders-search", "name": "Indexes orders", "sourceId": "order-service",
                        "targetId": "search", "interaction": "asynchronous", "tags": [],
                        "properties": {}, "externalRefs": [] },
      "showInViewId": "core-containers" }
  ]
}'
```

Command types: `create-element` (optionally `placeInView`), `update-element`, `delete-element`
(`cascade` for descendants), `reparent-element`, `create-relationship` (optionally `showInViewId`),
`update-relationship`, `delete-relationship`, `move-view-items`, `create-view`, `delete-view`,
`add-view-item`, `remove-view-item`, and `update-view`. Exact shapes are the `DomainCommand` types
in `packages/domain/src/commands.ts`.

## Revision guarding

Project reads and writes (`GET`/`PUT /api/project`, `POST /api/commands`) return the snapshot's
content-hash revision as `ETag`. Pass it back as `baseRevision` (commands) or `If-Match` (PUT) and a
write against a moved snapshot is refused with `409` plus the current revision instead of clobbering
it — guard checks and writes are serialized server-side, so two concurrent writers can never both
win. When restoring a checkpoint, take the current revision from `GET /api/project/revision`, not
from the checkpoint itself.

The open app plays by the same rules: it saves with `If-Match` and polls the revision, so a script's
changes appear in a running app within a few seconds. If an app edit loses that race, disk wins and
the losing copy is kept in the browser's storage under `cd3.project.conflict.v1` rather than
dropped.

## Limits

- Request bodies up to 8 MB; JSON nesting up to 32 levels (400 beyond either).
- One batch holds 1–100 commands.

## Data

Snapshots live at `apps/api/data/project.c4.json` (`CD3_DATA_DIR` overrides; the Mac app uses
`~/Library/Application Support/CD3/data`). Writes leave timestamped checkpoints beside it: at most
one per 5 minutes, newest 20 kept, restorable through the history endpoints. `data/` is git-ignored
— never commit project data.
