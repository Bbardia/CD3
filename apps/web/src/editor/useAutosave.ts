import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import {
  saveProject,
  writeLocalProject,
  type ProjectSource,
  type SaveOutcome,
} from './persistence';

export type SaveStatus = 'conflict' | 'failed' | 'idle' | 'saved-browser' | 'saved-disk' | 'saving';

const OUTCOME_STATUS: Readonly<Record<SaveOutcome, SaveStatus>> = {
  browser: 'saved-browser',
  conflict: 'conflict',
  disk: 'saved-disk',
  failed: 'failed',
};

/** Debounce only disk I/O; every edit reaches localStorage synchronously. */
const QUIET_PERIOD_MS = 600;

/**
 * Persists edits to the browser immediately and serializes their debounced disk saves. Browser and
 * sample startup sources are also written to disk; a project loaded from disk is the only initial
 * render that can safely skip an echo save.
 */
export function useAutosave(
  project: ReadonlyProject,
  adopted: RefObject<ReadonlyProject | null>,
  initialSource: ProjectSource = 'disk',
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>(initialSource === 'disk' ? 'idle' : 'saving');
  const observed = useRef(project);
  const needsInitialSave = useRef(initialSource !== 'disk');
  const latestProject = useRef(project);
  const dirty = useRef(initialSource !== 'disk');
  const saveGeneration = useRef(0);
  latestProject.current = project;

  useLayoutEffect(() => {
    const initialSave = needsInitialSave.current && project === observed.current;
    if (!initialSave && project === observed.current) {
      return;
    }
    if (!initialSave) {
      observed.current = project;
    }

    // A project adopted from disk is already durable. Re-saving it would turn a safe conflict
    // recovery into an overwrite attempt.
    if (adopted.current === project) {
      needsInitialSave.current = false;
      saveGeneration.current += 1;
      dirty.current = false;
      // Clear a prior conflict status after its recovery copy has been stashed. Otherwise a second
      // external adoption mistakes the already-adopted disk project for the losing local edit and
      // overwrites the real recovery copy.
      setStatus('saved-disk');
      return;
    }

    dirty.current = true;
    writeLocalProject(project);
    setStatus('saving');
    const generation = ++saveGeneration.current;
    const timer = window.setTimeout(() => {
      needsInitialSave.current = false;
      void saveProject(project).then((outcome) => {
        if (generation !== saveGeneration.current) {
          return;
        }
        dirty.current = outcome !== 'disk';
        setStatus(OUTCOME_STATUS[outcome]);
      });
    }, QUIET_PERIOD_MS);

    return () => window.clearTimeout(timer);
  }, [adopted, project]);

  useEffect(() => {
    const preserveFinalEdit = () => {
      if (dirty.current) {
        writeLocalProject(latestProject.current);
      }
    };
    window.addEventListener('pagehide', preserveFinalEdit);
    window.addEventListener('beforeunload', preserveFinalEdit);
    return () => {
      window.removeEventListener('pagehide', preserveFinalEdit);
      window.removeEventListener('beforeunload', preserveFinalEdit);
      preserveFinalEdit();
    };
  }, []);

  return status;
}
