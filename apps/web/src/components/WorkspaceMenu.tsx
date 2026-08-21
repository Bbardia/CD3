import { useEffect, useRef, useState } from 'react';
import type { ReadonlyProject } from '@cd3/domain';

import {
  forgetProject,
  listRemoteVersions,
  readConflictProject,
  readRemoteVersion,
} from '../editor/persistence';
import { extractProjectFromPng } from '../editor/png-project';
import { downloadProjectFile, parseProjectFile } from '../editor/project-file';
import type { SaveStatus } from '../editor/useAutosave';

const STATUS_COPY: Readonly<Record<SaveStatus, string | undefined>> = {
  conflict: 'Changed outside the app',
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
  readonly onExportPng: (embedProject: boolean) => void;
  readonly onReplaceProject: (project: ReadonlyProject) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [versions, setVersions] = useState<readonly string[] | undefined>(undefined);
  const [resetting, setResetting] = useState(false);
  const copy = STATUS_COPY[status];
  const conflictProject = readConflictProject();

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
          className={`save-state${status === 'failed' || status === 'conflict' ? ' save-state--failed' : ''}`}
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
        accept=".json,.c4.json,.png,application/json,image/png"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) {
            return;
          }
          const read =
            file.type === 'image/png' || file.name.endsWith('.png')
              ? file.arrayBuffer().then((buffer) => {
                  return extractProjectFromPng(new Uint8Array(buffer)) ?? '';
                })
              : file.text();
          void read.then((text) => {
            const parsed = parseProjectFile(text);
            if (parsed === undefined) {
              window.alert('That file is not a CD3 project — or the PNG was not exported by CD3.');
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
                onExportPng(false);
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
                onExportPng(true);
              }}
            >
              Portable project PNG
            </button>
            <p className="menu-note">
              Looks the same but hides the whole project — every view, description and property —
              inside the file. Share it only where the project itself may go.
            </p>
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
          {conflictProject === undefined ? null : (
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  downloadProjectFile(conflictProject);
                }}
              >
                Download recovery copy (JSON)
              </button>
              <p className="menu-note">Preserved after a save conflict.</p>
            </li>
          )}
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
              disabled={resetting}
              onClick={async () => {
                if (
                  window.confirm(
                    'Discard this workspace and reopen the Northstar Commerce sample? Saved copies are deleted.',
                  )
                ) {
                  setResetting(true);
                  const outcome = await forgetProject();
                  if (outcome === 'forgotten') {
                    window.location.reload();
                    return;
                  }
                  setResetting(false);
                  window.alert(
                    outcome === 'disk-failed'
                      ? 'Reset failed because the disk copy could not be deleted. Your browser copy was kept.'
                      : 'The disk copy was deleted, but browser storage could not be cleared. Close the app and try again.',
                  );
                }
              }}
            >
              {resetting ? 'Resetting…' : 'Reset to sample project'}
            </button>
          </li>
        </ul>
      </details>
    </>
  );
}
