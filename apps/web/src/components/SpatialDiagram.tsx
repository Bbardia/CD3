import { Component, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { OrthographicCamera } from 'three';
import type { ProjectedView3D, ViewNode3D } from '@cd3/layout';

export interface SpatialDiagramProps {
  readonly projection: ProjectedView3D;
  readonly selectedElementId: string | undefined;
  readonly onSelect: (elementId: string | undefined) => void;
}

declare global {
  interface Window {
    __CD3_RENDER_FRAMES__?: number;
  }
}

const kindColor = {
  component: '#6b5aad',
  container: '#0f7c72',
  person: '#a65c16',
  softwareSystem: '#315fc4',
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

function centerOf(node: ViewNode3D): [number, number, number] {
  return [
    node.position[0] + node.size[0] / 2,
    node.position[1] + node.size[1] / 2,
    node.position[2] + node.size[2] / 2,
  ];
}

function CameraRig({ nodes }: { readonly nodes: ProjectedView3D['nodes'] }) {
  const { camera, invalidate, size } = useThree();

  useLayoutEffect(() => {
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
    invalidate();
  }, [camera, invalidate, nodes, size.height, size.width]);

  return null;
}

function ArchitectureBlock({
  node,
  selected,
  onSelect,
}: {
  readonly node: ViewNode3D;
  readonly selected: boolean;
  readonly onSelect: (elementId: string) => void;
}) {
  const center = centerOf(node);
  const color = kindColor[node.kind];
  const external = node.tags.includes('external');

  return (
    <group>
      <RoundedBox
        args={[node.size[0], node.size[1], node.size[2]]}
        position={center}
        radius={Math.min(0.14, node.size[1] * 0.18)}
        smoothness={3}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.elementId);
        }}
      >
        <meshStandardMaterial
          color={selected ? '#e8efff' : external ? '#edf0ef' : '#f9fbfa'}
          roughness={0.82}
          metalness={0.02}
        />
      </RoundedBox>
      <mesh position={[center[0], center[1] + node.size[1] / 2 + 0.025, center[2]]}>
        <boxGeometry args={[node.size[0] * 0.96, 0.045, node.size[2] * 0.92]} />
        <meshStandardMaterial color={selected ? '#2c5cc5' : color} roughness={0.8} />
      </mesh>
      {selected ? (
        <mesh position={center} scale={1.045}>
          <boxGeometry args={[node.size[0], node.size[1], node.size[2]]} />
          <meshBasicMaterial color="#2c5cc5" wireframe transparent opacity={0.85} />
        </mesh>
      ) : null}
      <Html
        position={[center[0], center[1] + node.size[1] / 2 + 0.18, center[2]]}
        center
        distanceFactor={12}
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

function SpatialScene({ projection, selectedElementId, onSelect }: SpatialDiagramProps) {
  const center = useMemo<[number, number, number]>(() => {
    if (projection.nodes.length === 0) {
      return [0, 0, 0];
    }
    const centers = projection.nodes.map(centerOf);
    return [
      centers.reduce((sum, position) => sum + position[0], 0) / centers.length,
      0,
      centers.reduce((sum, position) => sum + position[2], 0) / centers.length,
    ];
  }, [projection.nodes]);

  return (
    <>
      <color attach="background" args={['#f5f7f5']} />
      <hemisphereLight args={['#ffffff', '#dce3df', 1.65]} />
      <directionalLight position={[-18, 28, 20]} intensity={2.1} />
      <directionalLight position={[18, 12, -16]} intensity={0.55} />
      <FrameProbe />
      <CameraRig nodes={projection.nodes} />
      <group>
        {projection.platforms.map((platform) => (
          <mesh
            key={platform.id}
            position={[
              platform.position[0] + platform.size[0] / 2,
              platform.position[1] + platform.size[1] / 2,
              platform.position[2] + platform.size[2] / 2,
            ]}
          >
            <boxGeometry args={[...platform.size]} />
            <meshStandardMaterial color="#dfe7e3" roughness={0.9} metalness={0} />
          </mesh>
        ))}
        {projection.edges.map((edge) => {
          const selected =
            edge.sourceElementId === selectedElementId ||
            edge.targetElementId === selectedElementId ||
            edge.visibleSourceElementId === selectedElementId ||
            edge.visibleTargetElementId === selectedElementId;
          return (
            <group key={edge.relationshipId}>
              <Line
                points={edge.path.map((point) => [point[0], point[1] + 0.35, point[2]])}
                color={selected ? '#2c5cc5' : '#69787e'}
                lineWidth={selected ? 2.5 : 1.35}
                dashed={edge.interaction === 'asynchronous'}
                dashSize={0.25}
                gapSize={0.16}
              />
              <mesh
                position={[
                  edge.targetPosition[0],
                  edge.targetPosition[1] + 0.35,
                  edge.targetPosition[2],
                ]}
              >
                <sphereGeometry args={[selected ? 0.11 : 0.075, 12, 12]} />
                <meshBasicMaterial color={selected ? '#2c5cc5' : '#69787e'} />
              </mesh>
            </group>
          );
        })}
        {projection.nodes.map((node) => (
          <ArchitectureBlock
            key={node.viewItemId}
            node={node}
            selected={node.elementId === selectedElementId}
            onSelect={onSelect}
          />
        ))}
      </group>
      <OrbitControls
        makeDefault
        target={center}
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
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onPointerMissed={() => props.onSelect(undefined)}
        >
          <SpatialScene {...props} />
        </Canvas>
        <div className="view-datum" aria-hidden="true">
          <span>orthographic</span>
          <span>{props.projection.nodes.length} elements</span>
          <span>{props.projection.edges.length} relationships</span>
        </div>
      </section>
    </SpatialErrorBoundary>
  );
}
