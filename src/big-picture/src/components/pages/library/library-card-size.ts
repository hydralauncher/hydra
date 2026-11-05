export const LIBRARY_CARD_SIZES = ["small", "medium", "large"] as const;
export type LibraryCardSize = (typeof LIBRARY_CARD_SIZES)[number];

export const DEFAULT_LIBRARY_CARD_SIZE: LibraryCardSize = "medium";
export const LIBRARY_CARD_SIZE_STORAGE_KEY =
  "hydra:big-picture:library-card-size";

const GRID_COLUMN_OFFSET_BY_CARD_SIZE: Record<LibraryCardSize, number> = {
  small: 2,
  medium: 0,
  large: -1,
};

export function isLibraryCardSize(
  value: string | null | undefined
): value is LibraryCardSize {
  return (
    LIBRARY_CARD_SIZES as readonly (string | null | undefined)[]
  ).includes(value);
}

export function getLibraryGridColumnCount(
  baseColumnCount: number,
  cardSize: LibraryCardSize
) {
  return Math.max(
    1,
    baseColumnCount + GRID_COLUMN_OFFSET_BY_CARD_SIZE[cardSize]
  );
}
