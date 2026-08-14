import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import type { ProjectedView2D } from '@cd3/layout';

import { DatumNode, type DatumFlowNode } from './DatumNode';

export interface Diagram2DProps {
  readonly projection: ProjectedView2D;
  readonly selectedElementId: string | undefined;
  readonly onSelect: (elementId: string | undefined) => void;
}

const nodeTypes = { datum: DatumNode } satisfies NodeTypes;

export function Diagram2D({ projection, selectedElementId, onSelect }: Diagram2DProps) {
  const nodes = useMemo<DatumFlowNode[]>(
    () =>
      projection.nodes.map((node) => ({
        id: node.viewItemId,
        type: 'datum',
        position: node.position,
        width: node.width,
        height: node.height,
        selected: node.elementId === selectedElementId,
        draggable: false,
        connectable: false,
        selectable: true,
        focusable: true,
        data: {
          elementId: node.elementId,
          kind: node.kind,
          name: node.label ?? node.name,
          ...(node.technology === undefined ? {} : { technology: node.technology }),
          external: node.tags.includes('external'),
        },
        style: { width: node.width, height: node.height },
        ariaLabel: `${node.name}, ${node.kind}`,
      })),
    [projection.nodes, selectedElementId],
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
          selectable: false,
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
    <section className="diagram-surface" aria-label={`${projection.name} 2D diagram`}>
      <ReactFlow<DatumFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onNodeClick={(_, node) => onSelect(node.data.elementId)}
        onPaneClick={() => onSelect(undefined)}
        nodesDraggable={false}
        nodesConnectable={false}
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
      <div className="view-datum" aria-hidden="true">
        <span>{projection.type} view</span>
        <span>{projection.nodes.length} elements</span>
        <span>{projection.edges.length} relationships</span>
      </div>
    </section>
  );
}
