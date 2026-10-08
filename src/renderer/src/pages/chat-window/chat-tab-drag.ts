export interface TabSlot {
  id: string;
  left: number;
  width: number;
}

/** Keeps the dragged tab inside the strip's first and last slot. */
export function clampDragOffset(
  slots: TabSlot[],
  fromIndex: number,
  offset: number
) {
  const from = slots[fromIndex];
  const first = slots[0];
  const last = slots[slots.length - 1];

  return Math.min(
    Math.max(offset, first.left - from.left),
    last.left + last.width - (from.left + from.width)
  );
}

/**
 * Index the dragged tab would take. A neighbour moves aside once the dragged
 * tab's leading edge passes its middle, so a wide tab can still reach either
 * end of the strip.
 */
export function getDragTargetIndex(
  slots: TabSlot[],
  fromIndex: number,
  offset: number
) {
  const from = slots[fromIndex];
  const left = from.left + offset;
  const right = left + from.width;

  return slots.filter((slot, index) => {
    const center = slot.left + slot.width / 2;
    if (index < fromIndex) return center < left;
    if (index > fromIndex) return center < right;
    return false;
  }).length;
}

/** How far a non-dragged tab moves aside to open a gap at the target. */
export function getTabShift(
  index: number,
  fromIndex: number,
  toIndex: number,
  draggedWidth: number
) {
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
    return -draggedWidth;
  }

  if (toIndex < fromIndex && index >= toIndex && index < fromIndex) {
    return draggedWidth;
  }

  return 0;
}

/** Offset from the dragged tab's original slot to its target slot. */
export function getDropOffset(
  slots: TabSlot[],
  fromIndex: number,
  toIndex: number
) {
  if (toIndex === fromIndex) return 0;

  if (toIndex > fromIndex) {
    return slots
      .slice(fromIndex + 1, toIndex + 1)
      .reduce((sum, slot) => sum + slot.width, 0);
  }

  return -slots
    .slice(toIndex, fromIndex)
    .reduce((sum, slot) => sum + slot.width, 0);
}

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * Applies a new order of the visible tabs to the full list, leaving tabs in
 * the overflow menu where they are.
 */
export function applyVisibleOrder(ids: string[], visibleOrder: string[]) {
  const visible = new Set(visibleOrder);
  const next = [...ids];
  let position = 0;

  ids.forEach((id, index) => {
    if (visible.has(id)) next[index] = visibleOrder[position++];
  });

  return next;
}
