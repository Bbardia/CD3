import { useEffect } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import {
  adoptRemoteRevision,
  fetchRemoteRevision,
  readRemoteProject,
  remoteRevision,
} from './persistence';

const POLL_INTERVAL_MS = 3000;

/**
 * Adopts changes made to the disk snapshot outside this tab — a terminal script, another window —
 * by polling the revision and reloading the project when it moves. The revision advances only
 * after the final adoption check and callback, so an edit that begins during the read cannot be
 * based on an external project the editor never adopted.
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
          if (revision.status !== 'found' || revision.value === remoteRevision() || !canAdopt()) {
            return;
          }
          const remote = await readRemoteProject();
          if (remote.status === 'found' && canAdopt()) {
            // The callback stashes a conflicted local copy before replacement; cache only after it
            // runs, otherwise the browser recovery record would be overwritten too early.
            onExternalProject(remote.value.project);
            adoptRemoteRevision(remote.value.revision);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canAdopt, onExternalProject]);
}
