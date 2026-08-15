/**
 * Measure the editor drag path on deterministic synthetic fixtures.
 *
 * Every number this prints is measured on the machine that runs it. Nothing here defines a support
 * target: the P0 plan requires publishing observed values and naming the first real bottleneck,
 * not inventing thresholds. Run it on the intended client hardware before quoting any figure.
 *
 *   pnpm exec tsx scripts/benchmark-domain-drag.mts
 */
import {
  applyCommandToHistory,
  createCommandHistory,
  ProjectSchema,
  redoCommand,
  undoCommand,
  type DomainCommand,
  type ProjectInput,
  type ReadonlyProject,
} from '@cd3/domain';
import { compileView, projectViewTo2D, projectViewTo3D } from '@cd3/layout';

const FIXTURE_SIZES = [25, 100, 250, 1_000] as const;
const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 25;
const VIEW_ID = 'scale-containers';
const SYSTEM_ID = 'scale-system';

function containerId(index: number): string {
  return `scale-container-${String(index).padStart(4, '0')}`;
}

function viewItemId(index: number): string {
  return `scale-item-${String(index).padStart(4, '0')}`;
}

/**
 * Build a valid project with `elementCount` elements: one person, one software system, and the
 * remainder as containers laid out on a grid, chained by relationships so edges are compiled too.
 */
function syntheticProject(elementCount: number): ReadonlyProject {
  const containerCount = elementCount - 2;
  if (containerCount < 1) {
    throw new RangeError('A synthetic fixture needs at least three elements.');
  }

  const elements: Record<string, unknown> = {
    'scale-operator': {
      id: 'scale-operator',
      kind: 'person',
      name: 'Scale Operator',
      tags: [],
      properties: {},
      externalRefs: [],
    },
    [SYSTEM_ID]: {
      id: SYSTEM_ID,
      kind: 'softwareSystem',
      name: 'Scale System',
      tags: [],
      properties: {},
      externalRefs: [],
    },
  };
  const relationships: Record<string, unknown> = {};
  const items: Record<string, unknown> = {};
  const placements: Record<string, unknown> = {};
  const columns = Math.ceil(Math.sqrt(containerCount));

  for (let index = 0; index < containerCount; index += 1) {
    const id = containerId(index);
    elements[id] = {
      id,
      kind: 'container',
      name: `Scale Container ${String(index)}`,
      description: 'A synthetic container used only for deterministic benchmarking.',
      technology: 'TypeScript',
      parentId: SYSTEM_ID,
      tags: ['synthetic'],
      properties: {},
      externalRefs: [],
    };
    items[viewItemId(index)] = { id: viewItemId(index), elementId: id };
    placements[viewItemId(index)] = {
      x: (index % columns) * 280,
      y: Math.floor(index / columns) * 180,
      width: 240,
      height: 130,
    };
    if (index > 0) {
      const relationshipId = `scale-rel-${String(index).padStart(4, '0')}`;
      relationships[relationshipId] = {
        id: relationshipId,
        name: 'Calls',
        interaction: 'synchronous',
        sourceId: containerId(index - 1),
        targetId: id,
        tags: [],
        properties: {},
        externalRefs: [],
      };
    }
  }

  const input = {
    schemaVersion: 1,
    id: 'scale-benchmark',
    name: 'Scale Benchmark',
    elements,
    relationships,
    views: {
      [VIEW_ID]: {
        id: VIEW_ID,
        name: 'Scale Containers',
        type: 'container',
        scopeElementId: SYSTEM_ID,
        items,
        placements,
        relationshipIds: Object.keys(relationships),
      },
    },
    threeD: {
      bookmarks: {},
      policy: {
        coordinateScale: 0.04,
        defaultProjection: 'orthographic',
        elevationStep: 2.5,
        platformPadding: 24,
      },
    },
  } as unknown as ProjectInput;

  return ProjectSchema.parse(input) as ReadonlyProject;
}

interface Measurement {
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

function summarize(samples: readonly number[]): Measurement {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Number.NaN;
  return { median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? Number.NaN };
}

function measure(run: () => void): Measurement {
  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
    run();
  }
  const samples: number[] = [];
  for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
}

function format(value: number): string {
  return value.toFixed(2).padStart(8);
}

function dragCommand(movedCount: number, offset: number): DomainCommand {
  const moves = Array.from({ length: movedCount }, (_unused, index) => ({
    itemId: viewItemId(index),
    x: 40 + offset,
    y: 60 + offset,
  }));
  return { type: 'move-view-items', viewId: VIEW_ID, moves };
}

const rows: string[] = [];
console.log(`node ${process.version} · ${process.platform}/${process.arch}`);
console.log(
  `${String(MEASURED_ITERATIONS)} measured iterations after ${String(WARMUP_ITERATIONS)} warmups\n`,
);

for (const elementCount of FIXTURE_SIZES) {
  const project = syntheticProject(elementCount);
  const history = createCommandHistory(project);
  let offset = 0;

  const singleDrop = measure(() => {
    offset += 1;
    applyCommandToHistory(history, dragCommand(1, offset));
  });
  const groupDrop = measure(() => {
    offset += 1;
    applyCommandToHistory(history, dragCommand(10, offset));
  });

  const movedHistory = applyCommandToHistory(history, dragCommand(1, 999));
  const compileAnd2D = measure(() => {
    projectViewTo2D(compileView(movedHistory.project, VIEW_ID));
  });
  const compiled = compileView(movedHistory.project, VIEW_ID);
  const projection3D = measure(() => {
    projectViewTo3D(compiled, movedHistory.project.threeD.policy);
  });
  const undoRedo = measure(() => {
    redoCommand(undoCommand(movedHistory));
  });

  // Isolate the two whole-document costs a drop pays before any layout work happens, so the
  // bottleneck can be named from evidence rather than inferred from the total.
  const validation = measure(() => {
    ProjectSchema.parse(movedHistory.project);
  });
  const cloning = measure(() => {
    structuredClone(movedHistory.project);
  });

  rows.push(
    [
      String(elementCount).padStart(5),
      format(singleDrop.median),
      format(singleDrop.p95),
      format(groupDrop.median),
      format(validation.median),
      format(cloning.median),
      format(compileAnd2D.median),
      format(projection3D.median),
      format(undoRedo.median),
    ].join(' '),
  );
}

console.log(
  [
    '  size',
    ' drop p50',
    ' drop p95',
    ' x10 p50',
    'validate',
    '   clone',
    '  2D p50',
    '  3D p50',
    'undo+redo',
  ].join(' '),
);
console.log(rows.join('\n'));
console.log('\nAll values in milliseconds. Report the hardware alongside them.');
