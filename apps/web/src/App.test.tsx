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
  Diagram2D: ({
    onMoveItems,
    onSelect,
    projection,
    selectedElementId,
    selectedElementIds,
  }: MockDiagram2DProps) => {
    const orderService = projection.nodes.find((node) => node.elementId === 'order-service');
    return (
      <section aria-label="Mock 2D projection" data-testid="diagram-2d">
        <span data-testid="2d-view-id">{projection.viewId}</span>
        <span data-testid="2d-selection">{selectedElementId ?? 'none'}</span>
        <span data-testid="2d-selection-set">
          {selectedElementIds.length === 0 ? 'none' : selectedElementIds.join(',')}
        </span>
        <button type="button" onClick={() => onSelect('shopper', true)}>
          Add Shopper in 2D
        </button>
        <span data-testid="2d-order-service-position">
          {orderService === undefined ? 'absent' : `${orderService.x},${orderService.y}`}
        </span>
        <button type="button" onClick={() => onSelect('order-service')}>
          Select Order Service in 2D
        </button>
        <button
          type="button"
          onClick={() => onMoveItems([{ itemId: 'core-containers-item-orders', x: 512, y: 96 }])}
        >
          Drop Order Service in 2D
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
import { project, workspaceViewIdsOf } from './workspace';

type MockDiagram2DProps = ComponentProps<typeof Diagram2D>;
type MockSpatialDiagramProps = ComponentProps<typeof SpatialDiagram>;

function renderApp(children: ReactNode = <App />) {
  return render(
    <EditorStoreProvider
      initialProject={project}
      initialActiveViewId={workspaceViewIdsOf(project)[1] ?? ''}
    >
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

function SemanticProbe() {
  const element = useEditorStore((state) => state.history.project.elements['order-service']);
  const placement = useEditorStore(
    (state) =>
      state.history.project.views['core-containers']?.placements['core-containers-item-orders'],
  );
  return (
    <span data-testid="semantic-probe">
      {JSON.stringify({
        kind: element?.kind,
        parentId: element === undefined || !('parentId' in element) ? undefined : element.parentId,
        placement: placement === undefined ? undefined : { x: placement.x, y: placement.y },
      })}
    </span>
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

  it('renders an accessible application shell with mode, view, and history controls', () => {
    renderApp();

    expect(screen.getByRole('banner')).toHaveTextContent('CD3');
    expect(screen.getByRole('banner')).toHaveTextContent('Northstar Commerce');
    expect(screen.queryByLabelText('Save state')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Model explorer' })).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent(
      '12 elements',
    );

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
    expect(screen.getByRole('heading', { name: 'Nothing selected' })).toBeVisible();
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

  it('says nothing about saving until an edit needs saving', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <App />
        <CommandHarness />
      </>,
    );

    expect(screen.queryByLabelText('Save state')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move Order Service through store' }));

    expect(screen.getByLabelText('Save state')).toHaveTextContent('Saving');

    // Undo is another change to persist, so the indicator stays: the resting state is "no edits
    // since load", not "no edits at all".
    await user.click(screen.getByRole('button', { name: /^Undo/ }));

    expect(screen.getByLabelText('Save state')).toBeVisible();
  });

  it('turns one accepted drop into one undoable history entry', async () => {
    const user = userEvent.setup();
    renderApp();
    const originalPosition = screen.getByTestId('2d-order-service-position').textContent;

    await user.click(screen.getByRole('button', { name: 'Drop Order Service in 2D' }));

    expect(screen.getByTestId('2d-order-service-position')).toHaveTextContent('512,96');
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /^Undo/ }));

    expect(screen.getByTestId('2d-order-service-position')).toHaveTextContent(
      String(originalPosition),
    );
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /^Redo/ }));

    expect(screen.getByTestId('2d-order-service-position')).toHaveTextContent('512,96');
  });

  it('adds to the selection with a modifier while the inspector follows the newest element', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));
    await user.click(screen.getByRole('button', { name: 'Add Shopper in 2D' }));

    expect(screen.getByTestId('2d-selection-set')).toHaveTextContent('order-service,shopper');
    expect(screen.getByTestId('2d-selection')).toHaveTextContent('shopper');
    expect(
      within(screen.getByRole('complementary', { name: 'Inspector' })).getByRole('heading', {
        name: 'Shopper',
      }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Add Shopper in 2D' }));

    expect(screen.getByTestId('2d-selection-set')).toHaveTextContent('order-service');
    expect(screen.getByTestId('2d-selection')).toHaveTextContent('order-service');
  });

  it('keeps a multi-selection across a projection mode switch', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));
    await user.click(screen.getByRole('button', { name: 'Add Shopper in 2D' }));
    await user.click(screen.getByRole('button', { name: '3D spatial view' }));

    expect(await screen.findByTestId('3d-selection')).toHaveTextContent('shopper');

    await user.click(screen.getByRole('button', { name: '2D diagram view' }));

    expect(screen.getByTestId('2d-selection-set')).toHaveTextContent('order-service,shopper');
  });

  it('changes only placement on a drop and never reparents the model', async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <App />
        <SemanticProbe />
      </>,
    );
    const before = JSON.parse(screen.getByTestId('semantic-probe').textContent ?? '{}');

    await user.click(screen.getByRole('button', { name: 'Drop Order Service in 2D' }));

    const after = JSON.parse(screen.getByTestId('semantic-probe').textContent ?? '{}');
    expect(after.placement).toEqual({ x: 512, y: 96 });
    expect(after.placement).not.toEqual(before.placement);
    expect(after.kind).toBe(before.kind);
    expect(after.parentId).toBe(before.parentId);
    expect(after.parentId).toBe('northstar-commerce');
  });

  it('derives the 3D projection from the accepted 2D placement after a drop', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Drop Order Service in 2D' }));
    await user.click(screen.getByRole('button', { name: '3D spatial view' }));

    expect(await screen.findByTestId('diagram-3d')).toBeVisible();
    const projectedProject = projection3DMock.mock.lastCall?.[0] as typeof project;
    expect(
      projectedProject.views['core-containers']?.placements['core-containers-item-orders'],
    ).toMatchObject({ x: 512, y: 96 });
  });

  it('edits element metadata through one validated command and refreshes on undo', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Fulfilment Service');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('treeitem', { name: 'Fulfilment Service, Container' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue('Fulfilment Service');
    expect(screen.getByLabelText('Save state')).toHaveTextContent('Saving');

    await user.click(screen.getByRole('button', { name: /^Undo/ }));

    expect(screen.getByLabelText('Name')).toHaveValue('Order Service');
    expect(screen.getByRole('treeitem', { name: 'Order Service, Container' })).toBeVisible();
  });

  it('shows a rejected inspector edit beside the form and not in the stage banner', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Select Order Service in 2D' }));
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'a'.repeat(70));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const form = screen.getByRole('form', { name: 'Edit Order Service' });
    expect(within(form).getByRole('alert')).toHaveTextContent('INVALID_PROJECT');
    expect(screen.queryByRole('button', { name: 'Dismiss command error' })).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Order Service, Container' })).toBeVisible();
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
