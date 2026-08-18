import { useEffect, useMemo } from 'react';

import { useEditorStore } from '../editor/EditorStoreProvider';
import { detectApplePlatform, isTextEntryTarget } from '../editor/keyboard';

interface ShortcutLabels {
  readonly undo: string;
  readonly redo: string;
  readonly undoKeys: string;
  readonly redoKeys: string;
}

function shortcutLabels(apple: boolean): ShortcutLabels {
  return apple
    ? { undo: 'Undo (⌘Z)', redo: 'Redo (⇧⌘Z)', undoKeys: 'Meta+Z', redoKeys: 'Meta+Shift+Z' }
    : {
        undo: 'Undo (Ctrl+Z)',
        redo: 'Redo (Ctrl+Shift+Z)',
        undoKeys: 'Control+Z',
        redoKeys: 'Control+Shift+Z',
      };
}

/**
 * Bind platform-appropriate history shortcuts to the window.
 *
 * Undo/redo are global editor actions rather than canvas actions, so the listener is installed on
 * the window and filtered, instead of being scoped to a focusable surface the user may never enter.
 */
function useHistoryShortcuts(undo: () => void, redo: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) {
        return;
      }

      const apple = detectApplePlatform();
      const primaryModifier = apple ? event.metaKey : event.ctrlKey;
      const foreignModifier = apple ? event.ctrlKey : event.metaKey;
      if (!primaryModifier || foreignModifier || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      // Windows and Linux editors conventionally accept Ctrl+Y as a second redo binding.
      if (!apple && key === 'y' && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);
}

export function EditorToolbar() {
  const undoDepth = useEditorStore((state) => state.history.undoStack.length);
  const redoDepth = useEditorStore((state) => state.history.redoStack.length);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const labels = useMemo(() => shortcutLabels(detectApplePlatform()), []);

  useHistoryShortcuts(undo, redo);

  return (
    <div className="segmented segmented--glyph" role="group" aria-label="Editing history">
      <button
        type="button"
        onClick={undo}
        disabled={undoDepth === 0}
        aria-label={labels.undo}
        aria-keyshortcuts={labels.undoKeys}
      >
        <span aria-hidden="true">↶</span>
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={redoDepth === 0}
        aria-label={labels.redo}
        aria-keyshortcuts={labels.redoKeys}
      >
        <span aria-hidden="true">↷</span>
      </button>
    </div>
  );
}

/**
 * Show the most recent rejected command. The store keeps the previous valid project, so this is the
 * only signal the user gets that an edit was refused.
 */
export function CommandErrorBanner() {
  const lastCommandError = useEditorStore((state) => state.lastCommandError);
  const clearError = useEditorStore((state) => state.clearError);

  if (lastCommandError === undefined) {
    return null;
  }

  return (
    <div className="command-error" role="alert">
      <code className="command-error__code">{lastCommandError.code}</code>
      <span className="command-error__message">{lastCommandError.message}</span>
      <button
        type="button"
        className="icon-button"
        onClick={clearError}
        aria-label="Dismiss command error"
      >
        ×
      </button>
    </div>
  );
}
