import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommandToHistory, createCommandHistory, type ViewItemMove } from '@cd3/domain';
import type { ProjectedView2D } from '@cd3/layout';

import type * as XYFlowModule from '@xyflow/react';

const { reactFlowPropsMock } = vi.hoisted(() => ({ reactFlowPropsMock: vi.fn() }));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XYFlowModule>();
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      reactFlowPropsMock(props);
      return <div data-testid="react-flow-surface" />;
    },
    Background: () => null,
    Controls: () => null,
  };
});

import { Diagram2D } from './Diagram2D';
import type { DatumFlowNode } from './DatumNode';
import { getWorkspaceView, project } from '../workspace';

const viewId = 'core-containers';
const baseProjection = getWorkspaceView(project, viewId).twoD;
const [firstNode, secondNode] = baseProjection.nodes;
if (firstNode === undefined || secondNode === undefined) {
  throw new Error('The fixture view must contain at least two nodes.');
}

/** Two item IDs whose sorted order is the reverse of the order they are dragged in. */
const [lowerItemId, higherItemId] =
  firstNode.viewItemId < secondNode.viewItemId
    ? [firstNode.viewItemId, secondNode.viewItemId]
    : [secondNode.viewItemId, firstNode.viewItemId];

function projectionAfterMove(moves: readonly ViewItemMove[]): ProjectedView2D {
  const history = applyCommandToHistory(createCommandHistory(project), {
    type: 'move-view-items',
    viewId,
    moves,
  });
  return getWorkspaceView(history.project, viewId).twoD;
}

interface CapturedFlowProps {
  readonly nodes: readonly DatumFlowNode[];
  readonly nodesDraggable: boolean;
  readonly onNodesChange: (changes: readonly unknown[]) => void;
  readonly onNodeDragStop: (
    event: unknown,
    node: DatumFlowNode,
    nodes: readonly DatumFlowNode[],
  ) => void;
  readonly onNodeClick: (event: unknown, node: DatumFlowNode) => void;
  readonly onPaneClick: (event: unknown) => void;
  readonly onConnect: (connection: { source: string; target: string }) => void;
}

function latestFlowProps(): CapturedFlowProps {
  const lastCall = reactFlowPropsMock.mock.lastCall;
  if (lastCall === undefined) {
    throw new Error('ReactFlow has not rendered.');
  }
  return lastCall[0] as CapturedFlowProps;
}

function nodeById(itemId: string): DatumFlowNode {
  const node = latestFlowProps().nodes.find((candidate) => candidate.id === itemId);
  if (node === undefined) {
    throw new Error(`Node "${itemId}" is not rendered.`);
  }
  return node;
}

function dragTo(itemId: string, x: number, y: number): void {
  act(() => {
    latestFlowProps().onNodesChange([
      { id: itemId, type: 'position', position: { x, y }, dragging: true },
    ]);
  });
}

function dropDragged(itemIds: readonly string[]): void {
  const dragged = itemIds.map((itemId) => nodeById(itemId));
  const [primary] = dragged;
  if (primary === undefined) {
    throw new Error('A drop needs at least one dragged node.');
  }
  act(() => {
    latestFlowProps().onNodeDragStop({}, primary, dragged);
  });
}

function renderDiagram(overrides: Partial<Parameters<typeof Diagram2D>[0]> = {}) {
  const onMoveItems = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <Diagram2D
      projection={baseProjection}
      selectedElementId={undefined}
      selectedElementIds={[]}
      onSelect={onSelect}
      onMoveItems={onMoveItems}
      onDropPaletteEntry={vi.fn()}
      onConnectElements={vi.fn()}
      connecting={false}
      revealSignal={0}
      {...overrides}
    />,
  );
  return { ...view, onMoveItems, onSelect };
}

describe('Diagram2D authoring', () => {
  beforeEach(() => {
    reactFlowPropsMock.mockClear();
  });

  it('reports handle connections as element ids, not view item ids', () => {
    const onConnectElements = vi.fn();
    renderDiagram({ onConnectElements });

    act(() => {
      latestFlowProps().onConnect({ source: lowerItemId, target: higherItemId });
    });

    expect(onConnectElements).toHaveBeenCalledWith(
      nodeById(lowerItemId).data.elementId,
      nodeById(higherItemId).data.elementId,
    );
  });

  it('does not commit a drag that drops a node on top of another one', () => {
    const { onMoveItems } = renderDiagram();
    const target = nodeById(higherItemId);

    dragTo(lowerItemId, target.position.x + 10, target.position.y + 10);
    dropDragged([lowerItemId]);

    expect(onMoveItems).not.toHaveBeenCalled();
    expect(nodeById(lowerItemId).position).toEqual(
      baseProjection.nodes.find((node) => node.viewItemId === lowerItemId)?.position,
    );
  });

  it('parks node dragging while the connect tool is active', () => {
    renderDiagram({ connecting: true });

    expect(latestFlowProps().nodesDraggable).toBe(false);
    expect(latestFlowProps().nodes.every((node) => node.draggable === false)).toBe(true);
  });
});

describe('Diagram2D drag editing', () => {
  beforeEach(() => {
    reactFlowPropsMock.mockClear();
  });

  it('enables dragging on the surface and on every node', () => {
    renderDiagram();

    expect(latestFlowProps().nodesDraggable).toBe(true);
    expect(latestFlowProps().nodes.every((node) => node.draggable === true)).toBe(true);
  });

  it('moves a node locally during a drag without emitting a command', () => {
    const { onMoveItems } = renderDiagram();

    dragTo(lowerItemId, 640, 900);

    expect(nodeById(lowerItemId).position).toEqual({ x: 640, y: 900 });
    expect(onMoveItems).not.toHaveBeenCalled();
  });

  it('renders once per pointer-move batch and never amplifies them', () => {
    renderDiagram();
    const before = reactFlowPropsMock.mock.calls.length;

    for (let step = 0; step < 5; step += 1) {
      dragTo(lowerItemId, 400 + step, 900 + step);
    }

    // One render per change. Any cascade — a projection recompute, an effect writing state back,
    // a new node identity for untouched nodes — would show up here as extra renders.
    expect(reactFlowPropsMock.mock.calls.length - before).toBe(5);
  });

  it('leaves every untouched node object identical during a drag', () => {
    renderDiagram();
    const untouched = nodeById(higherItemId);

    dragTo(lowerItemId, 640, 900);

    expect(nodeById(higherItemId)).toBe(untouched);
  });

  it('emits exactly one command when the pointer is released', () => {
    const { onMoveItems } = renderDiagram();

    dragTo(lowerItemId, 640, 900);
    dropDragged([lowerItemId]);

    expect(onMoveItems).toHaveBeenCalledOnce();
    expect(onMoveItems).toHaveBeenCalledWith([{ itemId: lowerItemId, x: 640, y: 900 }]);
  });

  it('collects a multi-node drag into one command sorted by code-unit order', () => {
    const { onMoveItems } = renderDiagram();

    dragTo(higherItemId, 700, 1000);
    dragTo(lowerItemId, 640, 900);
    dropDragged([higherItemId, lowerItemId]);

    expect(onMoveItems).toHaveBeenCalledOnce();
    expect(onMoveItems).toHaveBeenCalledWith([
      { itemId: lowerItemId, x: 640, y: 900 },
      { itemId: higherItemId, x: 700, y: 1000 },
    ]);
  });

  it('emits nothing when every dragged node is released at its canonical position', () => {
    const { onMoveItems } = renderDiagram();

    dragTo(lowerItemId, 900, 900);
    dragTo(lowerItemId, firstNode.position.x, firstNode.position.y);
    dropDragged([lowerItemId]);

    expect(onMoveItems).not.toHaveBeenCalled();
  });

  it('restores canonical positions when a drop is rejected and the projection does not change', () => {
    const { onMoveItems } = renderDiagram();

    dragTo(lowerItemId, 640, 900);
    dropDragged([lowerItemId]);

    expect(onMoveItems).toHaveBeenCalledOnce();
    expect(nodeById(lowerItemId).position).toEqual({
      x: firstNode.viewItemId === lowerItemId ? firstNode.position.x : secondNode.position.x,
      y: firstNode.viewItemId === lowerItemId ? firstNode.position.y : secondNode.position.y,
    });
  });

  it('adopts the accepted coordinates once the projection reflects the command', () => {
    const { rerender } = renderDiagram();

    dragTo(lowerItemId, 640, 900);
    dropDragged([lowerItemId]);

    rerender(
      <Diagram2D
        projection={projectionAfterMove([{ itemId: lowerItemId, x: 640, y: 900 }])}
        selectedElementId={undefined}
        selectedElementIds={[]}
        onSelect={vi.fn()}
        onMoveItems={vi.fn()}
        onDropPaletteEntry={vi.fn()}
        onConnectElements={vi.fn()}
        connecting={false}
        revealSignal={0}
      />,
    );

    expect(nodeById(lowerItemId).position).toEqual({ x: 640, y: 900 });
  });

  it('discards a stale drag preview when the projection identity changes', () => {
    const { rerender } = renderDiagram();

    dragTo(lowerItemId, 640, 900);
    expect(nodeById(lowerItemId).position).toEqual({ x: 640, y: 900 });

    const otherProjection = projectionAfterMove([{ itemId: higherItemId, x: 111, y: 222 }]);
    rerender(
      <Diagram2D
        projection={otherProjection}
        selectedElementId={undefined}
        selectedElementIds={[]}
        onSelect={vi.fn()}
        onMoveItems={vi.fn()}
        onDropPaletteEntry={vi.fn()}
        onConnectElements={vi.fn()}
        connecting={false}
        revealSignal={0}
      />,
    );

    const canonical = otherProjection.nodes.find((node) => node.viewItemId === lowerItemId);
    expect(nodeById(lowerItemId).position).toEqual(canonical?.position);
    expect(nodeById(higherItemId).position).toEqual({ x: 111, y: 222 });
  });

  it('still reports semantic selection from clicks and pane clears', () => {
    const { onSelect } = renderDiagram();

    act(() => {
      latestFlowProps().onNodeClick(
        { ctrlKey: false, metaKey: false, shiftKey: false },
        nodeById(lowerItemId),
      );
    });
    expect(onSelect).toHaveBeenCalledWith(nodeById(lowerItemId).data.elementId, false);

    act(() => {
      latestFlowProps().onPaneClick({});
    });
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it.each([
    ['Control', { ctrlKey: true, metaKey: false, shiftKey: false }],
    ['Meta', { ctrlKey: false, metaKey: true, shiftKey: false }],
    ['Shift', { ctrlKey: false, metaKey: false, shiftKey: true }],
  ])('reports a %s-modified click as an additive selection', (_label, modifiers) => {
    const { onSelect } = renderDiagram();

    act(() => {
      latestFlowProps().onNodeClick(modifiers, nodeById(lowerItemId));
    });

    expect(onSelect).toHaveBeenCalledWith(nodeById(lowerItemId).data.elementId, true);
  });

  it('marks every selected element rather than only the primary one', () => {
    const primaryElementId = firstNode.elementId;
    const secondaryElementId = secondNode.elementId;
    renderDiagram({
      selectedElementId: primaryElementId,
      selectedElementIds: [primaryElementId, secondaryElementId],
    });

    expect(nodeById(firstNode.viewItemId).selected).toBe(true);
    expect(nodeById(secondNode.viewItemId).selected).toBe(true);
  });

  it('commits a group drag of the whole selection as one sorted command', () => {
    const { onMoveItems } = renderDiagram({
      selectedElementId: firstNode.elementId,
      selectedElementIds: [firstNode.elementId, secondNode.elementId],
    });

    dragTo(higherItemId, 700, 1000);
    dragTo(lowerItemId, 640, 900);
    dropDragged([higherItemId, lowerItemId]);

    expect(onMoveItems).toHaveBeenCalledOnce();
    expect(onMoveItems).toHaveBeenCalledWith([
      { itemId: lowerItemId, x: 640, y: 900 },
      { itemId: higherItemId, x: 700, y: 1000 },
    ]);
  });
});
