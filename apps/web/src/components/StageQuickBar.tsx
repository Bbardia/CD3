import { useEffect, useRef } from 'react';

import { paletteEntries } from '../editor/palette';

import { PaletteGlyph } from './PaletteGlyph';

/**
 * Add and delete without leaving the canvas. The add menu is a native disclosure, so it opens,
 * closes on Escape, and reaches the keyboard without any state of its own.
 */
export function StageQuickBar({
  selectionCount,
  hint,
  onAdd,
  onDelete,
  onRevealInspector,
  onArrange,
}: {
  readonly selectionCount: number;
  /** Transient prompt for the active tool, announced where the pointer already is. */
  readonly hint: string | undefined;
  readonly onAdd: (entryId: string) => void;
  readonly onDelete: () => void;
  /** Set only while the inspector is hidden; renders the way back. */
  readonly onRevealInspector?: (() => void) | undefined;
  /** ELK auto-arrange for the current view; absent while the worker is busy or unavailable. */
  readonly onArrange?: (() => void) | undefined;
}) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        menu.current.open = false;
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, []);

  return (
    <div className="stage-quickbar">
      <p className="stage-hint" role="status" aria-live="polite" aria-label="Tool hint">
        {hint ?? ''}
      </p>
      <div className="stage-quickbar__actions" role="toolbar" aria-label="Quick actions">
        <details className="quick-add" ref={menu}>
          <summary aria-label="Add an element">+ Add</summary>
          <ul>
            {paletteEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(entry.id);
                    if (menu.current !== null) {
                      menu.current.open = false;
                    }
                  }}
                >
                  <PaletteGlyph id={entry.id} />
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <button
          type="button"
          className="quick-delete"
          onClick={onDelete}
          disabled={selectionCount === 0}
          aria-label={
            selectionCount > 1
              ? `Delete ${String(selectionCount)} selected elements`
              : 'Delete element'
          }
        >
          Delete{selectionCount > 1 ? ` (${String(selectionCount)})` : ''}
        </button>
        {onArrange === undefined ? null : (
          <button
            type="button"
            aria-label="Arrange this view automatically"
            title="Auto-arrange the view (undoable)"
            onClick={onArrange}
          >
            Arrange
          </button>
        )}
        {onRevealInspector === undefined ? null : (
          <button
            type="button"
            aria-label="Show the inspector"
            title="Show the inspector"
            onClick={onRevealInspector}
          >
            « Inspector
          </button>
        )}
      </div>
    </div>
  );
}
