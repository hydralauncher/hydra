export interface LibraryGridPlacement {
  key: string;
  row: number;
  column: number;
}

export interface LibraryGridLayout {
  columnCount: number;
  rowCount: number;
  placements: LibraryGridPlacement[];
}

export interface LibraryGridMetrics {
  cellWidth: number;
  cellHeight: number;
  gap: number;
}

export const layoutLibraryGrid = (
  keys: readonly string[],
  columnCount: number
): LibraryGridLayout => ({
  columnCount,
  rowCount: Math.ceil(keys.length / columnCount),
  placements: keys.map((key, index) => ({
    key,
    row: Math.floor(index / columnCount),
    column: index % columnCount,
  })),
});

export const getLibraryPlacementBox = (
  placement: Pick<LibraryGridPlacement, "row" | "column">,
  { cellWidth, cellHeight, gap }: LibraryGridMetrics
) => ({
  left: placement.column * (cellWidth + gap),
  top: placement.row * (cellHeight + gap),
  width: cellWidth,
  height: cellHeight,
});

export const findLibraryGridKeyAt = (
  layout: LibraryGridLayout,
  metrics: LibraryGridMetrics,
  x: number,
  y: number
): string | null => {
  const column = Math.floor(x / (metrics.cellWidth + metrics.gap));
  const row = Math.floor(y / (metrics.cellHeight + metrics.gap));
  if (column < 0 || column >= layout.columnCount || row < 0) return null;

  return layout.placements[row * layout.columnCount + column]?.key ?? null;
};
