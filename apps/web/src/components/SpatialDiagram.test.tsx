import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { canvasMock } = vi.hoisted(() => ({ canvasMock: vi.fn() }));

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: unknown) => canvasMock(props),
  useFrame: () => undefined,
  useThree: () => ({}),
}));
vi.mock('@react-three/drei', () => ({
  Html: () => null,
  Line: () => null,
  OrbitControls: () => null,
  RoundedBox: () => null,
}));
vi.mock('three', () => ({ OrthographicCamera: class OrthographicCamera {} }));

import {
  groundPoint,
  movesFromDrag,
  pointAlong,
  polylineLength,
  SpatialDiagram,
  SpatialErrorBoundary,
} from './SpatialDiagram';
import { getWorkspaceProjection3D, project } from '../workspace';

describe('flow pulse geometry', () => {
  const elbow: [number, number, number][] = [
    [0, 0, 0],
    [3, 0, 0],
    [3, 0, 4],
  ];

  it('measures a polyline and walks it across segment boundaries', () => {
    expect(polylineLength(elbow)).toBe(7);
    expect(pointAlong(elbow, 0)).toEqual([0, 0, 0]);
    expect(pointAlong(elbow, 1.5)).toEqual([1.5, 0, 0]);
    expect(pointAlong(elbow, 5)).toEqual([3, 0, 2]);
  });

  it('clamps past the end instead of overshooting the target', () => {
    expect(pointAlong(elbow, 99)).toEqual([3, 0, 4]);
    expect(polylineLength([[1, 2, 3]])).toBe(0);
  });
});

describe('spatial drag geometry', () => {
  it('reads the pointer ray against the ground plane and ignores rays parallel to it', () => {
    const ray = { origin: { x: 10, y: 8, z: 4 }, direction: { x: 0, y: -1, z: 1 } };

    expect(groundPoint(ray as never, 0)).toEqual([10, 12]);
    expect(groundPoint({ ...ray, direction: { x: 1, y: 0, z: 0 } } as never, 0)).toBeNull();
  });

  it('commits a world-space drag as whole-pixel 2D moves for every dragged item', () => {
    const projection = getWorkspaceProjection3D(project, 'core-containers');
    const orders = projection.nodes.find((node) => node.elementId === 'order-service');
    const catalog = projection.nodes.find((node) => node.elementId === 'catalog-service');

    // 0.02 world units per placement pixel, so a 2-unit drag is 100 placement pixels.
    expect(
      movesFromDrag(
        projection.nodes,
        [orders?.viewItemId ?? '', catalog?.viewItemId ?? ''],
        [2, -1],
        projection.policy.coordinateScale,
      ),
    ).toEqual([
      { itemId: catalog?.viewItemId, x: 1080, y: -10 },
      { itemId: orders?.viewItemId, x: 1080, y: 205 },
    ]);
  });
});

describe('SpatialDiagram fallback', () => {
  beforeEach(() => canvasMock.mockReset().mockReturnValue(null));
  afterEach(() => vi.restoreAllMocks());

  it('keeps the workspace usable when WebGL is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    render(
      <SpatialDiagram
        projection={getWorkspaceProjection3D(project, 'core-containers')}
        selectedElementId={undefined}
        selectedElementIds={[]}
        onSelect={() => undefined}
        onMoveItems={() => undefined}
        onDropPaletteEntry={() => undefined}
        connecting={false}
        revealSignal={0}
      />,
    );

    expect(screen.getByRole('region', { name: '3D unavailable' })).toHaveTextContent(
      'Continue in 2D',
    );
  });

  it('releases and caches its capability probe across rerenders', () => {
    const loseContext = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext }),
    } as unknown as WebGLRenderingContext);
    const projection = getWorkspaceProjection3D(project, 'core-containers');

    const { rerender } = render(
      <SpatialDiagram
        projection={projection}
        selectedElementId={undefined}
        selectedElementIds={[]}
        onSelect={() => undefined}
        onMoveItems={() => undefined}
        onDropPaletteEntry={() => undefined}
        connecting={false}
        revealSignal={0}
      />,
    );
    rerender(
      <SpatialDiagram
        projection={projection}
        selectedElementId="order-service"
        selectedElementIds={['order-service']}
        onSelect={() => undefined}
        onMoveItems={() => undefined}
        onDropPaletteEntry={() => undefined}
        connecting={false}
        revealSignal={0}
      />,
    );

    expect(getContext).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('renders the fallback after a descendant renderer initialization error', () => {
    const boundary = new SpatialErrorBoundary({ children: null });
    boundary.state = SpatialErrorBoundary.getDerivedStateFromError(
      new Error('WebGL renderer initialization failed'),
    );

    render(<>{boundary.render()}</>);

    expect(screen.getByRole('region', { name: '3D unavailable' })).toHaveTextContent(
      'Continue in 2D',
    );
  });
});
