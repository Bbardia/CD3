import { useEffect, useRef, useState } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import { saveProject, type SaveOutcome } from './persistence';

export type SaveStatus = 'failed' | 'idle' | 'saved-browser' | 'saved-disk' | 'saving';

const OUTCOME_STATUS: Readonly<Record<SaveOutcome, SaveStatus>> = {
  browser: 'saved-browser',
  disk: 'saved-disk',
  failed: 'failed',
};

/** Debounce, so a burst of commands (a drag, a form save) becomes one write. */
const QUIET_PERIOD_MS = 600;

/**
 * Persists the project whenever it changes. The first render is the loaded project, not an edit,
 * so it is skipped: opening the app never rewrites what it just read.
 */
export function useAutosave(project: ReadonlyProject): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const loaded = useRef(project);

  useEffect(() => {
    if (project === loaded.current) {
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
  }, [project]);

  return status;
}
