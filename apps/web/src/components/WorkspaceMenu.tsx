import { useEffect, useRef, useState } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import { forgetProject, listRemoteVersions, readRemoteVersion } from '../editor/persistence';
import { downloadProjectFile, parseProjectFile } from '../editor/project-file';
import type { SaveStatus } from '../editor/useAutosave';

const STATUS_COPY: Readonly<Record<SaveStatus, string | undefined>> = {
  failed: 'Not saved',
  idle: undefined,
  'saved-browser': 'Saved to this browser',
  'saved-disk': 'Saved',
  saving: 'Saving…',
};

/**
 * Save state and the workspace-level actions: export, import, version restore, reset. The resting
 * state says nothing; "Saving…" and a save that fell short are the only states worth reading.
 */
export function WorkspaceMenu({
  project,
  status,
  onExportPng,
  onReplaceProject,
}: {
  readonly project: ReadonlyProject;
  readonly status: SaveStatus;
  readonly onExportPng: () => void;
  readonly onReplaceProject: (project: ReadonlyProject) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [versions, setVersions] = useState<readonly string[] | undefined>(undefined);
  const copy = STATUS_COPY[status];

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) {
        menu.current.open = false;
        setVersions(undefined);
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, []);

  const close = () => {
    if (menu.current !== null) {
      menu.current.open = false;
    }
    setVersions(undefined);
  };

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
      <input
        ref={filePicker}
        type="file"
        accept=".json,.c4.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) {
            return;
          }
          void file.text().then((text) => {
            const parsed = parseProjectFile(text);
            if (parsed === undefined) {
              window.alert('That file is not a valid CD3 project.');
              return;
            }
            onReplaceProject(parsed);
          });
        }}
      />
      <details className="workspace-menu" ref={menu}>
        <summary aria-label="Workspace menu">···</summary>
        <ul>
          <li>
            <button
              type="button"
              onClick={() => {
                close();
                onExportPng();
              }}
            >
              Export image (PNG)
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                close();
                downloadProjectFile(project);
              }}
            >
              Download project (JSON)
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                close();
                filePicker.current?.click();
              }}
            >
              Open project…
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                if (versions === undefined) {
                  void listRemoteVersions().then(setVersions);
                } else {
                  setVersions(undefined);
                }
              }}
            >
              Versions…
            </button>
            {versions === undefined ? null : versions.length === 0 ? (
              <p className="menu-note">No saved versions yet.</p>
            ) : (
              <ul className="version-list">
                {versions.map((timestamp) => (
                  <li key={timestamp}>
                    <button
                      type="button"
                      onClick={() => {
                        void readRemoteVersion(timestamp).then((snapshot) => {
                          if (snapshot === undefined) {
                            window.alert('That version could not be loaded.');
                            return;
                          }
                          close();
                          onReplaceProject(snapshot);
                        });
                      }}
                    >
                      {new Date(Number(timestamp)).toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
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
