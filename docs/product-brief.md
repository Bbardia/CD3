# CD3 Product Brief

## Product

**CD3** is an independent, local-first C4 model-driven architecture editor. A single canonical semantic model powers synchronized 2D and 2.5D/3D representations, so teams can move between precise editing and spatial comprehension without maintaining duplicate diagrams.

CD3 takes inspiration from the broad product pattern of model-driven architecture visualization. Its code, visual language, interactions, examples, assets, and trade dress are original.

## Initial audience

- Software architects who need context, container, and component views.
- Engineering teams reviewing system boundaries and dependencies.
- Local operators who want a private tool on a Raspberry Pi without cloud infrastructure.

## Product principles

1. **Model first.** Elements and relationships carry meaning; views only decide what to show and where.
2. **One truth, multiple projections.** Both renderers consume compiled projections of the same project snapshot.
3. **Deterministic and portable.** A versioned JSON snapshot can be validated, diffed, backed up, and reproduced.
4. **Useful offline.** The first deployment is loopback-only on a local Raspberry Pi and requires no remote service.
5. **Progressive depth.** 3D clarifies hierarchy and topology; it must not introduce a second editable layout.
6. **Independent visual identity.** Neutral workspace surfaces, a restrained teal/blue/coral semantic palette, and a subtle technical grid make CD3 recognizable without copying another product.

## Foundation milestone

The first milestone proves the architecture end to end:

- a strict, framework-independent schema for people, software systems, containers, components, relationships, and views;
- a polished fictional project, **Northstar Commerce**, plus deterministic generated fixtures;
- context, container, and component views with explicit membership and 2D placement;
- pure view compilation, including optional projection of hidden relationship endpoints to visible ancestors;
- a read-only React Flow canvas and a derived React Three Fiber scene;
- shared semantic selection in 2D, 3D, split mode, and the model navigator;
- orthographic-isometric 3D by default, with perspective as an explicit option;
- a loopback Fastify API health endpoint; and
- CI-ready lint, type checking, tests, and production builds.

## Canonical model

CD3 supports the C4 levels needed for the foundation:

| Kind | May be parent of | Typical example |
| --- | --- | --- |
| Person | — | Shopper |
| Software system | Container | Northstar Commerce |
| Container | Component | Storefront API |
| Component | — | Pricing Engine |

Relationships are normalized records with synchronous or asynchronous interaction modes. Views contain distinct view-item occurrences keyed independently from semantic element IDs. The MVP permits at most one occurrence of a semantic element in each view.

## Interaction contract

- Selecting an item in the navigator, 2D canvas, or 3D scene selects the same semantic element everywhere.
- Switching modes preserves selection.
- 2D placements are authoritative for the foundation milestone.
- 3D maps 2D `x/y` to world `x/z`; hierarchy depth provides elevation on `y`.
- Hidden endpoints may be projected to their nearest visible ancestors, preserving the underlying semantic relationship ID.
- The vertical slice is read-only. Authoring, history, collaboration, and persistence UI come later.
- If WebGL is unavailable, the 2D view and a clear 3D fallback remain usable.

## Deployment and data boundary

The initial service binds only to the loopback interface on the Raspberry Pi. There is no configured Git remote and no cloud dependency. Project data will be stored as schema-versioned JSON snapshots; databases, project data, backups, secrets, and machine-specific paths are never committed.

## Non-goals for this milestone

- multi-user collaboration or authentication;
- cloud hosting, telemetry, or remote synchronization;
- diagram authoring, drag persistence, undo/redo, or importers;
- arbitrary duplicated occurrences of one element in a view;
- photorealistic rendering, custom proprietary assets, or an Isoflow-compatible file format;
- production snapshot mutation endpoints.

## Foundation acceptance criteria

1. The sample project validates against schema version 1 and round-trips deterministically.
2. Invalid hierarchy, references, IDs, numeric bounds, and payload limits are rejected.
3. The same compiled view drives both renderer adapters and preserves semantic IDs.
4. 2D, 3D, and split modes render from the sample and share selection.
5. WebGL failure has a visible fallback.
6. The API health endpoint succeeds on loopback.
7. Lint, type checking, tests, and production builds pass from a clean install.
