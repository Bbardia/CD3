import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { OrthographicCamera } from 'three';
import type { Mesh } from 'three';
import type { ViewAnnotation, ViewItemMove } from '@cd3/domain';
import type { ProjectedView3D, ViewNode3D } from '@cd3/layout';

import { PALETTE_MIME } from '../editor/palette';
import { centerSnap, movesCollide, type SnapGuide } from '../editor/placement';
import { SpatialModel } from './spatial-models';

export interface SpatialDiagramProps {
  readonly projection: ProjectedView3D;
  readonly selectedElementId: string | undefined;
  /** Every selected element, including the primary. Drives which blocks drag together. */
  readonly selectedElementIds: readonly string[];
  readonly onSelect: (elementId: string | undefined) => void;
  readonly onMoveItems: (moves: readonly ViewItemMove[]) => void;
  /** Palette drop, reported in 2D placement space so the caller stays renderer-neutral. */
  readonly onDropPaletteEntry: (entryId: string, placement: { x: number; y: number }) => void;
  /** Connect tool: blocks stop dragging so a click reads as "pick an endpoint" and nothing else. */
  readonly connecting: boolean;
  /** Armed connect source, so the scene can draw a rubber band from it to the pointer. */
  readonly pendingSourceElementId: string | undefined;
  /** Double-click on open ground: where the pointer is on screen, and in placement space. */
  readonly onRequestAddAt: (request: {
    clientX: number;
    clientY: number;
    placement: { x: number; y: number };
  }) => void;
  /** Bumped when the caller adds something off-screen and wants the camera to show it. */
  readonly revealSignal: number;
  /** Double-click on a block: drill into the view scoped to that element, when one exists. */
  readonly onDrillDown: (elementId: string) => void;
  /** False while an image export captures the canvas: the grid is chrome, not content. */
  readonly showGrid: boolean;
  /** Presentation decorations for this view, projected flat onto the ground plane. */
  readonly annotations: Readonly<Record<string, ViewAnnotation>>;
}

/** Ground-plane offset applied to a block while a drag is in flight, in world units. */
type GroundOffset = readonly [number, number];

type WorldPoint = [number, number, number];

const NO_OFFSET: GroundOffset = [0, 0];
/** Ink, not the primary blue: software systems are already blue. */
const SELECTION_COLOR = '#182126';
/** World units a flow pulse travels per second. */
const FLOW_SPEED = 3;

/**
 * Closed rectangle framing the top face of a block, used to outline the selected element. It rides
 * above the cap rather than around the base, where the block's own volume would occlude it.
 */
function footprint(center: WorldPoint, size: ViewNode3D['size']): WorldPoint[] {
  const x = size[0] / 2 + 0.1;
  const z = size[2] / 2 + 0.1;
  const y = center[1] + size[1] / 2 + 0.09;
  return [
    [center[0] - x, y, center[2] - z],
    [center[0] + x, y, center[2] - z],
    [center[0] + x, y, center[2] + z],
    [center[0] - x, y, center[2] + z],
    [center[0] - x, y, center[2] - z],
  ];
}

/**
 * R3F replaces `target` with an object-level pointer capture API so a drag keeps receiving events
 * once the ray leaves the block, but its types still describe the DOM target it shadows.
 */
function captureTarget(event: ThreeEvent<PointerEvent>): {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
} {
  return event.target as unknown as {
    setPointerCapture: (pointerId: number) => void;
    releasePointerCapture: (pointerId: number) => void;
  };
}

/**
 * Turns a finished ground-plane drag into 2D move commands: placement stays authoritative, so the
 * world offset is converted back through the projection scale.
 */
export function movesFromDrag(
  nodes: ProjectedView3D['nodes'],
  draggedItemIds: readonly string[],
  offset: GroundOffset,
  coordinateScale: number,
): readonly ViewItemMove[] {
  const dragged = new Set(draggedItemIds);
  return nodes
    .filter((node) => dragged.has(node.viewItemId))
    .map((node) => ({
      itemId: node.viewItemId,
      x: Math.round(node.placement2D.x + offset[0] / coordinateScale),
      y: Math.round(node.placement2D.y + offset[1] / coordinateScale),
    }));
}

/** Where a pointer ray crosses the horizontal plane at `y`, or null when it runs parallel to it. */
export function groundPoint(ray: ThreeEvent<PointerEvent>['ray'], y: number): GroundOffset | null {
  if (Math.abs(ray.direction.y) < 1e-6) {
    return null;
  }
  const distance = (y - ray.origin.y) / ray.direction.y;
  return [ray.origin.x + ray.direction.x * distance, ray.origin.z + ray.direction.z * distance];
}

declare global {
  interface Window {
    __CD3_RENDER_FRAMES__?: number;
  }
}

// The tile carries the C4 kind, the prop carries the technology. A muted cap keeps the two
// readable at once instead of a saturated slab fighting the object standing on it.
const kindCapColor = {
  component: '#978cc6',
  container: '#57a39c',
  person: '#c18d5c',
  softwareSystem: '#6f8fd6',
} as const;

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context === null) {
      return false;
    }
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function WebGLFallback() {
  return (
    <section className="webgl-fallback" aria-label="3D unavailable">
      <div>
        <span className="panel-eyebrow">3D projection unavailable</span>
        <h2>Continue in 2D</h2>
        <p>
          This browser could not create a stable WebGL scene. The canonical model, explorer,
          inspector, and 2D view remain available.
        </p>
      </div>
    </section>
  );
}

export class SpatialErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError(_error: unknown): { readonly failed: boolean } {
    return { failed: true };
  }

  public override render(): ReactNode {
    return this.state.failed ? <WebGLFallback /> : this.props.children;
  }
}

function FrameProbe() {
  useFrame(() => {
    if (import.meta.env.DEV) {
      window.__CD3_RENDER_FRAMES__ = (window.__CD3_RENDER_FRAMES__ ?? 0) + 1;
    }
  });
  return null;
}

interface FlowLine {
  readonly id: string;
  readonly points: WorldPoint[];
  readonly color: string;
  readonly dashed: boolean;
  readonly emphasized: boolean;
  readonly head: WorldPoint;
}

/** Point `distance` world units along a polyline, clamped to its end. */
export function pointAlong(points: readonly WorldPoint[], distance: number): WorldPoint {
  let remaining = distance;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] as WorldPoint;
    const to = points[index + 1] as WorldPoint;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (remaining <= length || index === points.length - 2) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      return [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
        from[2] + (to[2] - from[2]) * ratio,
      ];
    }
    remaining -= length;
  }
  return points[0] ?? [0, 0, 0];
}

export function polylineLength(points: readonly WorldPoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index] as WorldPoint;
    const to = points[index + 1] as WorldPoint;
    total += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  }
  return total;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Dots travelling source to target, so the direction of every relationship is readable at a glance. */
function FlowPulses({ lines }: { readonly lines: readonly FlowLine[] }) {
  const { invalidate } = useThree();
  const pulses = useRef<(Mesh | null)[]>([]);

  // A hidden tab must not spin the GPU: the frame loop stops with the last invalidate and one
  // fresh invalidate restarts it when the tab returns.
  useEffect(() => {
    const restart = () => {
      if (!document.hidden) {
        invalidate();
      }
    };
    document.addEventListener('visibilitychange', restart);
    return () => document.removeEventListener('visibilitychange', restart);
  }, [invalidate]);

  useFrame((state) => {
    if (document.hidden) {
      return;
    }
    const elapsed = state.clock.elapsedTime;
    lines.forEach((line, index) => {
      const pulse = pulses.current[index];
      if (pulse === null || pulse === undefined) {
        return;
      }
      const length = polylineLength(line.points);
      // A constant speed plus a per-edge phase keeps long hops slower and stops the lockstep look.
      const travelled = length === 0 ? 0 : (elapsed * FLOW_SPEED + index * 1.7) % length;
      const [x, y, z] = pointAlong(line.points, travelled);
      pulse.position.set(x, y, z);
    });
    // The canvas renders on demand, so an in-flight animation has to keep asking for frames.
    invalidate();
  });

  return (
    <>
      {lines.map((line, index) => (
        <mesh
          key={line.id}
          ref={(mesh) => {
            pulses.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[0.1, 12, 12]} />
          <meshBasicMaterial color={line.color} />
        </mesh>
      ))}
    </>
  );
}

/** Turns an HTML drag and drop onto the canvas into a point on the ground plane. */
function PaletteDropTarget({
  coordinateScale,
  onDrop,
}: {
  readonly coordinateScale: number;
  readonly onDrop: SpatialDiagramProps['onDropPaletteEntry'];
}) {
  const { camera, gl, raycaster } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const carriesEntry = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes(PALETTE_MIME) ?? false;
    const allow = (event: DragEvent) => {
      if (carriesEntry(event) && event.dataTransfer !== null) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const drop = (event: DragEvent) => {
      const entryId = event.dataTransfer?.getData(PALETTE_MIME);
      if (entryId === undefined || entryId === '') {
        return;
      }
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        {
          x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        } as never,
        camera,
      );
      const point = groundPoint(raycaster.ray, 0);
      if (point !== null) {
        onDrop(entryId, { x: point[0] / coordinateScale, y: point[1] / coordinateScale });
      }
    };

    canvas.addEventListener('dragover', allow);
    canvas.addEventListener('drop', drop);
    return () => {
      canvas.removeEventListener('dragover', allow);
      canvas.removeEventListener('drop', drop);
    };
  }, [camera, coordinateScale, gl, onDrop, raycaster]);

  return null;
}

/** Dashed preview from the armed connect source to wherever the pointer hovers the ground. */
function PendingConnectLine({ from }: { readonly from: WorldPoint }) {
  const { camera, gl, invalidate, raycaster } = useThree();
  const [target, setTarget] = useState<WorldPoint | undefined>(undefined);

  useEffect(() => {
    const canvas = gl.domElement;
    const track = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        {
          x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        } as never,
        camera,
      );
      const point = groundPoint(raycaster.ray, from[1]);
      if (point !== null) {
        setTarget([point[0], from[1], point[1]]);
        invalidate();
      }
    };
    const clear = () => {
      setTarget(undefined);
      invalidate();
    };
    canvas.addEventListener('pointermove', track);
    canvas.addEventListener('pointerleave', clear);
    return () => {
      canvas.removeEventListener('pointermove', track);
      canvas.removeEventListener('pointerleave', clear);
    };
  }, [camera, from, gl, invalidate, raycaster]);

  if (target === undefined) {
    return null;
  }
  return (
    <Line
      points={[from, target]}
      color="#2c5cc5"
      lineWidth={2}
      dashed
      dashSize={0.22}
      gapSize={0.14}
      transparent
      opacity={0.8}
    />
  );
}

function centerOf(node: ViewNode3D): [number, number, number] {
  return [
    node.position[0] + node.size[0] / 2,
    node.position[1] + node.size[1] / 2,
    node.position[2] + node.size[2] / 2,
  ];
}

function CameraRig({
  nodes,
  viewId,
  revealSignal,
}: {
  readonly nodes: ProjectedView3D['nodes'];
  readonly viewId: string;
  readonly revealSignal: number;
}) {
  const { camera, invalidate, size } = useThree();
  // The default controls, once OrbitControls mounts; typed structurally to stay renderer-neutral.
  const controls = useThree((state) => state.controls) as {
    target: { set: (x: number, y: number, z: number) => void };
    update: () => void;
  } | null;
  // Framing is per view, not per placement: an edit must not throw away the camera the user set.
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;

  useLayoutEffect(() => {
    const nodes = latestNodes.current;
    if (!(camera instanceof OrthographicCamera) || nodes.length === 0) {
      return;
    }

    const minimumX = Math.min(...nodes.map((node) => node.position[0]));
    const maximumX = Math.max(...nodes.map((node) => node.position[0] + node.size[0]));
    const minimumZ = Math.min(...nodes.map((node) => node.position[2]));
    const maximumZ = Math.max(...nodes.map((node) => node.position[2] + node.size[2]));
    const spanX = Math.max(1, maximumX - minimumX);
    const spanZ = Math.max(1, maximumZ - minimumZ);
    const centerX = (minimumX + maximumX) / 2;
    const centerZ = (minimumZ + maximumZ) / 2;
    const distance = Math.max(spanX, spanZ) * 1.15;
    const projectedWidth = (spanX + spanZ) * 0.78;
    const projectedHeight = (spanX + spanZ) * 0.44 + 5;

    camera.position.set(centerX + distance, distance, centerZ + distance);
    camera.lookAt(centerX, 0, centerZ);
    camera.zoom = Math.max(
      8,
      Math.min(50, size.width / (projectedWidth * 1.18), size.height / (projectedHeight * 1.18)),
    );
    camera.near = 0.1;
    camera.far = distance * 8 + 100;
    camera.updateProjectionMatrix();
    // The orbit pivot moves only when the view is framed, so a drop never re-aims the camera.
    if (controls !== null) {
      controls.target.set(centerX, 0, centerZ);
      controls.update();
    }
    invalidate();
  }, [camera, controls, invalidate, revealSignal, size.height, size.width, viewId]);

  return null;
}

function ArchitectureBlock({
  node,
  selected,
  offset,
  draggable,
  onSelect,
  onDrillDown,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  readonly node: ViewNode3D;
  readonly selected: boolean;
  readonly offset: GroundOffset;
  readonly draggable: boolean;
  readonly onSelect: (elementId: string) => void;
  readonly onDrillDown: (elementId: string) => void;
  readonly onDragStart: (node: ViewNode3D, point: GroundOffset) => void;
  readonly onDragMove: (point: GroundOffset) => void;
  readonly onDragEnd: () => void;
}) {
  const base = centerOf(node);
  const center: [number, number, number] = [base[0] + offset[0], base[1], base[2] + offset[1]];
  const external = node.tags.includes('external');
  // The drag plane sits at the block's own height so the block stays under the pointer.
  const pointerOn = (event: ThreeEvent<PointerEvent>) => groundPoint(event.ray, center[1]);

  return (
    // The whole block — body, cap, and the prop standing on it — is one click target, so the
    // handlers live on the group and hits on any child mesh bubble up to them.
    <group
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.elementId);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDrillDown(node.elementId);
      }}
      onPointerDown={(event) => {
        const point = pointerOn(event);
        if (point === null || !draggable) {
          return;
        }
        event.stopPropagation();
        captureTarget(event).setPointerCapture(event.pointerId);
        onDragStart(node, point);
      }}
      onPointerMove={(event) => {
        const point = pointerOn(event);
        if (point !== null) {
          onDragMove(point);
        }
      }}
      onPointerUp={(event) => {
        captureTarget(event).releasePointerCapture(event.pointerId);
        onDragEnd();
      }}
    >
      <RoundedBox
        args={[node.size[0], node.size[1], node.size[2]]}
        position={center}
        radius={Math.min(0.14, node.size[1] * 0.18)}
        smoothness={3}
      >
        <meshStandardMaterial
          color={external ? '#edf0ef' : '#f9fbfa'}
          roughness={0.82}
          metalness={0.02}
        />
      </RoundedBox>
      <mesh position={[center[0], center[1] + node.size[1] / 2 + 0.025, center[2]]}>
        <boxGeometry args={[node.size[0] * 0.96, 0.045, node.size[2] * 0.92]} />
        <meshStandardMaterial
          color={node.color ?? kindCapColor[node.kind]}
          roughness={0.85}
          metalness={0}
        />
      </mesh>
      {/* Selection is an outline, never a fill: kind colour has to survive, and the primary blue
          is also the software-system colour. */}
      {selected ? (
        <Line
          points={footprint(center, node.size)}
          color={SELECTION_COLOR}
          lineWidth={2.4}
          transparent
          opacity={0.9}
        />
      ) : null}
      <SpatialModel
        node={node}
        position={[center[0], center[1] + node.size[1] / 2 + 0.05, center[2] - node.size[2] * 0.16]}
      />
      {/* Screen-space labels: drei multiplies `distanceFactor` by `camera.zoom` under an
          orthographic camera, so any zoom or orbit inflated these to full-screen text. */}
      <Html
        position={[center[0], center[1] - node.size[1] / 2, center[2] + node.size[2] / 2 + 0.95]}
        center
        className="spatial-label-anchor"
        style={{ pointerEvents: 'none' }}
      >
        <div className={`spatial-label${selected ? ' is-selected' : ''}`}>
          <span>{node.kind === 'softwareSystem' ? 'System' : node.kind}</span>
          <strong>{node.label ?? node.name}</strong>
          {external ? <em>External</em> : null}
        </div>
      </Html>
    </group>
  );
}

function SpatialScene({
  projection,
  selectedElementId,
  selectedElementIds,
  onSelect,
  onMoveItems,
  onDropPaletteEntry,
  connecting,
  revealSignal,
  onRequestAddAt,
  pendingSourceElementId,
  onDrillDown,
  showGrid,
  annotations,
}: SpatialDiagramProps) {
  // Transient renderer state, exactly like the 2D drag preview: pointer movement writes here and
  // nowhere else, so no domain command, validation, or projection runs until the gesture ends.
  const [drag, setDrag] = useState<{
    readonly itemIds: readonly string[];
    /** The block the pointer grabbed: the one whose centre snaps; a group keeps its spacing. */
    readonly anchorItemId: string;
    readonly offset: GroundOffset;
    readonly guides: readonly SnapGuide[];
  } | null>(null);
  const dragOrigin = useRef<GroundOffset | null>(null);
  const [animateFlow] = useState(() => !prefersReducedMotion());

  const handleDragStart = useCallback(
    (node: ViewNode3D, point: GroundOffset) => {
      const together = selectedElementIds.includes(node.elementId)
        ? projection.nodes
            .filter((candidate) => selectedElementIds.includes(candidate.elementId))
            .map((candidate) => candidate.viewItemId)
        : [node.viewItemId];
      dragOrigin.current = point;
      setDrag({ itemIds: together, anchorItemId: node.viewItemId, offset: NO_OFFSET, guides: [] });
    },
    [projection.nodes, selectedElementIds],
  );

  const handleDragMove = useCallback(
    (point: GroundOffset) => {
      const origin = dragOrigin.current;
      if (origin === null) {
        return;
      }
      const scale = projection.policy.coordinateScale;
      setDrag((current) => {
        if (current === null) {
          return null;
        }
        const raw: GroundOffset = [point[0] - origin[0], point[1] - origin[1]];
        const anchor = projection.nodes.find(
          (node) => node.viewItemId === current.anchorItemId,
        )?.placement2D;
        if (anchor === undefined) {
          return { ...current, offset: raw, guides: [] };
        }
        const moving = new Set(current.itemIds);
        // Snapping runs in shared placement space, exactly like the 2D canvas.
        const snap = centerSnap(
          { ...anchor, x: anchor.x + raw[0] / scale, y: anchor.y + raw[1] / scale },
          projection.nodes
            .filter((node) => !moving.has(node.viewItemId))
            .map((node) => node.placement2D),
        );
        return {
          ...current,
          offset: [raw[0] + snap.dx * scale, raw[1] + snap.dy * scale],
          guides: snap.guides,
        };
      });
    },
    [projection.nodes, projection.policy.coordinateScale],
  );

  const placedItems = useMemo(
    () =>
      projection.nodes.map((node) => ({ itemId: node.viewItemId, rect: { ...node.placement2D } })),
    [projection.nodes],
  );

  const handleDragEnd = useCallback(() => {
    dragOrigin.current = null;
    setDrag((current) => {
      if (current === null) {
        return null;
      }
      if (current.offset[0] !== 0 || current.offset[1] !== 0) {
        const moves = movesFromDrag(
          projection.nodes,
          current.itemIds,
          current.offset,
          projection.policy.coordinateScale,
        );
        // Same rule as the 2D canvas: a block may not come to rest on top of another one.
        if (!movesCollide(moves, placedItems)) {
          onMoveItems(moves);
        }
      }
      return null;
    });
  }, [onMoveItems, placedItems, projection.nodes, projection.policy.coordinateScale]);

  const offsetFor = useCallback(
    (viewItemId: string): GroundOffset =>
      drag !== null && drag.itemIds.includes(viewItemId) ? drag.offset : NO_OFFSET,
    [drag],
  );

  // Anchors the ground grid and double-click plane under the content; the camera no longer
  // follows it, so an edit never re-aims the view. Rounded to whole cells: the grid pattern
  // repeats every unit, so whole-cell moves are invisible while fractional ones would slide.
  const center = useMemo<[number, number, number]>(() => {
    if (projection.nodes.length === 0) {
      return [0, 0, 0];
    }
    const centers = projection.nodes.map(centerOf);
    return [
      Math.round(centers.reduce((sum, position) => sum + position[0], 0) / centers.length),
      0,
      Math.round(centers.reduce((sum, position) => sum + position[2], 0) / centers.length),
    ];
  }, [projection.nodes]);

  const flowLines = useMemo<FlowLine[]>(
    () =>
      projection.edges.map((edge) => {
        const emphasized =
          edge.sourceElementId === selectedElementId ||
          edge.targetElementId === selectedElementId ||
          edge.visibleSourceElementId === selectedElementId ||
          edge.visibleTargetElementId === selectedElementId;
        // Only the endpoints follow a drag; any intermediate waypoints stay where they are.
        const sourceOffset = offsetFor(edge.source);
        const targetOffset = offsetFor(edge.target);
        return {
          id: edge.relationshipId,
          emphasized,
          color: emphasized ? '#2c5cc5' : '#69787e',
          dashed: edge.interaction === 'asynchronous',
          points: edge.path.map((point, index): WorldPoint => {
            const offset =
              index === 0
                ? sourceOffset
                : index === edge.path.length - 1
                  ? targetOffset
                  : NO_OFFSET;
            return [point[0] + offset[0], point[1] + 0.35, point[2] + offset[1]];
          }),
          head: [
            edge.targetPosition[0] + targetOffset[0],
            edge.targetPosition[1] + 0.35,
            edge.targetPosition[2] + targetOffset[1],
          ],
        };
      }),
    [offsetFor, projection.edges, selectedElementId],
  );

  // One world unit is 50 units of 2D placement space, so unit cells stay legible at any span.
  const groundSize = useMemo(() => {
    if (projection.nodes.length === 0) {
      return 20;
    }
    const spanX =
      Math.max(...projection.nodes.map((node) => node.position[0] + node.size[0])) -
      Math.min(...projection.nodes.map((node) => node.position[0]));
    const spanZ =
      Math.max(...projection.nodes.map((node) => node.position[2] + node.size[2])) -
      Math.min(...projection.nodes.map((node) => node.position[2]));
    // Kept even so the 1-unit grid lines stay on the same world lattice as the size grows.
    return Math.ceil((Math.max(spanX, spanZ) * 1.6 + 4) / 2) * 2;
  }, [projection.nodes]);

  return (
    <>
      <color attach="background" args={['#f5f7f5']} />
      {Object.values(annotations).map((annotation) => {
        const scale = projection.policy.coordinateScale;
        const w = annotation.width * scale;
        const d = annotation.height * scale;
        const cx = (annotation.x + annotation.width / 2) * scale;
        const cz = (annotation.y + annotation.height / 2) * scale;
        if (annotation.kind === 'note') {
          return (
            <Html
              key={annotation.id}
              position={[cx, 0.02, cz]}
              center
              className="spatial-label-anchor"
              style={{ pointerEvents: 'none' }}
            >
              <div className="spatial-note">{annotation.label ?? 'Note'}</div>
            </Html>
          );
        }
        const color = annotation.color ?? '#8ba5bf';
        return (
          <group key={annotation.id}>
            <mesh position={[cx, -0.03, cz]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[w, d]} />
              <meshBasicMaterial color={color} transparent opacity={0.14} depthWrite={false} />
            </mesh>
            <Line
              points={[
                [cx - w / 2, 0.01, cz - d / 2],
                [cx + w / 2, 0.01, cz - d / 2],
                [cx + w / 2, 0.01, cz + d / 2],
                [cx - w / 2, 0.01, cz + d / 2],
                [cx - w / 2, 0.01, cz - d / 2],
              ]}
              color={color}
              lineWidth={1.4}
              dashed
              dashSize={0.3}
              gapSize={0.18}
            />
            {annotation.label === undefined ? null : (
              <Html
                position={[cx - w / 2 + 0.3, 0.02, cz - d / 2 + 0.3]}
                className="spatial-label-anchor"
                style={{ pointerEvents: 'none' }}
              >
                <div className="spatial-region-label">{annotation.label}</div>
              </Html>
            )}
          </group>
        );
      })}
      {showGrid ? (
        <gridHelper
          args={[groundSize, groundSize, '#c8d3cd', '#dde4e0']}
          position={[center[0], -0.01, center[2]]}
        />
      ) : null}
      {drag?.guides.map((guide) => {
        const scale = projection.policy.coordinateScale;
        // Placement x maps to world x and placement y to world z, just above the ground plane.
        const points: [number, number, number][] =
          guide.axis === 'x'
            ? [
                [guide.position * scale, 0.07, guide.start * scale],
                [guide.position * scale, 0.07, guide.end * scale],
              ]
            : [
                [guide.start * scale, 0.07, guide.position * scale],
                [guide.end * scale, 0.07, guide.position * scale],
              ];
        return (
          <Line
            key={guide.axis}
            points={points}
            color="#d13438"
            lineWidth={1.6}
            dashed
            dashSize={0.28}
            gapSize={0.16}
          />
        );
      })}
      <hemisphereLight args={['#ffffff', '#dce3df', 1.65]} />
      <directionalLight position={[-18, 28, 20]} intensity={2.1} />
      <directionalLight position={[18, 12, -16]} intensity={0.55} />
      <FrameProbe />
      <CameraRig nodes={projection.nodes} viewId={projection.viewId} revealSignal={revealSignal} />
      <PaletteDropTarget
        coordinateScale={projection.policy.coordinateScale}
        onDrop={onDropPaletteEntry}
      />
      {/* Double-click on open ground asks for the add menu; blocks stop the event, so a
          double-click on one never opens it. The plane is invisible but still raycastable. */}
      <mesh
        position={[center[0], -0.02, center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onRequestAddAt({
            clientX: event.clientX,
            clientY: event.clientY,
            placement: {
              x: event.point.x / projection.policy.coordinateScale,
              y: event.point.z / projection.policy.coordinateScale,
            },
          });
        }}
      >
        <planeGeometry args={[groundSize * 3, groundSize * 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group>
        {projection.platforms.map((platform) => (
          <mesh
            key={platform.id}
            position={[
              platform.position[0] + platform.size[0] / 2 + offsetFor(platform.viewItemId)[0],
              platform.position[1] + platform.size[1] / 2,
              platform.position[2] + platform.size[2] / 2 + offsetFor(platform.viewItemId)[1],
            ]}
          >
            <boxGeometry args={[...platform.size]} />
            <meshStandardMaterial color="#dfe7e3" roughness={0.9} metalness={0} />
          </mesh>
        ))}
        {flowLines.map((line) => (
          <group key={line.id}>
            <Line
              points={line.points}
              color={line.color}
              lineWidth={line.emphasized ? 2.5 : 1.35}
              dashed={line.dashed}
              dashSize={0.25}
              gapSize={0.16}
            />
            <mesh position={line.head}>
              <sphereGeometry args={[line.emphasized ? 0.11 : 0.075, 12, 12]} />
              <meshBasicMaterial color={line.color} />
            </mesh>
          </group>
        ))}
        {animateFlow ? <FlowPulses lines={flowLines} /> : null}
        {(() => {
          if (!connecting || pendingSourceElementId === undefined) {
            return null;
          }
          const source = projection.nodes.find((node) => node.elementId === pendingSourceElementId);
          if (source === undefined) {
            return null;
          }
          const center = centerOf(source);
          return (
            <PendingConnectLine
              from={[center[0], center[1] + source.size[1] / 2 + 0.3, center[2]]}
            />
          );
        })()}
        {projection.nodes.map((node) => (
          <ArchitectureBlock
            key={node.viewItemId}
            node={node}
            selected={node.elementId === selectedElementId}
            offset={offsetFor(node.viewItemId)}
            draggable={!connecting}
            onSelect={onSelect}
            onDrillDown={onDrillDown}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />
        ))}
      </group>
      <OrbitControls
        makeDefault
        enabled={drag === null}
        enableDamping
        dampingFactor={0.12}
        minPolarAngle={0.45}
        maxPolarAngle={Math.PI / 2.15}
        minZoom={12}
        maxZoom={120}
      />
    </>
  );
}

export function SpatialDiagram(props: SpatialDiagramProps) {
  const [webGLAvailable] = useState(supportsWebGL);

  if (!webGLAvailable) {
    return <WebGLFallback />;
  }

  return (
    <SpatialErrorBoundary>
      <section
        className="diagram-surface spatial-surface"
        aria-label={`${props.projection.name} 3D diagram`}
      >
        <Canvas
          orthographic
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [24, 24, 24], zoom: 42, near: 0.1, far: 1000 }}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            // The PNG export snapshots the DOM, which reads the canvas after the frame completes.
            preserveDrawingBuffer: true,
          }}
          onPointerMissed={() => props.onSelect(undefined)}
        >
          <SpatialScene {...props} />
        </Canvas>
      </section>
    </SpatialErrorBoundary>
  );
}
