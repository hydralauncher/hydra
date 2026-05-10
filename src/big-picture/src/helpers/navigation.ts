import type { FocusOverrideTarget } from "../services";

export function getItemFocusTarget(itemId: string): FocusOverrideTarget {
  return {
    type: "item",
    itemId,
  };
}

export function getOptionalItemFocusTarget(itemId?: string) {
  if (!itemId) return undefined;

  return getItemFocusTarget(itemId);
}
