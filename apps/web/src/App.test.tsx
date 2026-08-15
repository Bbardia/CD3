import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceModule from './workspace';

const { projection3DMock, spatialDiagramModuleFactoryMock, workerProbeMock } = vi.hoisted(() => ({
  projection3DMock: vi.fn(),
  spatialDiagramModuleFactoryMock: vi.fn(),
  workerProbeMock: vi.fn(),
}));

vi.mock('./components/Diagram2D', () => ({
  Diagram2D: ({ onSelect, projection, selectedElementId }: MockDiagram2DProps) => {
    const orderService = projection.nodes.find((node) => node.elementId === 'order-service');
    return (
      <section aria-label="Mock 2D projection" data-testid="diagram-2d">
        <span data-testid="2d-view-id">{projection.viewId}</span>
        <span data-testid="2d-selection">{selectedElementId ?? 'none'}</span>
        <span data-testid="2d-order-service-position">
          {orderService === undefined ? 'absent' : `${orderService.x},${orderService.y}`}
        </span>
        <button type="button" onClick={() => onSelect('order-service')}>
          Select Order Service in 2D
        </button>
      </section>
    );
  },
}));

vi.mock('./components/SpatialDiagram', () => {
  spatialDiagramModuleFactoryMock();
  return {
    SpatialDiagram: ({ onSelect, projection, selectedElementId }: MockSpatialDiagramProps) => (
      <section aria-label="Mock 3D projection" data-testid="diagram-3d">
        <span data-testid="3d-view-id">{projection.viewId}</span>
        <span data-testid="3d-selection">{selectedElementId ?? 'none'}</span>
        <button type="button" onClick={() => onSelect('constellation-payments')}>
          Select Constellation Payments in 3D
        </button>
      </section>
    ),
  };
});

vi.mock('./workers/elk-worker-client', () => ({
  probeElkLayoutWorker: workerProbeMock,
}));

vi.mock('./workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  projection3DMock.mockImplementation(
    (
      activeProject: Parameters<typeof actual.getWorkspaceProjection3D>[0],
      viewId: Parameters<typeof actual.getWorkspaceProjection3D>[1],
    ) => actual.getWorkspaceProjection3D(activeProject, viewId),
  );
  return { ...actual, getWorkspaceProjection3D: projection3DMock };
});

import { App } from './App';
import type { Diagram2D } from './components/Diagram2D';
import type { SpatialDiagram } from './components/SpatialDiagram';
import { EditorStoreProvider, useEditorStore } from './editor/EditorStoreProvider';
import { project, workspaceViewIds } from './workspace';

type MockDiagram2DProps = ComponentProps<typeof Diagram2D>;
type MockSpatialDiagramProps = ComponentProps<typeof SpatialDiagram>;

function renderApp(children: ReactNode = <App />) {
  return render(
    <EditorStoreProvider initialProject={project} initialActiveViewId={workspaceViewIds[1]}>
      {children}
    </EditorStoreProvider>,
  );
}

function CommandHarness() {
  const execute = useEditorStore((state) => state.execute);
  return (
    <button
      type="button"
      onClick={() =>
        execute({
          type: 'move-view-items',
          viewId: 'core-containers',
          moves: [{ itemId: 'core-containers-item-orders', x: 1_234, y: 432 }],
        })
      }
    >
      Move Order Service through store
    </button>
  );
}

describe.sequential('CD3 workspace shell', () => {
  beforeEach(() => {
    workerProbeMock.mockReset().mockResolvedValue(false);
    projection3DMock.mockClear();
  });

  it('loads the SpatialDiagram module only after switching from 2D to 3D', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByTestId('diagram-2d')).toBeVisible();
    expect(spatialDiagramModuleFactoryMock).not.toHaveBeenCalled();
    expect(projection3DMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '3D spatial view' }));

    expect(await screen.findByTestId('diagram-3d')).toBeVisible();
    expect(spatialDiagramModuleFactoryMock).toHaveBeenCalledOnce();
    expect(projection3DMock).toHaveBeenCalledOnce();
    expect(projection3DMock).toHaveBeenCalledWith(project, 'core-containers');
  });

  it('renders an accessible read-only application shell and mode/view controls', () => {
    renderApp();

    expect(screen.getByRole('banner')).toHaveTextContent('CD3');
    expect(screen.getByRole('banner')).toHaveTextContent('Northstar Commerce');
    expect(screen.getByText('Sample fixture · local session')).toBeVisible();
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
    renderApp();

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
    renderApp();

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

    renderApp();

    expect(await screen.findByText('Layout worker unavailable')).toBeVisible();
  });

  it('renders a new project projection after a command executes through the editor store', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <App />
        <CommandHarness />
      </>,
    );

    expect(screen.getByTestId('2d-order-service-position')).toHaveTextContent('980,255');

    await user.click(screen.getByRole('button', { name: 'Move Order Service through store' }));

    expect(screen.getByTestId('2d-order-service-position')).toHaveTextContent('1234,432');
  });

  it('reports local edits only while the project differs from the loaded fixture', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <App />
        <CommandHarness />
      </>,
    );

    expect(screen.getByText('Sample fixture · local session')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Move Order Service through store' }));

    expect(screen.getByText('Local edits · not persisted')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /^Undo/ }));

    expect(screen.getByText('Sample fixture · local session')).toBeVisible();
  });

  it('keeps Escape from clearing selection while the user is typing', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <App />
        <input aria-label="Draft field" />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));
    const draftField = screen.getByRole('textbox', { name: 'Draft field' });
    await user.click(draftField);
    fireEvent.keyDown(draftField, { key: 'Escape' });

    expect(screen.getByTestId('2d-selection')).toHaveTextContent('order-service');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('2d-selection')).toHaveTextContent('none');
  });
});
