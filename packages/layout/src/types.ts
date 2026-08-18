import type {
  Element,
  ElementId,
  ExternalReference,
  JsonValue,
  Placement2D,
  ProjectId,
  Relationship,
  RelationshipId,
  ThreeDPolicy,
  View,
  ViewId,
  ViewItemId,
} from '@cd3/domain';

/** Recursively readonly form of canonical domain data carried by renderer DTOs. */
export type DeepReadonly<T> = T extends JsonValue[]
  ? readonly DeepReadonly<T[number]>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface CompiledViewItem {
  readonly viewItemId: ViewItemId;
  readonly elementId: ElementId;
  readonly kind: Element['kind'];
  readonly name: Element['name'];
  /** Optional view-specific label override from the canonical ViewItem. */
  readonly label?: string;
  readonly description?: Element['description'];
  readonly technology?: Element['technology'];
  /** Optional author-chosen accent, read from the element's `color` property. */
  readonly color?: string;
  /** Optional author-chosen prop key, read from the element's `icon` property. */
  readonly icon?: string;
  readonly tags: readonly string[];
  readonly placement: Readonly<Placement2D>;
  /** Direct semantic parent, whether or not that parent is visible. */
  readonly parentElementId?: ElementId;
  /** Direct semantic parent when represented by a visible item in this view. */
  readonly parentViewItemId?: ViewItemId;
  readonly semanticDepth: number;
  readonly renderKey: string;
}

export interface CompiledRelationship {
  /** ID of the canonical semantic relationship; projected edges never invent an ID. */
  readonly relationshipId: RelationshipId;
  readonly name: Relationship['name'];
  readonly description?: Relationship['description'];
  readonly interaction: Relationship['interaction'];
  readonly technology?: Relationship['technology'];
  readonly tags: readonly string[];
  readonly properties: DeepReadonly<Relationship['properties']>;
  readonly externalRefs: readonly DeepReadonly<ExternalReference>[];
  /** Original semantic endpoints, retained even when a visible ancestor is used. */
  readonly sourceElementId: ElementId;
  readonly targetElementId: ElementId;
  /** Renderer endpoints resolved to items that are present in this view. */
  readonly sourceViewItemId: ViewItemId;
  readonly targetViewItemId: ViewItemId;
  readonly visibleSourceElementId: ElementId;
  readonly visibleTargetElementId: ElementId;
  readonly sourceProjected: boolean;
  readonly targetProjected: boolean;
  readonly renderKey: string;
}

export interface RelationshipEndpointNotVisibleWarning {
  readonly code: 'relationship-endpoint-not-visible';
  readonly message: string;
  readonly relationshipId: RelationshipId;
  readonly endpoint: 'source' | 'target';
  readonly elementId: ElementId;
}

export interface ProjectedSelfLoopWarning {
  readonly code: 'projected-self-loop';
  readonly message: string;
  readonly relationshipId: RelationshipId;
  readonly sourceElementId: ElementId;
  readonly targetElementId: ElementId;
  readonly viewItemId: ViewItemId;
}

export interface RelationshipNotFoundWarning {
  readonly code: 'relationship-not-found';
  readonly message: string;
  readonly relationshipId: string;
}

export type CompileWarning =
  ProjectedSelfLoopWarning | RelationshipEndpointNotVisibleWarning | RelationshipNotFoundWarning;

export interface CompiledView {
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly type: View['type'];
  readonly scopeElementId: ElementId;
  readonly name: View['name'];
  readonly description?: View['description'];
  readonly items: readonly CompiledViewItem[];
  readonly relationships: readonly CompiledRelationship[];
  readonly warnings: readonly CompileWarning[];
}

export interface ViewNode2D extends CompiledViewItem {
  readonly id: ViewItemId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: Readonly<{ x: number; y: number }>;
}

export interface ViewEdge2D extends CompiledRelationship {
  readonly id: RelationshipId;
  readonly source: ViewItemId;
  readonly target: ViewItemId;
}

export interface ProjectedView2D {
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly type: View['type'];
  readonly scopeElementId: ElementId;
  readonly name: string;
  readonly description?: string;
  readonly nodes: readonly ViewNode2D[];
  readonly edges: readonly ViewEdge2D[];
  readonly warnings: readonly CompileWarning[];
}

export type Vector3Tuple = readonly [x: number, y: number, z: number];

export interface ViewNode3D extends Omit<CompiledViewItem, 'placement'> {
  readonly id: ViewItemId;
  readonly placement2D: Readonly<Placement2D>;
  /** World-space top-left/front anchor: canonical 2D x/y maps directly to x/z. */
  readonly position: Vector3Tuple;
  readonly size: Vector3Tuple;
}

export interface ViewPlatform3D {
  readonly id: string;
  readonly viewItemId: ViewItemId;
  readonly elementId: ElementId;
  readonly parentViewItemId?: ViewItemId;
  readonly semanticDepth: number;
  readonly position: Vector3Tuple;
  readonly size: Vector3Tuple;
}

export interface ViewEdge3D extends CompiledRelationship {
  readonly id: RelationshipId;
  readonly source: ViewItemId;
  readonly target: ViewItemId;
  readonly sourcePosition: Vector3Tuple;
  readonly targetPosition: Vector3Tuple;
  readonly path: readonly Vector3Tuple[];
}

export interface ProjectedView3D {
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly type: View['type'];
  readonly scopeElementId: ElementId;
  readonly name: string;
  readonly description?: string;
  readonly policy: Readonly<ThreeDPolicy>;
  readonly nodes: readonly ViewNode3D[];
  readonly edges: readonly ViewEdge3D[];
  readonly platforms: readonly ViewPlatform3D[];
  readonly warnings: readonly CompileWarning[];
}

export type LayoutInput = CompiledView | ProjectedView2D;

export interface LayoutPreviewOptions {
  /** Items restored to their authoritative input coordinates after layout. */
  readonly pinnedViewItemIds?: readonly string[];
  readonly direction?: 'DOWN' | 'LEFT' | 'RIGHT' | 'UP';
  readonly horizontalSpacing?: number;
  readonly verticalSpacing?: number;
}

export interface LayoutPreviewNode extends ViewNode2D {
  readonly pinned: boolean;
}

export interface LayoutPreviewWarning {
  readonly code: 'elk-failed' | 'pinned-post-layout' | 'fallback-layout';
  readonly message: string;
}

export interface LayoutPreview {
  readonly engine: 'deterministic-fallback' | 'elk';
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly nodes: readonly LayoutPreviewNode[];
  readonly edges: readonly ViewEdge2D[];
  readonly placements: Readonly<Record<string, Readonly<Placement2D>>>;
  readonly warnings: readonly LayoutPreviewWarning[];
}

/** Renderer-neutral async layout contract; implementations return previews only. */
export interface LayoutAdapter {
  layout(input: LayoutInput, options?: LayoutPreviewOptions): Promise<LayoutPreview>;
}
