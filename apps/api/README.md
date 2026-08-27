# @cd3/api

The Fastify loopback server behind the CD3 app — and its scripting surface. Anything on the same
machine (a terminal, CI, editor tooling) can read the project and apply the same validated domain
commands the UI executes.

Base URL: `http://127.0.0.1:6985` with `pnpm dev` or `pnpm start` (`PORT` in `apps/api/.env`
overrides, see `.env.example`). The packaged desktop app runs its own copy on dedicated loopback
port `43173`, which stops with the app. Only one packaged app instance runs at a time.

| Variable            | Effect                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PORT`              | Listening port (default `6985`; must bind exactly when set — a busy unset default hops to the next free port) |
| `CD3_DATA_DIR`      | Where the snapshot and its history live (default `apps/api/data/`)                                            |
| `CD3_PUBLIC_ORIGIN` | Addresses to answer to besides loopback — also binds beyond loopback                                          |
| `CD3_WEB_DIST`      | Built web app to serve; `pnpm start` points it at `apps/web/dist`                                             |
| `LOG_LEVEL`         | Log verbosity (default `info`): startup, warnings, and failed requests; `debug` and up for more               |

Without `CD3_PUBLIC_ORIGIN` the server binds `127.0.0.1` and rejects any request whose `Host` is not
a literal loopback authority, which is what stops a DNS-rebinding page from reaching it. Set it to
the address people type (`http://cd3.lan:6985`, comma-separated for several, `*` for any) to publish
the instance on `0.0.0.0`. Mutations must still be same-origin with the `Host` they were sent to, so
only the scheme may differ behind a TLS proxy. A published instance is unauthenticated: everyone who
reaches it shares one project.

## Endpoints

| Method   | Path                       | Purpose                                                  |
| -------- | -------------------------- | -------------------------------------------------------- |
| `GET`    | `/api/health`              | Liveness and schema version                              |
| `GET`    | `/api/project`             | The whole project; `ETag` is the revision                |
| `PUT`    | `/api/project`             | Replace/create (`If-Match`; create-only `If-None-Match`) |
| `DELETE` | `/api/project`             | Forget the snapshot/history (optionally `If-Match`)      |
| `GET`    | `/api/project/revision`    | `{"revision":"…"}` — cheap to poll                       |
| `GET`    | `/api/project/history`     | Checkpoint ids, newest first                             |
| `GET`    | `/api/project/history/:id` | One checkpoint, restorable via `PUT /api/project`        |
| `POST`   | `/api/commands`            | Apply validated domain commands                          |

```sh
curl 127.0.0.1:6985/api/project             # the whole project, ETag = revision
curl 127.0.0.1:6985/api/project/revision
curl -X PUT 127.0.0.1:6985/api/project -d @my.c4.json -H 'content-type: application/json'
curl -X PUT 127.0.0.1:6985/api/project -d @my.c4.json -H 'content-type: application/json' -H 'If-None-Match: *'
curl 127.0.0.1:6985/api/project/history
```

## Commands

`POST /api/commands` takes one command as `{"command": {…}}` or an atomic batch as
`{"commands": […]}` (1–100 per batch). The same domain rules the UI enforces (unique ids,
containment, one occurrence per view) hold no matter who is typing. On failure the response carries
the domain error code and the `failedAt` index, and nothing is persisted.

```sh
curl -X POST 127.0.0.1:6985/api/commands -H 'content-type: application/json' -d '{
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
it. `If-Match` also refuses the write if that snapshot was deleted in the meantime. To create only
when no snapshot exists, send `If-None-Match: *`; two concurrent initial creators cannot both win.
Conditional deletes accept `If-Match` as well. All guard checks and mutations are serialized
server-side. Revision conflicts return `code: "REVISION_CONFLICT"` and `revision`, which is `null`
when no usable revision exists. An on-disk snapshot that is unreadable or no longer valid is
reported as `SNAPSHOT_INVALID`, not as missing, and a create-only PUT will not overwrite it. After
recovering the old file, an unguarded PUT or DELETE is the explicit repair path. When restoring a
checkpoint, take the current revision from `GET /api/project/revision`, not from the checkpoint
itself.

The open app plays by the same rules: it saves with `If-Match` and polls the revision, so a script's
changes appear in a running app within a few seconds. If an app edit loses that race, disk wins and
the losing copy is kept in the browser's storage under `cd3.project.conflict.v1` rather than
dropped.

## Limits

- Request bodies up to 8 MB; JSON nesting up to 32 levels (400 beyond either).
- One batch holds 1–100 commands.
- Requests must use a literal loopback `Host`; browser mutations also require a loopback `Origin`.

## Data

Snapshots live at `apps/api/data/project.c4.json` (`CD3_DATA_DIR` overrides; the Mac app uses
`~/Library/Application Support/CD3/data`). Writes leave timestamped checkpoints beside it: at most
one per 5 minutes, newest 20 kept, restorable through the history endpoints. `data/` is git-ignored
— never commit project data.
