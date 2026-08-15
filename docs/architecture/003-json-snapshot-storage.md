# ADR 003: Store projects as versioned JSON snapshots

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

CD3 is built on a Raspberry Pi but is intended to run as a single local Mac application with loopback-only services. It needs transparent, portable persistence without an operational database dependency. Schema evolution and validation must be explicit from the beginning.

## Decision

The canonical persistence format is a complete JSON project snapshot with `schemaVersion: 1`.

- Zod is the runtime source of validation and TypeScript types.
- A generated JSON Schema is committed for external tooling.
- Cross-record invariants are validated in addition to structural schemas.
- Records are normalized and keyed by IDs that must match each embedded record ID.
- JSON-valued extension properties and external references are bounded.
- Serialization used for fixtures is deterministic.

The foundation API is read-only and exposes only health. Snapshot read/write endpoints and atomic file replacement will be designed in a later milestone. Runtime data, backups, SQLite files, secrets, and environment files are ignored by Git.

## Consequences

- Snapshots are inspectable, diffable, and easy to migrate or back up locally.
- Every load pays a validation cost, acceptable at the intended project scale.
- Concurrent editing is not addressed by this decision.
- Future schema changes require versioned migrations and regenerated JSON Schema.
