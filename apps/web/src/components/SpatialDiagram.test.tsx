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

import { SpatialDiagram, SpatialErrorBoundary } from './SpatialDiagram';
import { getWorkspaceProjection3D, project } from '../workspace';

describe('SpatialDiagram fallback', () => {
  beforeEach(() => canvasMock.mockReset().mockReturnValue(null));
  afterEach(() => vi.restoreAllMocks());

  it('keeps the workspace usable when WebGL is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    render(
      <SpatialDiagram
        projection={getWorkspaceProjection3D(project, 'core-containers')}
        selectedElementId={undefined}
        onSelect={() => undefined}
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
        onSelect={() => undefined}
      />,
    );
    rerender(
      <SpatialDiagram
        projection={projection}
        selectedElementId="order-service"
        onSelect={() => undefined}
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
