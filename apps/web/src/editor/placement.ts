import type { ViewItemMove } from '@cd3/domain';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedItem {
  readonly itemId: string;
  readonly rect: Rect;
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/** A centre line shared with a nearby block while a snapped drag holds, in placement space. */
export interface SnapGuide {
  /** 'x' aligns horizontal centres (a vertical guide); 'y' aligns vertical centres. */
  readonly axis: 'x' | 'y';
  /** The aligned centre coordinate on that axis. */
  readonly position: number;
  /** Guide extent along the other axis, covering both aligned blocks with a little overshoot. */
  readonly start: number;
  readonly end: number;
}

/** How close a centre must drift to a neighbour's centre before the drag locks onto it. */
export const SNAP_THRESHOLD = 8;

/**
 * Canva-style centre snapping: when the dragged rect's centre comes within the threshold of a
 * stationary rect's centre on an axis, the drag locks onto that centre. Returns the correction to
 * add to the dragged position plus the guide lines to draw while the lock holds.
 */
export function centerSnap(
  dragged: Rect,
  stationary: readonly Rect[],
  threshold: number = SNAP_THRESHOLD,
): { readonly dx: number; readonly dy: number; readonly guides: readonly SnapGuide[] } {
  const centerX = dragged.x + dragged.width / 2;
  const centerY = dragged.y + dragged.height / 2;
  let dx = 0;
  let dy = 0;
  let alignedX: Rect | undefined;
  let alignedY: Rect | undefined;
  for (const rect of stationary) {
    const offsetX = rect.x + rect.width / 2 - centerX;
    const offsetY = rect.y + rect.height / 2 - centerY;
    if (
      Math.abs(offsetX) <= threshold &&
      (alignedX === undefined || Math.abs(offsetX) < Math.abs(dx))
    ) {
      dx = offsetX;
      alignedX = rect;
    }
    if (
      Math.abs(offsetY) <= threshold &&
      (alignedY === undefined || Math.abs(offsetY) < Math.abs(dy))
    ) {
      dy = offsetY;
      alignedY = rect;
    }
  }
  const guides: SnapGuide[] = [];
  if (alignedX !== undefined) {
    guides.push({
      axis: 'x',
      position: centerX + dx,
      start: Math.min(dragged.y + dy, alignedX.y) - 12,
      end: Math.max(dragged.y + dy + dragged.height, alignedX.y + alignedX.height) + 12,
    });
  }
  if (alignedY !== undefined) {
    guides.push({
      axis: 'y',
      position: centerY + dy,
      start: Math.min(dragged.x + dx, alignedY.x) - 12,
      end: Math.max(dragged.x + dx + dragged.width, alignedY.x + alignedY.width) + 12,
    });
  }
  return { dx, dy, guides };
}

/**
 * True when a finished drag would drop an item on top of one it is not carrying. Items dragged
 * together keep their relative spacing, so they are only tested against the ones staying put.
 */
export function movesCollide(
  moves: readonly ViewItemMove[],
  items: readonly PlacedItem[],
): boolean {
  const sizeById = new Map(items.map((item) => [item.itemId, item.rect]));
  const movedIds = new Set(moves.map((move) => move.itemId));
  const movedRects = moves.flatMap((move) => {
    const size = sizeById.get(move.itemId);
    return size === undefined ? [] : [{ ...size, x: move.x, y: move.y }];
  });
  const stationary = items.filter((item) => !movedIds.has(item.itemId));

  return movedRects.some((moved) => stationary.some((item) => overlaps(moved, item.rect)));
}
