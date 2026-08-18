import { useEffect, useRef } from 'react';

import { paletteEntries } from '../editor/palette';

/**
 * Add and delete without leaving the canvas. The add menu is a native disclosure, so it opens,
 * closes on Escape, and reaches the keyboard without any state of its own.
 */
export function StageQuickBar({
  selectionCount,
  hint,
  onAdd,
  onDelete,
}: {
  readonly selectionCount: number;
  /** Transient prompt for the active tool, announced where the pointer already is. */
  readonly hint: string | undefined;
  readonly onAdd: (entryId: string) => void;
  readonly onDelete: () => void;
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
                  <span className={`palette-glyph palette-glyph--${entry.id}`} aria-hidden="true" />
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
      </div>
    </div>
  );
}
