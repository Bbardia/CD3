import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export interface DatumNodeData extends Record<string, unknown> {
  readonly elementId: string;
  readonly kind: 'component' | 'container' | 'person' | 'softwareSystem';
  readonly name: string;
  readonly technology?: string;
  readonly external: boolean;
  /** Author-chosen accent; falls back to the kind rail colour from the stylesheet. */
  readonly color?: string;
  /** Resolved prop key, mirrored as a small glyph so 2D and 3D read the same. */
  readonly icon: string;
}

export type DatumFlowNode = Node<DatumNodeData, 'datum'>;

const kindLabel = {
  component: 'Component',
  container: 'Container',
  person: 'Person',
  softwareSystem: 'System',
} as const;

export const DatumNode = memo(function DatumNode({ data, selected }: NodeProps<DatumFlowNode>) {
  return (
    <article
      className={`datum-node datum-node--${data.kind}${data.external ? ' datum-node--external' : ''}${selected ? ' is-selected' : ''}`}
      aria-label={`${data.name}, ${kindLabel[data.kind]}`}
    >
      <Handle type="target" position={Position.Left} className="datum-node__handle" />
      <span
        className="datum-node__rail"
        aria-hidden="true"
        {...(data.color === undefined ? {} : { style: { background: data.color } })}
      />
      <div className="datum-node__body">
        <div className="datum-node__eyebrow">
          <span className={`datum-node__glyph palette-glyph--${data.icon}`} aria-hidden="true" />
          <span>{kindLabel[data.kind]}</span>
          {data.external ? <span className="datum-node__external">External</span> : null}
        </div>
        <strong>{data.name}</strong>
        {data.technology === undefined ? null : (
          <span className="datum-node__technology">{data.technology}</span>
        )}
      </div>
      {selected ? <span className="registration-ticks" aria-hidden="true" /> : null}
      <Handle type="source" position={Position.Right} className="datum-node__handle" />
    </article>
  );
});
