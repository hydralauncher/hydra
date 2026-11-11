import {
  getLibraryGameOrderKey,
  type OrderableLibraryGame,
} from "./library-custom-order";

export const LIBRARY_CARD_SIZES_STORAGE_KEY = "library-card-sizes";
export const LIBRARY_MAX_CARD_ROWS = 3;

export interface LibraryCardSize {
  columns: number;
  rows: number;
}

export type LibraryCardSizes = Record<string, LibraryCardSize>;

export const DEFAULT_LIBRARY_CARD_SIZE: LibraryCardSize = {
  columns: 1,
  rows: 1,
};

const isSpan = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

export const readLibraryCardSizes = (
  storage: Pick<Storage, "getItem">
): LibraryCardSizes => {
  try {
    const saved = storage.getItem(LIBRARY_CARD_SIZES_STORAGE_KEY);
    if (!saved) return {};

    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const sizes: LibraryCardSizes = {};
    for (const [key, value] of Object.entries(parsed)) {
      const { columns, rows } = (value ?? {}) as Partial<LibraryCardSize>;
      if (isSpan(columns) && isSpan(rows)) {
        sizes[key] = {
          columns,
          rows: Math.min(rows, LIBRARY_MAX_CARD_ROWS),
        };
      }
    }
    return sizes;
  } catch {
    return {};
  }
};

export const writeLibraryCardSizes = (
  storage: Pick<Storage, "setItem">,
  sizes: LibraryCardSizes
) => {
  storage.setItem(LIBRARY_CARD_SIZES_STORAGE_KEY, JSON.stringify(sizes));
};

const getGameKeys = (game: OrderableLibraryGame) => [
  getLibraryGameOrderKey(game),
  ...(game.members ?? []).map(getLibraryGameOrderKey),
];

export const getLibraryCardSize = (
  sizes: LibraryCardSizes,
  game: OrderableLibraryGame
): LibraryCardSize => {
  for (const key of getGameKeys(game)) {
    const size = sizes[key];
    if (size) return size;
  }
  return DEFAULT_LIBRARY_CARD_SIZE;
};

export const setLibraryCardSize = (
  sizes: LibraryCardSizes,
  game: OrderableLibraryGame,
  size: LibraryCardSize
): LibraryCardSizes => {
  const next = { ...sizes };
  for (const key of getGameKeys(game)) delete next[key];

  if (size.columns > 1 || size.rows > 1) {
    next[getLibraryGameOrderKey(game)] = size;
  }
  return next;
};

export interface LibraryGridItem {
  key: string;
  columns: number;
  rows: number;
}

export interface LibraryGridPlacement extends LibraryGridItem {
  column: number;
  row: number;
}

export interface LibraryGridLayout {
  columnCount: number;
  rowCount: number;
  placements: LibraryGridPlacement[];
  placementByKey: Map<string, LibraryGridPlacement>;
  keyByCell: Map<number, string>;
}

export const packLibraryGrid = (
  items: readonly LibraryGridItem[],
  columnCount: number
): LibraryGridLayout => {
  const keyByCell = new Map<number, string>();
  const placements: LibraryGridPlacement[] = [];
  const placementByKey = new Map<string, LibraryGridPlacement>();
  const cellIndex = (row: number, column: number) => row * columnCount + column;
  let firstOpenRow = 0;
  let rowCount = 0;

  const fits = (row: number, column: number, width: number, height: number) => {
    for (let r = row; r < row + height; r++) {
      for (let c = column; c < column + width; c++) {
        if (keyByCell.has(cellIndex(r, c))) return false;
      }
    }
    return true;
  };

  const isRowFull = (row: number) => {
    for (let c = 0; c < columnCount; c++) {
      if (!keyByCell.has(cellIndex(row, c))) return false;
    }
    return true;
  };

  for (const item of items) {
    const columns = Math.min(Math.max(item.columns, 1), columnCount);
    const rows = Math.min(Math.max(item.rows, 1), LIBRARY_MAX_CARD_ROWS);

    let row = firstOpenRow;
    let column = -1;
    while (column === -1) {
      for (let c = 0; c + columns <= columnCount; c++) {
        if (fits(row, c, columns, rows)) {
          column = c;
          break;
        }
      }
      if (column === -1) row++;
    }

    for (let r = row; r < row + rows; r++) {
      for (let c = column; c < column + columns; c++) {
        keyByCell.set(cellIndex(r, c), item.key);
      }
    }

    const placement = { key: item.key, columns, rows, column, row };
    placements.push(placement);
    placementByKey.set(item.key, placement);
    rowCount = Math.max(rowCount, row + rows);

    while (isRowFull(firstOpenRow)) firstOpenRow++;
  }

  return { columnCount, rowCount, placements, placementByKey, keyByCell };
};

export interface LibraryGridMetrics {
  cellWidth: number;
  cellHeight: number;
  gap: number;
}

export const getLibraryPlacementBox = (
  placement: Pick<LibraryGridPlacement, "column" | "row" | "columns" | "rows">,
  { cellWidth, cellHeight, gap }: LibraryGridMetrics
) => ({
  left: placement.column * (cellWidth + gap),
  top: placement.row * (cellHeight + gap),
  width: placement.columns * cellWidth + (placement.columns - 1) * gap,
  height: placement.rows * cellHeight + (placement.rows - 1) * gap,
});

const SLOT_DEAD_ZONE_RATIO = 0.1;

export const findLibraryGridKeyAt = (
  layout: LibraryGridLayout,
  metrics: LibraryGridMetrics,
  x: number,
  y: number
): string | null => {
  const column = Math.floor(x / (metrics.cellWidth + metrics.gap));
  const row = Math.floor(y / (metrics.cellHeight + metrics.gap));
  if (column < 0 || column >= layout.columnCount || row < 0) return null;

  const key = layout.keyByCell.get(row * layout.columnCount + column);
  const placement = key ? layout.placementByKey.get(key) : undefined;
  if (!key || !placement) return null;

  const box = getLibraryPlacementBox(placement, metrics);
  const insetX = box.width * SLOT_DEAD_ZONE_RATIO;
  const insetY = box.height * SLOT_DEAD_ZONE_RATIO;
  const isInside =
    x >= box.left + insetX &&
    x <= box.left + box.width - insetX &&
    y >= box.top + insetY &&
    y <= box.top + box.height - insetY;

  return isInside ? key : null;
};
