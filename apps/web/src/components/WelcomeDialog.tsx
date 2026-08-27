import { useEffect, useRef } from 'react';

import type { ReadonlyProject } from '@cd3/domain';

import { NOT_A_PROJECT_FILE, readProjectFile } from '../editor/project-file';

interface WelcomeDialogProps {
  readonly onOpenProject: (project: ReadonlyProject) => void;
  readonly onDismiss: () => void;
}

/**
 * First-run choice between the bundled sample and the user's own file. Shown only when startup
 * fell back to the sample — the fallback writes the sample to the browser, so every later visit
 * loads from 'browser' or 'disk' and this never reappears.
 */
export function WelcomeDialog({ onOpenProject, onDismiss }: WelcomeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const dismissed = useRef(false);

  useEffect(() => {
    // jsdom builds without showModal fall back to the non-modal open attribute.
    if (typeof dialog.current?.showModal === 'function') {
      dialog.current.showModal();
    } else {
      dialog.current?.setAttribute('open', '');
    }
  }, []);

  // One dismissal, whether it comes from a button or from the native Escape cancel.
  const dismiss = () => {
    dialog.current?.close?.();
    if (dismissed.current) {
      return;
    }
    dismissed.current = true;
    onDismiss();
  };

  return (
    <dialog className="welcome-dialog" ref={dialog} onClose={dismiss} aria-label="Welcome">
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
          void readProjectFile(file).then((parsed) => {
            if (parsed === undefined) {
              window.alert(NOT_A_PROJECT_FILE);
              return;
            }
            onOpenProject(parsed);
            dismiss();
          });
        }}
      />
      <h2>Welcome to CD3</h2>
      <p>
        This workspace opens on the fictional <strong>Northstar Commerce</strong> sample, so nothing
        you see yet is yours. Start from your own project, or look around the sample first — any{' '}
        <code>.c4.json</code> file or portable project PNG dropped on the window opens it, and{' '}
        <strong>Open project…</strong> in the workspace menu does the same later.
      </p>
      <div className="welcome-actions">
        <button
          type="button"
          className="welcome-primary"
          onClick={() => filePicker.current?.click()}
        >
          Open my project…
        </button>
        <button type="button" onClick={dismiss}>
          Explore the sample
        </button>
      </div>
    </dialog>
  );
}
