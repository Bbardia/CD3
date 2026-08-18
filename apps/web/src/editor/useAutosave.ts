import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import { saveProject, type SaveOutcome } from './persistence';

export type SaveStatus = 'conflict' | 'failed' | 'idle' | 'saved-browser' | 'saved-disk' | 'saving';

const OUTCOME_STATUS: Readonly<Record<SaveOutcome, SaveStatus>> = {
  browser: 'saved-browser',
  conflict: 'conflict',
  disk: 'saved-disk',
  failed: 'failed',
};

/** Debounce, so a burst of commands (a drag, a form save) becomes one write. */
const QUIET_PERIOD_MS = 600;

/**
 * Persists the project whenever it changes. The first render is the loaded project, not an edit,
 * so it is skipped: opening the app never rewrites what it just read.
 */
export function useAutosave(
  project: ReadonlyProject,
  adopted: RefObject<ReadonlyProject | null>,
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const loaded = useRef(project);

  useEffect(() => {
    if (project === loaded.current) {
      return;
    }
    // A project adopted from disk is already on disk: re-saving it would be an echo that
    // overwrites the conflict stash and quietly clears the "changed outside" notice.
    if (adopted.current === project) {
      loaded.current = project;
      return;
    }
    setStatus('saving');
    let cancelled = false;
    const timer = setTimeout(() => {
      void saveProject(project).then((outcome) => {
        if (!cancelled) {
          setStatus(OUTCOME_STATUS[outcome]);
        }
      });
    }, QUIET_PERIOD_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adopted, project]);

  return status;
}
