import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DeepReadonly, Element, ElementChanges } from '@cd3/domain';

import type { CommandErrorData } from '../editor/editor-store';

export interface ElementInspectorFormProps {
  readonly element: DeepReadonly<Element>;
  /** Applies one update-element command and reports the domain error it was rejected with. */
  readonly onSubmit: (changes: ElementChanges) => CommandErrorData | undefined;
  /** Set for an element that was just authored, so its placeholder name can be typed over. */
  readonly renaming?: boolean;
}

interface Draft {
  readonly name: string;
  readonly description: string;
  readonly technology: string;
  readonly tags: string;
}

function draftOf(element: DeepReadonly<Element>): Draft {
  return {
    name: element.name,
    description: element.description ?? '',
    technology: element.technology ?? '',
    tags: element.tags.join(', '),
  };
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Trim exactly the way the domain schema does, so comparisons match what a command would store. */
function normalizeDraft(draft: Draft): Draft {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    technology: draft.technology.trim(),
    tags: parseTags(draft.tags).join(', '),
  };
}

function sameDraft(left: Draft, right: Draft): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.technology === right.technology &&
    left.tags === right.tags
  );
}

/**
 * Build only the fields that actually changed. Sending an unchanged optional field would add an
 * explicit `undefined` key that the domain treats as a real difference, producing an undo entry for
 * an edit the user never made.
 */
function buildChanges(draft: Draft, element: DeepReadonly<Element>): ElementChanges | undefined {
  const normalized = normalizeDraft(draft);
  const current = draftOf(element);
  const changes: {
    name?: string;
    description?: string | undefined;
    technology?: string | undefined;
    tags?: readonly string[];
  } = {};

  if (normalized.name !== current.name) {
    changes.name = normalized.name;
  }
  if (normalized.description !== current.description) {
    changes.description = normalized.description === '' ? undefined : normalized.description;
  }
  if (normalized.technology !== current.technology) {
    changes.technology = normalized.technology === '' ? undefined : normalized.technology;
  }
  if (normalized.tags !== current.tags) {
    changes.tags = parseTags(draft.tags);
  }

  return Object.keys(changes).length === 0 ? undefined : (changes as ElementChanges);
}

export function ElementInspectorForm({
  element,
  onSubmit,
  renaming = false,
}: ElementInspectorFormProps) {
  const fieldId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const [baseline, setBaseline] = useState(element);
  const [draft, setDraft] = useState<Draft>(() => draftOf(element));
  const [conflict, setConflict] = useState<DeepReadonly<Element> | undefined>(undefined);
  const [error, setError] = useState<CommandErrorData | undefined>(undefined);

  // A freshly authored element carries a placeholder name, so hand the field over ready to type.
  useEffect(() => {
    if (renaming) {
      nameField.current?.focus();
      nameField.current?.select();
    }
  }, [renaming]);

  const dirty = !sameDraft(normalizeDraft(draft), draftOf(baseline));

  // The canonical element can change under the form through undo, redo, or this form's own save.
  useEffect(() => {
    if (element === baseline) {
      return;
    }
    const incoming = draftOf(element);
    // Either the user has typed nothing, or the incoming values are what they typed — in both cases
    // adopting canonical state silently loses no work.
    if (!dirty || sameDraft(normalizeDraft(draft), incoming)) {
      setBaseline(element);
      setDraft(incoming);
      setConflict(undefined);
      setError(undefined);
      return;
    }
    setConflict(element);
  }, [baseline, dirty, draft, element]);

  const updateField = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
  };

  const resetDraft = () => {
    setBaseline(element);
    setDraft(draftOf(element));
    setConflict(undefined);
    setError(undefined);
  };

  const keepDraft = () => {
    // Re-baseline without touching the text, so dirtiness is measured against current canonical.
    setBaseline(element);
    setConflict(undefined);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const changes = buildChanges(draft, element);
    if (changes === undefined) {
      setDraft(draftOf(element));
      setError(undefined);
      return;
    }
    setError(onSubmit(changes));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      resetDraft();
    }
  };

  return (
    <form
      className="element-form"
      aria-label={`Edit ${element.name}`}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
    >
      {conflict === undefined ? null : (
        <div className="element-form__conflict" role="alert">
          <p>This element changed outside the form while you were editing it.</p>
          <div className="element-form__conflict-actions">
            <button type="button" onClick={resetDraft}>
              Discard my edits
            </button>
            <button type="button" onClick={keepDraft}>
              Keep editing
            </button>
          </div>
        </div>
      )}

      <div className="element-form__field">
        <label htmlFor={`${fieldId}-name`}>Name</label>
        <input
          ref={nameField}
          id={`${fieldId}-name`}
          value={draft.name}
          onChange={(event) => updateField('name')(event.target.value)}
        />
      </div>

      <div className="element-form__field">
        <label htmlFor={`${fieldId}-description`}>Description</label>
        <textarea
          id={`${fieldId}-description`}
          rows={3}
          value={draft.description}
          onChange={(event) => updateField('description')(event.target.value)}
        />
      </div>

      <div className="element-form__field">
        <label htmlFor={`${fieldId}-technology`}>Technology</label>
        <input
          id={`${fieldId}-technology`}
          value={draft.technology}
          onChange={(event) => updateField('technology')(event.target.value)}
        />
      </div>

      <div className="element-form__field">
        <label htmlFor={`${fieldId}-tags`}>Tags</label>
        <input
          id={`${fieldId}-tags`}
          value={draft.tags}
          onChange={(event) => updateField('tags')(event.target.value)}
          placeholder="tag, tag"
        />
      </div>

      {error === undefined ? null : (
        <p className="element-form__error" role="alert">
          <code>{error.code}</code> {error.message}
        </p>
      )}

      <div className="element-form__actions">
        <button type="submit" disabled={!dirty}>
          Save
        </button>
        <button type="button" onClick={resetDraft} disabled={!dirty}>
          Cancel
        </button>
        {dirty ? <span className="element-form__state">Unsaved draft</span> : null}
      </div>
    </form>
  );
}
