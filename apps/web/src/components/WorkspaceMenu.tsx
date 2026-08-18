import { useEffect, useRef } from 'react';

import { forgetProject } from '../editor/persistence';
import type { SaveStatus } from '../editor/useAutosave';

const STATUS_COPY: Readonly<Record<SaveStatus, string | undefined>> = {
  failed: 'Not saved',
  idle: undefined,
  'saved-browser': 'Saved to this browser',
  'saved-disk': 'Saved',
  saving: 'Saving…',
};

/**
 * Save state and the actions that go with it. The resting state says nothing: a permanent "saved"
 * badge is a green light, while "Saving…" and a failure are the only states worth reading.
 */
export function WorkspaceMenu({ status }: { readonly status: SaveStatus }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const copy = STATUS_COPY[status];

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
    <>
      {copy === undefined ? null : (
        <span
          className={`save-state${status === 'failed' ? ' save-state--failed' : ''}`}
          role="status"
          aria-live="polite"
          aria-label="Save state"
        >
          <span aria-hidden="true" /> {copy}
        </span>
      )}
      <details className="workspace-menu" ref={menu}>
        <summary aria-label="Workspace menu">···</summary>
        <ul>
          <li>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Discard this workspace and reopen the Northstar Commerce sample? Saved copies are deleted.',
                  )
                ) {
                  void forgetProject().then(() => {
                    window.location.reload();
                  });
                }
              }}
            >
              Reset to sample project
            </button>
          </li>
        </ul>
      </details>
    </>
  );
}
