import type { LibraryGame } from "@types";
import type { FocusOverrides } from "../../../services";
import { LIBRARY_FILTERS_TOOLBAR_REGION_ID } from "./navigation.js";

export interface LibraryNavigationModel {
  rows: LibraryGame[][];
  rowByItemId: Map<string, number>;
  overridesByItemId: Record<string, FocusOverrides>;
  firstItemId: string | null;
}

function itemOverride(itemId: string) {
  return { type: "item" as const, itemId };
}

export function buildLibraryNavigationModel(
  games: LibraryGame[],
  columnCount: number,
  getItemId: (gameId: string) => string
): LibraryNavigationModel {
  const safeColumnCount = Math.max(1, columnCount);
  const rows = Array.from(
    { length: Math.ceil(games.length / safeColumnCount) },
    (_, rowIndex) =>
      games.slice(rowIndex * safeColumnCount, (rowIndex + 1) * safeColumnCount)
  );
  const overridesByItemId: Record<string, FocusOverrides> = {};
  const rowByItemId = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const previousRow = rows[rowIndex - 1];
    const nextRow = rows[rowIndex + 1];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      const game = row[columnIndex];
      const itemId = getItemId(game.id);
      const leftItem = row[columnIndex - 1];
      const rightItem = row[columnIndex + 1];
      const upItem =
        previousRow?.[Math.min(columnIndex, previousRow.length - 1)];
      const downItem = nextRow?.[Math.min(columnIndex, nextRow.length - 1)];

      rowByItemId.set(itemId, rowIndex);

      overridesByItemId[itemId] = {
        ...(leftItem
          ? {
              left: itemOverride(getItemId(leftItem.id)),
            }
          : {}),
        right: rightItem
          ? itemOverride(getItemId(rightItem.id))
          : { type: "block" },
        up: upItem
          ? itemOverride(getItemId(upItem.id))
          : {
              type: "region",
              regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
              entryDirection: "down",
            },
        down: downItem
          ? itemOverride(getItemId(downItem.id))
          : { type: "block" },
      };
    }
  }

  return {
    rows,
    rowByItemId,
    overridesByItemId,
    firstItemId: games[0] ? getItemId(games[0].id) : null,
  };
}
