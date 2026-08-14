# ADR 002: Use React Flow and React Three Fiber renderers

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

CD3 needs an immediately legible 2D architecture canvas and a synchronized spatial representation. The application should share state without sharing renderer-specific node types, and it must remain usable when WebGL is unavailable.

## Decision

The frontend uses React 19 with Vite:

- React Flow renders the read-only 2D projection;
- React Three Fiber and Three.js render procedural platforms, blocks, and relationship lines;
- Drei provides orthographic/perspective cameras and orbit controls;
- shared React state stores the selected semantic element and active view;
- both renderer adapters consume the same pure compiled view;
- rendering is on demand rather than a continuous animation loop;
- a visible non-WebGL fallback preserves access to the model and 2D canvas.

The visual design is original: light neutral panels, restrained teal/blue/coral semantics, subtle technical grid texture, and typography/layout tailored to an architecture workspace. No proprietary code, assets, examples, or trade dress are copied.

## Consequences

- React Flow and R3F can evolve independently behind small adapters.
- Compiler tests provide parity guarantees without mounting either renderer.
- Three.js increases bundle size, so the 3D scene should be lazy-loadable as the product grows.
- Browser and WebGL behavior require explicit smoke/fallback tests.
