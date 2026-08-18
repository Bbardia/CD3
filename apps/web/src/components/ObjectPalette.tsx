import { PALETTE_MIME, paletteEntries } from '../editor/palette';

/**
 * Catalogue of the objects a view can hold. A click authors one immediately; a drag places it
 * exactly where it lands on either stage. Click is also what makes the palette keyboard-usable.
 */
export function ObjectPalette({ onAdd }: { readonly onAdd: (entryId: string) => void }) {
  return (
    <section className="explorer-section" aria-labelledby="palette-section-heading">
      <h3 id="palette-section-heading">Objects</h3>
      <ul className="palette-grid">
        {paletteEntries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="palette-chip"
              draggable
              aria-label={`Add ${entry.label}`}
              title="Click to add · drag to place"
              onClick={() => onAdd(entry.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData(PALETTE_MIME, entry.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className={`palette-glyph palette-glyph--${entry.id}`} aria-hidden="true" />
              <span>{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
