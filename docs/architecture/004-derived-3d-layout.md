# ADR 004: Derive 3D layout from authoritative 2D placement

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Independent 2D and 3D layouts would drift and force users to curate two diagrams. The spatial view should reveal hierarchy without becoming a second source of positional truth.

## Decision

For schema version 1, 2D view placement is authoritative and 3D is derived:

- 2D `x/y` maps to world `x/z` using a deterministic scale;
- element hierarchy depth maps to world elevation on `y`;
- software-system and container hierarchy may be represented as procedural platforms;
- deterministic size and color policies use element kind and view metadata;
- relationships connect derived node anchors;
- optional camera bookmarks are view metadata, not semantic model data;
- the default camera is orthographic with an isometric orientation;
- perspective projection is available as a user-controlled viewing option.

An ELK adapter may produce 2D placements when a view lacks them, but its output still enters the same authoritative 2D placement contract before 3D derivation.

## Consequences

- 2D and 3D stay synchronized by construction.
- Layout behavior is deterministic and testable without WebGL.
- 3D cannot be independently rearranged in the foundation milestone.
- Changes to scaling/elevation policy can alter appearance without migrating semantic records, but bookmarked cameras may need adjustment.
