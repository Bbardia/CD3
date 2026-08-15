import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { workerProbeMock } = vi.hoisted(() => ({ workerProbeMock: vi.fn() }));

vi.mock('./components/Diagram2D', () => ({
  Diagram2D: ({ onSelect, projection, selectedElementId }: MockDiagram2DProps) => (
    <section aria-label="Mock 2D projection" data-testid="diagram-2d">
      <span data-testid="2d-view-id">{projection.viewId}</span>
      <span data-testid="2d-selection">{selectedElementId ?? 'none'}</span>
      <button type="button" onClick={() => onSelect('order-service')}>
        Select Order Service in 2D
      </button>
    </section>
  ),
}));

vi.mock('./components/SpatialDiagram', () => ({
  SpatialDiagram: ({ onSelect, projection, selectedElementId }: MockSpatialDiagramProps) => (
    <section aria-label="Mock 3D projection" data-testid="diagram-3d">
      <span data-testid="3d-view-id">{projection.viewId}</span>
      <span data-testid="3d-selection">{selectedElementId ?? 'none'}</span>
      <button type="button" onClick={() => onSelect('constellation-payments')}>
        Select Constellation Payments in 3D
      </button>
    </section>
  ),
}));

vi.mock('./workers/elk-worker-client', () => ({
  probeElkLayoutWorker: workerProbeMock,
}));

import { App } from './App';
import type { Diagram2D } from './components/Diagram2D';
import type { SpatialDiagram } from './components/SpatialDiagram';

type MockDiagram2DProps = ComponentProps<typeof Diagram2D>;
type MockSpatialDiagramProps = ComponentProps<typeof SpatialDiagram>;

describe('CD3 workspace shell', () => {
  beforeEach(() => {
    workerProbeMock.mockReset().mockResolvedValue(false);
  });

  it('renders an accessible read-only application shell and mode/view controls', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toHaveTextContent('CD3');
    expect(screen.getByRole('banner')).toHaveTextContent('Northstar Commerce');
    expect(screen.getByText('Sample fixture · read-only')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Model explorer' })).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('12 elements');

    expect(screen.getByRole('button', { name: '2D diagram view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '3D spatial view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('button', { name: /Northstar Commerce — System Context/ }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: /Northstar Commerce — Containers/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('shares selection by stable semantic ID across explorer, 2D, 3D, and inspector', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));

    expect(screen.getByTestId('2d-selection')).toHaveTextContent('order-service');
    expect(screen.getByRole('treeitem', { name: 'Order Service, Container' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('heading', {
        name: 'Order Service',
      }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '3D spatial view' }));

    expect(await screen.findByTestId('3d-selection')).toHaveTextContent('order-service');
    expect(screen.getByRole('treeitem', { name: 'Order Service, Container' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('preserves semantic selection while switching compiled views and clears it with Escape', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('treeitem', { name: 'Constellation Payments, System' }));
    await user.click(screen.getByRole('button', { name: /Order Service — Components/ }));

    expect(screen.getByTestId('2d-view-id')).toHaveTextContent('order-components');
    expect(screen.getByTestId('2d-selection')).toHaveTextContent('constellation-payments');
    expect(
      screen.getByRole('treeitem', { name: 'Constellation Payments, System' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Constellation Payments' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('2d-selection')).toHaveTextContent('none');
    expect(
      screen.getByText('Select an element to inspect its architecture details.'),
    ).toBeVisible();
  });

  it('reports the layout worker as unavailable when its probe rejects', async () => {
    workerProbeMock.mockRejectedValueOnce(new Error('worker startup failed'));

    render(<App />);

    expect(await screen.findByText('Layout worker unavailable')).toBeVisible();
  });
});
