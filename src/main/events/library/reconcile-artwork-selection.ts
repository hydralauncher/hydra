import type {
  ArtworkAssetType,
  GameArtworkSelection,
  SelectedArtwork,
} from "@types";

export interface ArtworkSelectionUpdate {
  type: ArtworkAssetType;
  previousUrl?: string | null;
  nextUrl?: string | null;
  artworkId?: number | null;
  clear?: boolean;
}

export const reconcileArtworkSelection = (
  current: GameArtworkSelection["selected"],
  updates: ArtworkSelectionUpdate[]
): {
  selected: Partial<Record<ArtworkAssetType, SelectedArtwork>>;
  changed: boolean;
} => {
  const selected = { ...current };
  let changed = false;

  for (const { type, previousUrl, nextUrl, artworkId, clear } of updates) {
    if (clear) {
      if (selected[type]) {
        delete selected[type];
        changed = true;
      }
      continue;
    }

    if (
      nextUrl === undefined ||
      nextUrl === previousUrl ||
      (nextUrl == null && previousUrl == null)
    ) {
      continue;
    }

    if (nextUrl?.startsWith("local:") && typeof artworkId === "number") {
      selected[type] = { url: nextUrl, artworkId };
      changed = true;
      continue;
    }

    if (selected[type]) {
      delete selected[type];
      changed = true;
    }
  }

  return { selected, changed };
};
