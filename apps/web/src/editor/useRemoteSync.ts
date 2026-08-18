import { useEffect } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import { fetchRemoteRevision, readRemoteProject, remoteRevision } from './persistence';

const POLL_INTERVAL_MS = 3000;

/**
 * Adopts changes made to the disk snapshot outside this tab — a terminal script, another window —
 * by polling the revision and reloading the project when it moves. Reads through
 * readRemoteProject, which records the adopted revision, so a change is adopted exactly once.
 */
export function useRemoteSync(
  onExternalProject: (project: ReadonlyProject) => void,
  canAdopt: () => boolean,
): void {
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      // A save in flight means the revision is about to move because of this tab; adopting during
      // that window would race the save's own bookkeeping and could cancel the user's edit.
      if (inFlight || !canAdopt()) {
        return;
      }
      inFlight = true;
      void fetchRemoteRevision()
        .then(async (revision) => {
          if (revision === undefined || revision === remoteRevision() || !canAdopt()) {
            return;
          }
          const project = await readRemoteProject();
          if (project !== undefined && canAdopt()) {
            onExternalProject(project);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canAdopt, onExternalProject]);
}
