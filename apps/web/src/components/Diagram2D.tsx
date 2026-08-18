import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { ViewItemMove } from '@cd3/domain';
import type { ProjectedView2D } from '@cd3/layout';

import { PALETTE_MIME } from '../editor/palette';
import { modelKeyFor } from './spatial-icon';
import { movesCollide } from '../editor/placement';
import { DatumNode, type DatumFlowNode } from './DatumNode';

export interface Diagram2DProps {
  readonly projection: ProjectedView2D;
  /** Drives the inspector, the tree, and edge emphasis. */
  readonly selectedElementId: string | undefined;
  /** Every selected element, including the primary. Drives which nodes drag together. */
  readonly selectedElementIds: readonly string[];
  readonly onSelect: (elementId: string | undefined, additive?: boolean) => void;
  readonly onMoveItems: (moves: readonly ViewItemMove[]) => void;
  /** Palette drop, reported in placement space so the caller stays renderer-neutral. */
  readonly onDropPaletteEntry: (entryId: string, placement: { x: number; y: number }) => void;
  /** Click on a relationship line or its label: open that connection's editor at the pointer. */
  readonly onEditRelationship: (request: {
    relationshipId: string;
    clientX: number;
    clientY: number;
  }) => void;
  /** Double-click on empty canvas: where the pointer is on screen, and in placement space. */
  readonly onRequestAddAt: (request: {
    clientX: number;
    clientY: number;
    placement: { x: number; y: number };
  }) => void;
  readonly onConnectElements: (sourceElementId: string, targetElementId: string) => void;
  /** Connect tool disables dragging, so a click reads as "pick an endpoint" and nothing else. */
  readonly connecting: boolean;
  /** Bumped when the caller adds something off-screen and wants the canvas to show it. */
  readonly revealSignal: number;
}

const nodeTypes = { datum: DatumNode } satisfies NodeTypes;

function compareItemIds(left: ViewItemMove, right: ViewItemMove): number {
  return left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0;
}

export function Diagram2D({
  projection,
  selectedElementId,
  selectedElementIds,
  onSelect,
  onMoveItems,
  onDropPaletteEntry,
  onConnectElements,
  connecting,
  revealSignal,
  onRequestAddAt,
  onEditRelationship,
}: Diagram2DProps) {
  const [flow, setFlow] = useState<ReactFlowInstance<DatumFlowNode, Edge> | null>(null);
  const elementIdByItemId = useMemo(
    () =>
      new Map<string, string>(projection.nodes.map((node) => [node.viewItemId, node.elementId])),
    [projection.nodes],
  );
  const connect = useCallback(
    (connection: Connection) => {
      const sourceElementId = elementIdByItemId.get(connection.source);
      const targetElementId = elementIdByItemId.get(connection.target);
      if (sourceElementId !== undefined && targetElementId !== undefined) {
        onConnectElements(sourceElementId, targetElementId);
      }
    },
    [elementIdByItemId, onConnectElements],
  );
  const selectedElements = useMemo(() => new Set<string>(selectedElementIds), [selectedElementIds]);
  const canonicalNodes = useMemo<DatumFlowNode[]>(
    () =>
      projection.nodes.map((node) => ({
        id: node.viewItemId,
        type: 'datum',
        position: node.position,
        width: node.width,
        height: node.height,
        selected: selectedElements.has(node.elementId),
        draggable: !connecting,
        connectable: false,
        selectable: true,
        focusable: true,
        data: {
          elementId: node.elementId,
          kind: node.kind,
          name: node.label ?? node.name,
          ...(node.technology === undefined ? {} : { technology: node.technology }),
          ...(node.color === undefined ? {} : { color: node.color }),
          icon: modelKeyFor(node),
          external: node.tags.includes('external'),
        },
        style: { width: node.width, height: node.height },
        ariaLabel: `${node.name}, ${node.kind}`,
      })),
    [connecting, projection.nodes, selectedElements],
  );

  // Transient renderer state. Pointer movement writes here and nowhere else, so no domain command,
  // validation, or projection runs until the gesture ends.
  const [nodes, setNodes] = useState<DatumFlowNode[]>(canonicalNodes);

  // A new canonical projection always wins: it arrives from an accepted command, a view switch, or
  // a selection change, and any in-flight preview is stale by definition.
  useEffect(() => {
    setNodes(canonicalNodes);
  }, [canonicalNodes]);

  useEffect(() => {
    if (revealSignal > 0 && flow !== null) {
      void flow.fitView({ padding: 0.18, duration: 250 });
    }
  }, [flow, revealSignal]);

  const handleNodesChange = useCallback((changes: NodeChange<DatumFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const placedItems = useMemo(
    () =>
      projection.nodes.map((node) => ({
        itemId: node.viewItemId,
        rect: { x: node.x, y: node.y, width: node.width, height: node.height },
      })),
    [projection.nodes],
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, _node: DatumFlowNode, draggedNodes: DatumFlowNode[]) => {
      const canonicalPositions = new Map<string, Readonly<{ x: number; y: number }>>(
        projection.nodes.map((node) => [node.viewItemId, node.position]),
      );
      const moves = draggedNodes
        .map((node) => ({ itemId: node.id, x: node.position.x, y: node.position.y }))
        .sort(compareItemIds);
      const moved = moves.some((move) => {
        const canonical = canonicalPositions.get(move.itemId);
        return canonical === undefined || canonical.x !== move.x || canonical.y !== move.y;
      });

      // A block dropped on top of another would hide it, so the drag is simply not committed and
      // the preview below snaps the node back to its canonical placement.
      if (moved && !movesCollide(moves, placedItems)) {
        onMoveItems(moves);
      }
      // Reset unconditionally. An accepted command replaces `canonicalNodes` and the effect above
      // re-synchronizes; a rejected one leaves it untouched, so this is what snaps the preview back.
      setNodes(canonicalNodes);
    },
    [canonicalNodes, onMoveItems, placedItems, projection.nodes],
  );

  const edges = useMemo<Edge[]>(
    () =>
      projection.edges.map((edge) => {
        const emphasized =
          edge.sourceElementId === selectedElementId ||
          edge.targetElementId === selectedElementId ||
          edge.visibleSourceElementId === selectedElementId ||
          edge.visibleTargetElementId === selectedElementId;
        return {
          id: edge.relationshipId,
          source: edge.sourceViewItemId,
          target: edge.targetViewItemId,
          label: edge.name,
          type: 'smoothstep',
          selectable: true,
          focusable: false,
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: emphasized ? '#2c5cc5' : '#65737a',
          },
          style: {
            stroke: emphasized ? '#2c5cc5' : '#65737a',
            strokeWidth: emphasized ? 2.4 : 1.5,
            strokeDasharray: edge.interaction === 'asynchronous' ? '6 4' : undefined,
          },
          // SVG text cannot inherit a CSS custom property, so this mirrors --t-small by hand.
          labelStyle: {
            fill: '#425159',
            fontSize: 11,
            fontWeight: 550,
          },
          labelBgStyle: { fill: '#fcfdfc', fillOpacity: 0.94 },
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [projection.edges, selectedElementId],
  );

  return (
    <section
      className="diagram-surface"
      aria-label={`${projection.name} 2D diagram`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(PALETTE_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const entryId = event.dataTransfer.getData(PALETTE_MIME);
        if (entryId === '' || flow === null) {
          return;
        }
        event.preventDefault();
        onDropPaletteEntry(
          entryId,
          flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        );
      }}
    >
      <ReactFlow<DatumFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setFlow}
        onNodesChange={handleNodesChange}
        onEdgesChange={() => undefined}
        onNodeDragStop={handleNodeDragStop}
        onConnect={connect}
        onNodeClick={(event, node) =>
          onSelect(node.data.elementId, event.ctrlKey || event.metaKey || event.shiftKey)
        }
        onEdgeClick={(event, edge) => {
          onEditRelationship({
            relationshipId: edge.id,
            clientX: event.clientX,
            clientY: event.clientY,
          });
        }}
        onPaneClick={(event) => {
          onSelect(undefined);
          // The second click of a double-click carries detail 2: open the add menu right there.
          if (event.detail === 2 && flow !== null) {
            onRequestAddAt({
              clientX: event.clientX,
              clientY: event.clientY,
              placement: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            });
          }
        }}
        nodesDraggable={!connecting}
        nodesConnectable
        zoomOnDoubleClick={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.15 }}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          id="datum-grid"
          variant={BackgroundVariant.Dots}
          color="#c5d0cb"
          gap={16}
          size={1}
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
