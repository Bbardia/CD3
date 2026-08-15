import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Element, ElementId, Relationship } from '@cd3/domain';

import { Diagram2D } from './components/Diagram2D';
import { getWorkspaceView, project, workspaceViewIds, type WorkspaceViewId } from './workspace';
import { probeElkLayoutWorker } from './workers/elk-worker-client';

const elementKindLabel = {
  component: 'Component',
  container: 'Container',
  person: 'Person',
  softwareSystem: 'System',
} as const;

const elementGroupOrder: readonly Element['kind'][] = [
  'person',
  'softwareSystem',
  'container',
  'component',
];

const elementGroupLabel: Readonly<Record<Element['kind'], string>> = {
  component: 'Components',
  container: 'Containers',
  person: 'People',
  softwareSystem: 'Systems',
};

type ProjectionMode = '2d' | '3d';

const SpatialDiagram = lazy(async () => {
  const module = await import('./components/SpatialDiagram');
  return { default: module.SpatialDiagram };
});

function ownElement(elementId: string): Element | undefined {
  return Object.hasOwn(project.elements, elementId) ? project.elements[elementId] : undefined;
}

function relationshipCounterparty(
  relationship: Relationship,
  selectedId: string,
): Element | undefined {
  const counterpartyId =
    relationship.sourceId === selectedId ? relationship.targetId : relationship.sourceId;
  return ownElement(counterpartyId);
}

function ModelExplorer({
  selectedElementId,
  selectedViewId,
  onSelectElement,
  onSelectView,
}: {
  readonly selectedElementId: string | undefined;
  readonly selectedViewId: WorkspaceViewId;
  readonly onSelectElement: (elementId: string) => void;
  readonly onSelectView: (viewId: WorkspaceViewId) => void;
}) {
  const elements = useMemo(
    () =>
      Object.values(project.elements).sort((left, right) => left.name.localeCompare(right.name)),
    [],
  );

  return (
    <nav className="model-explorer" aria-label="Model explorer">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Canonical</span>
          <h2>Model explorer</h2>
        </div>
        <span className="count-badge">{elements.length}</span>
      </div>

      <div className="explorer-scroll">
        <section className="explorer-section" aria-labelledby="model-section-heading">
          <h3 id="model-section-heading">Model</h3>
          <div role="tree" aria-label="Architecture elements" className="model-tree">
            {elementGroupOrder.map((kind) => {
              const groupElements = elements.filter((element) => element.kind === kind);
              return (
                <div
                  className="tree-group"
                  key={kind}
                  role="group"
                  aria-label={elementGroupLabel[kind]}
                >
                  <div className="tree-group__heading">
                    <span>{elementGroupLabel[kind]}</span>
                    <span>{groupElements.length}</span>
                  </div>
                  {groupElements.map((element) => (
                    <button
                      key={element.id}
                      type="button"
                      role="treeitem"
                      aria-label={`${element.name}, ${elementKindLabel[element.kind]}`}
                      aria-selected={element.id === selectedElementId}
                      className={`tree-row tree-row--${element.kind}${element.id === selectedElementId ? ' is-selected' : ''}`}
                      onClick={() => onSelectElement(element.id)}
                    >
                      <span className="tree-row__marker" aria-hidden="true" />
                      <span className="tree-row__copy">
                        <strong>{element.name}</strong>
                        <small>{elementKindLabel[element.kind]}</small>
                      </span>
                      {element.tags.includes('external') ? (
                        <span className="external-dot" title="External element">
                          EXT
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <section className="explorer-section" aria-labelledby="relationships-section-heading">
          <h3 id="relationships-section-heading">Relationships</h3>
          <div className="summary-row">
            <span>Semantic records</span>
            <strong>{Object.keys(project.relationships).length}</strong>
          </div>
        </section>

        <section className="explorer-section" aria-labelledby="views-section-heading">
          <h3 id="views-section-heading">Views</h3>
          <div className="view-list">
            {workspaceViewIds.map((viewId) => {
              const view = project.views[viewId];
              if (view === undefined) {
                return null;
              }
              const current = viewId === selectedViewId;
              return (
                <button
                  key={viewId}
                  type="button"
                  className={`view-row${current ? ' is-current' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onSelectView(viewId)}
                >
                  <span className="view-row__badge">{view.type}</span>
                  <span>
                    <strong>{view.name}</strong>
                    <small>{Object.keys(view.items).length} visible elements</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </nav>
  );
}

function Inspector({
  selectedElementId,
  onClear,
}: {
  readonly selectedElementId: string | undefined;
  readonly onClear: () => void;
}) {
  const element = selectedElementId === undefined ? undefined : ownElement(selectedElementId);
  const relationships = useMemo(
    () =>
      selectedElementId === undefined
        ? []
        : Object.values(project.relationships).filter(
            (relationship) =>
              relationship.sourceId === selectedElementId ||
              relationship.targetId === selectedElementId,
          ),
    [selectedElementId],
  );

  return (
    <aside className="inspector" aria-label="Inspector">
      {element === undefined ? (
        <div className="inspector-empty">
          <span className="empty-glyph" aria-hidden="true">
            ⌖
          </span>
          <span className="panel-eyebrow">Inspector</span>
          <h2>Nothing selected</h2>
          <p>Select an element to inspect its architecture details.</p>
          <p className="quiet-copy">Selection stays synchronized across the tree, 2D and 3D.</p>
        </div>
      ) : (
        <div className="inspector-content">
          <div className="inspector-title">
            <div>
              <span className={`kind-chip kind-chip--${element.kind}`}>
                {elementKindLabel[element.kind]}
              </span>
              <h2>{element.name}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={onClear}
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>

          <section className="inspector-section">
            <h3>Definition</h3>
            <p>{element.description ?? 'No description has been recorded.'}</p>
          </section>

          {element.technology === undefined ? null : (
            <section className="inspector-section">
              <h3>Technology</h3>
              <p className="technology-value">{element.technology}</p>
            </section>
          )}

          <section className="inspector-section">
            <h3>Relationships</h3>
            {relationships.length === 0 ? (
              <p className="quiet-copy">No incoming or outgoing relationships.</p>
            ) : (
              <ul className="relationship-list">
                {relationships.map((relationship) => {
                  const outgoing = relationship.sourceId === element.id;
                  const counterparty = relationshipCounterparty(relationship, element.id);
                  return (
                    <li key={relationship.id}>
                      <span className={`relationship-direction${outgoing ? ' is-outgoing' : ''}`}>
                        {outgoing ? '→' : '←'}
                      </span>
                      <div>
                        <strong>{relationship.name}</strong>
                        <span>
                          {outgoing ? 'to' : 'from'} {counterparty?.name ?? 'Unknown element'}
                        </span>
                        <small>
                          {relationship.interaction} ·{' '}
                          {relationship.technology ?? 'unspecified technology'}
                        </small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="inspector-section">
            <h3>Tags</h3>
            <div className="tag-list">
              {element.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </section>

          <section className="inspector-section inspector-section--datum">
            <h3>Stable identity</h3>
            <code>{element.id}</code>
          </section>
        </div>
      )}
    </aside>
  );
}

export function App() {
  const [viewId, setViewId] = useState<WorkspaceViewId>('core-containers');
  const [mode, setMode] = useState<ProjectionMode>('2d');
  const [selectedElementId, setSelectedElementId] = useState<ElementId | undefined>();
  const [layoutWorkerState, setLayoutWorkerState] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  );
  const workspaceView = useMemo(() => getWorkspaceView(viewId), [viewId]);
  const selectedElement =
    selectedElementId === undefined ? undefined : ownElement(selectedElementId);

  useEffect(() => {
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedElementId(undefined);
      }
    };
    window.addEventListener('keydown', clearOnEscape);
    return () => window.removeEventListener('keydown', clearOnEscape);
  }, []);

  useEffect(() => {
    let active = true;
    void probeElkLayoutWorker()
      .then((ready) => {
        if (active) {
          setLayoutWorkerState(ready ? 'ready' : 'unavailable');
        }
      })
      .catch(() => {
        if (active) {
          setLayoutWorkerState('unavailable');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const warningCount = workspaceView.compiled.warnings.length;

  return (
    <div className="app-shell">
      <header className="global-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            C<span>D</span>3
          </span>
          <span className="header-divider" aria-hidden="true" />
          <div className="breadcrumb">
            <strong>Northstar Commerce</strong>
            <span>/</span>
            <span>{workspaceView.compiled.name}</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="save-state">
            <span aria-hidden="true" /> Sample fixture · read-only
          </span>
          <span className="read-only-badge">Read-only slice</span>
          <button type="button" className="icon-button" aria-label="Workspace menu">
            ···
          </button>
        </div>
      </header>

      <ModelExplorer
        selectedElementId={selectedElementId}
        selectedViewId={viewId}
        onSelectElement={(elementId) => setSelectedElementId(elementId as ElementId)}
        onSelectView={setViewId}
      />

      <main className="stage">
        <div className="stage-bar">
          <div className="stage-title">
            <span className="panel-eyebrow">{workspaceView.compiled.type} view</span>
            <div>
              <h1>{workspaceView.compiled.name}</h1>
              <span>{workspaceView.compiled.description}</span>
            </div>
          </div>
          <div className="stage-tools">
            <div className="mode-switch" aria-label="Projection mode">
              <button
                type="button"
                aria-label="2D diagram view"
                aria-pressed={mode === '2d'}
                onClick={() => setMode('2d')}
              >
                2D
              </button>
              <button
                type="button"
                aria-label="3D spatial view"
                aria-pressed={mode === '3d'}
                onClick={() => setMode('3d')}
              >
                3D
              </button>
            </div>
            <span className="view-count">
              {workspaceView.compiled.items.length} / {workspaceView.compiled.relationships.length}
            </span>
          </div>
        </div>

        <div className="stage-canvas">
          {mode === '2d' ? (
            <Diagram2D
              projection={workspaceView.twoD}
              selectedElementId={selectedElementId}
              onSelect={(elementId) => setSelectedElementId(elementId as ElementId | undefined)}
            />
          ) : (
            <Suspense
              fallback={
                <section className="projection-loading" aria-label="Preparing 3D projection">
                  <span className="panel-eyebrow">Derived spatial view</span>
                  <strong>Preparing 3D projection…</strong>
                </section>
              }
            >
              <SpatialDiagram
                projection={workspaceView.threeD}
                selectedElementId={selectedElementId}
                onSelect={(elementId) => setSelectedElementId(elementId as ElementId | undefined)}
              />
            </Suspense>
          )}
        </div>
      </main>

      <Inspector
        selectedElementId={selectedElementId}
        onClear={() => setSelectedElementId(undefined)}
      />

      <footer className="status-strip" role="status" aria-live="polite">
        <div>
          <span>{mode.toUpperCase()}</span>
          <span>{workspaceView.compiled.items.length} elements</span>
          <span>{workspaceView.compiled.relationships.length} relationships</span>
        </div>
        <div>
          <span>{warningCount === 0 ? 'No compiler warnings' : `${warningCount} warnings`}</span>
          <span>{selectedElement === undefined ? 'No selection' : selectedElement.name}</span>
          <span>
            {layoutWorkerState === 'ready'
              ? 'Layout worker ready'
              : layoutWorkerState === 'unavailable'
                ? 'Layout worker unavailable'
                : 'Checking layout worker'}
          </span>
        </div>
      </footer>
    </div>
  );
}
