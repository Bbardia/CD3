import { LIMITS, ProjectSchema, type ProjectInput } from '@cd3/domain';

export interface GenerateSyntheticProjectOptions {
  /** Number of semantic elements represented in the generated context view. */
  visibleElements: number;
}

const GRID_COLUMNS = 10;
const GRID_X_STEP = 240;
const GRID_Y_STEP = 140;

function numericId(index: number): string {
  return String(index).padStart(4, '0');
}

function elementId(index: number): string {
  return `synthetic-node-${numericId(index)}`;
}

function viewItemId(index: number): string {
  return `synthetic-context-item-${numericId(index)}`;
}

function assertVisibleElementCount(visibleElements: number): void {
  if (
    !Number.isSafeInteger(visibleElements) ||
    visibleElements < 1 ||
    visibleElements > LIMITS.elements
  ) {
    throw new RangeError(
      `visibleElements must be a safe integer from 1 through ${String(LIMITS.elements)}.`,
    );
  }
}

/**
 * Builds a deterministic renderer-scale context project.
 *
 * IDs and grid placements for a given index do not depend on the requested fixture size, so a
 * smaller fixture is a stable prefix of every larger fixture.
 */
export function generateSyntheticProject({ visibleElements }: GenerateSyntheticProjectOptions) {
  assertVisibleElementCount(visibleElements);

  const elements: ProjectInput['elements'] = {};
  const relationships: ProjectInput['relationships'] = {};
  const items: ProjectInput['views'][string]['items'] = {};
  const placements: ProjectInput['views'][string]['placements'] = {};

  for (let index = 1; index <= visibleElements; index += 1) {
    const id = elementId(index);
    const serial = numericId(index);
    const isPerson = index % 5 === 0;

    elements[id] = isPerson
      ? {
          id,
          kind: 'person',
          name: `Synthetic Persona ${serial}`,
          description: `Deterministic actor ${serial} used to exercise visible architecture graphs.`,
          tags: ['synthetic', 'person', `cohort-${String(index % GRID_COLUMNS)}`],
          properties: {
            index,
            fixture: 'performance',
            channels: ['browser', 'api'],
          },
          externalRefs: [],
        }
      : {
          id,
          kind: 'softwareSystem',
          name: index === 1 ? 'Synthetic Graph Hub' : `Synthetic Service ${serial}`,
          description:
            index === 1
              ? 'Stable scope and hub for deterministic performance-fixture views.'
              : `Deterministic software system ${serial} used to exercise visible architecture graphs.`,
          technology: 'Synthetic HTTPS service',
          tags: ['synthetic', 'software-system', `partition-${String(index % GRID_COLUMNS)}`],
          properties: {
            index,
            fixture: 'performance',
            capacity: { weight: (index % 7) + 1, active: true },
          },
          externalRefs: [],
        };

    const itemId = viewItemId(index);
    const zeroBasedIndex = index - 1;
    items[itemId] = {
      id: itemId,
      elementId: id,
      label: `Node ${serial}`,
    };
    placements[itemId] = {
      x: (zeroBasedIndex % GRID_COLUMNS) * GRID_X_STEP,
      y: Math.floor(zeroBasedIndex / GRID_COLUMNS) * GRID_Y_STEP,
      width: 200,
      height: 96,
    };
  }

  for (let sourceIndex = 1; sourceIndex < visibleElements; sourceIndex += 1) {
    const targetIndex = sourceIndex + 1;
    const id = `synthetic-link-${numericId(sourceIndex)}-${numericId(targetIndex)}`;
    relationships[id] = {
      id,
      sourceId: elementId(sourceIndex),
      targetId: elementId(targetIndex),
      name: 'Forwards deterministic request',
      description: `Primary graph edge from node ${numericId(sourceIndex)} to node ${numericId(targetIndex)}.`,
      interaction: sourceIndex % 4 === 0 ? 'asynchronous' : 'synchronous',
      technology: sourceIndex % 4 === 0 ? 'Synthetic event' : 'Synthetic HTTPS',
      tags: ['synthetic', 'primary-edge'],
      properties: { sequence: sourceIndex },
      externalRefs: [],
    };
  }

  for (let sourceIndex = 1; sourceIndex + 5 <= visibleElements; sourceIndex += 5) {
    const targetIndex = sourceIndex + 5;
    const id = `synthetic-skip-${numericId(sourceIndex)}-${numericId(targetIndex)}`;
    relationships[id] = {
      id,
      sourceId: elementId(sourceIndex),
      targetId: elementId(targetIndex),
      name: 'Publishes partition update',
      description: `Secondary graph edge from node ${numericId(sourceIndex)} to node ${numericId(targetIndex)}.`,
      interaction: 'asynchronous',
      technology: 'Synthetic event stream',
      tags: ['synthetic', 'secondary-edge'],
      properties: { hop: 5, partition: sourceIndex % GRID_COLUMNS },
      externalRefs: [],
    };
  }

  const rowCount = Math.ceil(visibleElements / GRID_COLUMNS);
  const input = {
    schemaVersion: 1,
    id: `synthetic-${numericId(visibleElements)}-elements`,
    name: `Synthetic ${String(visibleElements)}-element project`,
    description:
      'A deterministic, fictional graph fixture for renderer correctness and performance checks.',
    elements,
    relationships,
    views: {
      'synthetic-context': {
        id: 'synthetic-context',
        type: 'context',
        scopeElementId: elementId(1),
        name: `Synthetic context — ${String(visibleElements)} visible elements`,
        description: 'A fixed ten-column grid with a connected directed graph and skip edges.',
        items,
        placements,
        relationshipIds: Object.keys(relationships),
      },
    },
    threeD: {
      policy: {
        coordinateScale: 0.02,
        elevationStep: 0,
        platformPadding: 0.5,
        defaultProjection: 'orthographic',
      },
      bookmarks: {
        'synthetic-context-overview': {
          id: 'synthetic-context-overview',
          name: 'Synthetic graph overview',
          viewId: 'synthetic-context',
          projection: 'orthographic',
          position: { x: 32, y: 24 + rowCount, z: 32 },
          target: {
            x: ((Math.min(visibleElements, GRID_COLUMNS) - 1) * GRID_X_STEP * 0.02) / 2,
            y: 0,
            z: ((rowCount - 1) * GRID_Y_STEP * 0.02) / 2,
          },
          zoom: Math.max(0.2, Math.min(1.2, 10 / Math.max(GRID_COLUMNS, rowCount))),
        },
      },
    },
  } satisfies ProjectInput;

  return ProjectSchema.parse(input);
}
