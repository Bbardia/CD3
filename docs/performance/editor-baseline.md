# Editor performance baseline

- **Date:** 2026-08-15
- **Scope:** P0 editor slice — command-backed store, project-aware projections, 2D drag editing, inspector editing.
- **Status:** First measured baseline. These are observations, not support targets.

## What this document is not

It records no performance budget, threshold, or hardware support claim. The P0 plan requires
publishing actual results and naming the first measured bottleneck; setting targets needs a
representative-Mac run that has not happened yet. Do not quote these figures as product limits.

## Method

`scripts/benchmark-domain-drag.mts` builds deterministic synthetic projects — one person, one
software system, and the remaining elements as containers on a grid, chained by relationships so
edges are compiled too. Each measurement warms up 5 times, then reports the median of 25 timed
iterations. Every iteration starts from the same base history, so results do not drift as a
history accumulates.

```bash
pnpm exec tsx scripts/benchmark-domain-drag.mts
```

## Hardware and runtime

| | |
| --- | --- |
| Machine | Raspberry Pi 5 (`linux/arm64`, kernel 6.18.39) |
| Runtime | Node v22.22.2, no browser |
| Not measured | The intended macOS client, any browser engine, real pointer input, WebGL |

This is the slowest plausible target running server-side JavaScript. A representative Mac will be
substantially faster, and a browser adds costs this harness does not model. Both directions matter,
which is why nothing here is turned into a threshold.

## Results

All values in milliseconds; `size` is total element count.

| size | drop p50 | drop p95 | 10-item drop p50 | validate | clone | compile+2D | 3D | undo+redo |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 3.45 | 4.99 | 3.14 | 0.72 | 0.22 | 0.28 | 0.34 | 3.97 |
| 100 | 7.91 | 8.53 | 8.54 | 1.96 | 0.85 | 1.29 | 1.44 | 10.54 |
| 250 | 20.78 | 22.53 | 20.96 | 5.67 | 2.42 | 1.92 | 2.66 | 26.78 |
| 1000 | 89.01 | 92.70 | 90.45 | 25.74 | 9.20 | 8.47 | 11.36 | 121.22 |

Run-to-run spread across repeated executions is a few percent on the drop columns and larger on the
cheap sub-millisecond ones, so treat single digits after the decimal point as noise.

Columns:

- **drop** — one `move-view-items` command through `applyCommandToHistory`, the entire pointer-up cost.
- **10-item drop** — the same command moving ten items, i.e. a group drag.
- **validate** — one `ProjectSchema.parse` of the whole document, in isolation.
- **clone** — one `structuredClone` of the whole document, in isolation.
- **compile+2D** — `compileView` followed by `projectViewTo2D`.
- **3D** — `projectViewTo3D` from an already compiled view.
- **undo+redo** — one `undoCommand` plus one `redoCommand`.

## First measured bottleneck

**Whole-document validation inside `applyCommand`, which is paid twice per command.**

`applyCommand` calls `assertValidProject` on its input and `assertValidResult` on its output, so a
single drop pays roughly `2 × validate`. At 1,000 elements that is about 51 ms of the 89 ms drop.
Whole-document cloning and deep-freezing account for most of the rest. Layout is a distant second:
compile + 2D projection is 8.47 ms, under a tenth of the drop cost at the same size.

Three consequences follow from the shape of the numbers rather than from any target:

1. **Cost scales with document size, not with how much moved.** Moving ten items costs the same as
   moving one (90.45 ms versus 89.01 ms at 1,000 elements — a difference inside run-to-run noise).
   The command payload is irrelevant; the document being revalidated is what costs. This is exactly
   why a group drag must stay one command.
2. **Undo/redo is more expensive than the original edit** (121.22 ms versus 89.01 ms at 1,000),
   because applying patches clones and revalidates in the same whole-document way.
3. **The 3D projection is not the problem at these sizes.** It costs about the same as the 2D
   projection and runs only when 3D mode is requested.

## Why this is not yet urgent

Pointer *movement* never touches this path. Drag previews are transient React Flow state and emit
no command, so the measured cost is paid once, on release. `Diagram2D.test.tsx` holds two
deterministic structural regressions that protect the property rather than the timing: a batch of
pointer moves produces exactly one render each with no amplification, and untouched node objects
keep their identity through a drag.

The shipped fixture has 12 elements, where a drop is well under 3.27 ms even on this hardware.

## Bundle sizes

Measured from `pnpm --filter @cd3/web build` on the same commit:

| Chunk | Raw | Gzip |
| --- | ---: | ---: |
| initial `index-*.js` | 521.53 kB | 158.59 kB |
| lazy `SpatialDiagram-*.js` | 928.69 kB | 248.24 kB |
| `elk-layout.worker-*.js` | 1,436.77 kB | — |
| `index-*.css` | 33.31 kB | 6.69 kB |

The initial chunk grew from 490.48 kB / 148.63 kB before the P0 editor slice — about +31 kB raw and
+10 kB gzip — as the editor began importing domain commands and gained the toolbar, drag handling,
and inspector form. That was the anticipated cost recorded in the plan's risk 8. The lazy 3D chunk
and the ELK worker are unchanged, so the boundaries that keep them out of the initial load still
hold: ELK remains absent from the initial bundle and present only in the worker chunk.

Vite's 500 kB advisory fires for the worker and the lazy 3D chunk. The threshold is deliberately not
raised, because hiding the warning would not make the chunks smaller.

## What to measure next, before setting any target

1. The same script on the intended Mac, then the same interactions in a real browser.
2. Pointer-move smoothness and pointer-up stall with real input, which this harness cannot observe.
3. 3D draw calls, per-node `<Html>` label cost, and idle render behaviour under stress fixtures.
4. Whether a trusted in-memory history transition can skip one of the two whole-document
   validations. Import and load boundaries must keep validating; the opportunity is strictly
   inside an already-validated in-memory session.
