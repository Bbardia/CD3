# ADR 001: Separate the semantic model from views

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Architecture elements and relationships must remain consistent across context, container, and component diagrams. Encoding meaning inside renderer nodes would duplicate data, couple storage to a UI library, and make synchronized 2D/3D behavior fragile.

## Decision

CD3 uses a normalized, framework-independent semantic project model:

- elements and relationships are canonical records keyed by stable semantic IDs;
- views explicitly list view items, each with a `ViewItemId` distinct from its element ID;
- 2D placement is keyed by `ViewItemId`;
- the MVP allows one occurrence of an element per view;
- a pure compiler validates view membership and emits renderer-neutral nodes and edges;
- renderer adapters translate compiled data to React Flow and Three.js-friendly structures.

The initial C4 scope is person, software system, container, and component across context, container, and component views.

## Consequences

- Selection and relationships can use stable semantic IDs across all representations.
- Renderers are replaceable and cannot silently become data stores.
- View compilation can be tested without a browser.
- Supporting multiple occurrences later requires an explicit schema-version decision rather than accidental behavior.
- Consumers must resolve normalized references before rendering.
