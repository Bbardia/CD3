import ELK from 'elkjs/lib/elk.bundled.js';

import { cloneJsonValue, compareIds, deepFreeze } from './immutable.js';
import { projectViewTo2D } from './project-2d.js';
import type {
  LayoutInput,
  LayoutPreview,
  LayoutPreviewNode,
  LayoutPreviewOptions,
  LayoutPreviewWarning,
  ProjectedView2D,
  ViewNode2D,
} from './types.js';

const DEFAULT_HORIZONTAL_SPACING = 56;
const DEFAULT_VERTICAL_SPACING = 48;

interface ElkGraphNode {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly x?: number;
  readonly y?: number;
}

interface ElkGraphEdge {
  readonly id: string;
  readonly sources: string[];
  readonly targets: string[];
}

interface ElkGraph extends ElkGraphNode {
  readonly layoutOptions?: Record<string, string>;
  readonly children?: ElkGraphNode[];
  readonly edges?: ElkGraphEdge[];
}

interface ElkLayoutEngine {
  layout(graph: ElkGraph): Promise<ElkGraph>;
}

function asProjectedView(input: LayoutInput): ProjectedView2D {
  return 'nodes' in input ? input : projectViewTo2D(input);
}

function definePlacement(
  placements: Record<string, Readonly<{ x: number; y: number; width: number; height: number }>>,
  id: string,
  value: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  Object.defineProperty(placements, id, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function previewNode(node: ViewNode2D, x: number, y: number, pinned: boolean): LayoutPreviewNode {
  const clonedNode = cloneJsonValue(node);
  const placement = { ...clonedNode.placement, x, y };
  return {
    ...clonedNode,
    x,
    y,
    position: { x, y },
    placement,
    pinned,
  };
}

function buildPreview(
  view: ProjectedView2D,
  positions: ReadonlyMap<string, Readonly<{ x: number; y: number }>>,
  pinnedIds: ReadonlySet<string>,
  engine: LayoutPreview['engine'],
  warnings: readonly LayoutPreviewWarning[],
): LayoutPreview {
  const nodes = view.nodes.map((node) => {
    const position = positions.get(node.viewItemId) ?? node.position;
    return previewNode(node, position.x, position.y, pinnedIds.has(node.viewItemId));
  });
  const placements: Record<
    string,
    Readonly<{ x: number; y: number; width: number; height: number }>
  > = {};
  for (const node of nodes) {
    definePlacement(placements, node.viewItemId, node.placement);
  }
  return deepFreeze({
    engine,
    projectId: view.projectId,
    viewId: view.viewId,
    nodes,
    edges: view.edges.map((edge) => cloneJsonValue(edge)),
    placements,
    warnings: [...warnings],
  });
}

/**
 * Produces a deterministic, non-mutating grid preview. It is the safe fallback when ELK is
 * unavailable and is also useful for immediate UI preview while the worker is loading.
 */
export function createDeterministicLayoutPreview(
  input: LayoutInput,
  options: LayoutPreviewOptions = {},
): LayoutPreview {
  const view = asProjectedView(input);
  const sorted = [...view.nodes].sort((left, right) => compareIds(left.id, right.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_HORIZONTAL_SPACING;
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING;
  const pinnedIds = new Set(options.pinnedViewItemIds ?? []);
  const maximumWidth = Math.max(1, ...sorted.map((node) => node.width));
  const maximumHeight = Math.max(1, ...sorted.map((node) => node.height));
  const positions = new Map<string, Readonly<{ x: number; y: number }>>();

  sorted.forEach((node, index) => {
    if (pinnedIds.has(node.viewItemId)) {
      positions.set(node.viewItemId, node.position);
      return;
    }
    const row = Math.floor(index / columns);
    const column = index % columns;
    const horizontal = column * (maximumWidth + horizontalSpacing);
    const vertical = row * (maximumHeight + verticalSpacing);
    const direction = options.direction ?? 'RIGHT';
    const position =
      direction === 'LEFT'
        ? { x: -horizontal, y: vertical }
        : direction === 'UP'
          ? { x: horizontal, y: -vertical }
          : direction === 'DOWN'
            ? { x: horizontal, y: vertical }
            : { x: horizontal, y: vertical };
    positions.set(node.viewItemId, position);
  });

  return buildPreview(view, positions, pinnedIds, 'deterministic-fallback', [
    {
      code: 'fallback-layout',
      message: 'Used the deterministic grid preview; canonical placements were not mutated.',
    },
  ]);
}

/**
 * Runs ELK as a preview-only adapter. Pinned nodes are restored to their canonical coordinates
 * after layout; applying the preview remains an explicit editor command outside this package.
 */
export async function layoutViewWithElk(
  input: LayoutInput,
  options: LayoutPreviewOptions = {},
  injectedEngine?: ElkLayoutEngine,
): Promise<LayoutPreview> {
  const view = asProjectedView(input);
  const pinnedIds = new Set(options.pinnedViewItemIds ?? []);
  const direction = options.direction ?? 'RIGHT';
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_HORIZONTAL_SPACING;
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_VERTICAL_SPACING;

  try {
    const elk = injectedEngine ?? (new ELK() as unknown as ElkLayoutEngine);
    const graph = await elk.layout({
      id: `view-${view.viewId}`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.spacing.nodeNode': String(verticalSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(horizontalSpacing),
      },
      children: view.nodes.map((node) => ({
        id: node.viewItemId,
        width: node.width,
        height: node.height,
      })),
      edges: view.edges.map((edge) => ({
        id: `layout-edge-${edge.relationshipId}`,
        sources: [edge.sourceViewItemId],
        targets: [edge.targetViewItemId],
      })),
    });

    const childrenById = new Map((graph.children ?? []).map((child) => [child.id, child]));
    const positions = new Map<string, Readonly<{ x: number; y: number }>>();
    for (const node of view.nodes) {
      const child = childrenById.get(node.viewItemId);
      if (child === undefined || !Number.isFinite(child.x) || !Number.isFinite(child.y)) {
        throw new TypeError(`ELK returned no finite position for view item "${node.viewItemId}".`);
      }
      positions.set(node.viewItemId, { x: child.x as number, y: child.y as number });
    }
    for (const node of view.nodes) {
      if (pinnedIds.has(node.viewItemId)) {
        positions.set(node.viewItemId, node.position);
      }
    }

    const warnings: LayoutPreviewWarning[] = [];
    if (pinnedIds.size > 0) {
      warnings.push({
        code: 'pinned-post-layout',
        message:
          'Pinned nodes were restored after ELK; accepted layout must preserve these positions.',
      });
    }
    return buildPreview(view, positions, pinnedIds, 'elk', warnings);
  } catch (error) {
    const fallback = createDeterministicLayoutPreview(view, options);
    const message = error instanceof Error ? error.message : String(error);
    return buildPreview(
      view,
      new Map(fallback.nodes.map((node) => [node.viewItemId, node.position])),
      pinnedIds,
      'deterministic-fallback',
      [
        {
          code: 'elk-failed',
          message: `ELK failed; used deterministic fallback: ${message}`,
        },
      ],
    );
  }
}
