import { memo, useEffect, useState } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { ViewAnnotation } from '@cd3/domain';

export interface AnnotationNodeData extends Record<string, unknown> {
  readonly annotation: ViewAnnotation;
  readonly onRename: (annotationId: string, label: string) => void;
  readonly onDelete: (annotationId: string) => void;
  /** Committed on resize end; moves go through the shared drag-stop path instead. */
  readonly onResize: (
    annotationId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;
}

export type AnnotationFlowNode = Node<AnnotationNodeData, 'annotation'>;

/**
 * A presentation-layer decoration: a boundary box that groups elements visually, or a text note.
 * Neither is a model element — they live on the view and never join the semantic graph.
 */
export const AnnotationNode = memo(function AnnotationNode({
  data,
  selected,
}: NodeProps<AnnotationFlowNode>) {
  const { annotation } = data;
  const [label, setLabel] = useState(annotation.label ?? '');

  useEffect(() => {
    setLabel(annotation.label ?? '');
  }, [annotation.label]);

  const commit = () => {
    const next = label.trim();
    if (next !== (annotation.label ?? '')) {
      data.onRename(annotation.id, next);
    }
  };

  return (
    <div className={`annotation annotation--${annotation.kind}${selected ? ' is-selected' : ''}`}>
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={40}
        minHeight={24}
        onResizeEnd={(_event, params) => {
          data.onResize(annotation.id, {
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
          });
        }}
      />
      <input
        className="annotation__label nodrag"
        aria-label={`${annotation.kind === 'boundary' ? 'Region' : 'Note'} label`}
        value={label}
        placeholder={annotation.kind === 'boundary' ? 'Region' : 'Note…'}
        maxLength={120}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          event.stopPropagation();
        }}
      />
      <button
        type="button"
        className="annotation__delete nodrag"
        aria-label={`Delete ${annotation.kind}`}
        onClick={() => data.onDelete(annotation.id)}
      >
        ×
      </button>
    </div>
  );
});
