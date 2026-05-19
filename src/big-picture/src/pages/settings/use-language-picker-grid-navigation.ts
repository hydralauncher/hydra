import { getItemFocusTarget } from "../../helpers";
import type { FocusOverrides } from "../../services";

interface GridItemCoordinates {
  rowIndex: number;
  columnIndex: number;
}

interface LanguagePickerGridNavigation {
  overridesByItemId: Record<string, FocusOverrides>;
  coordinatesByItemId: Record<string, GridItemCoordinates>;
}

interface BuildLanguagePickerGridNavigationOptions {
  itemIds: string[];
  searchInputId: string;
  columnCount: number;
}

function getCoordinates(
  index: number,
  columnCount: number
): GridItemCoordinates {
  return {
    rowIndex: Math.floor(index / columnCount),
    columnIndex: index % columnCount,
  };
}

function getItemIdAt(
  itemIds: string[],
  rowIndex: number,
  columnIndex: number,
  columnCount: number
) {
  const index = rowIndex * columnCount + columnIndex;
  return itemIds[index] ?? null;
}

function getDownTargetId(options: {
  itemIds: string[];
  rowIndex: number;
  columnIndex: number;
  columnCount: number;
}) {
  const nextRowIndex = options.rowIndex + 1;
  const nextRowStartIndex = nextRowIndex * options.columnCount;

  if (nextRowStartIndex >= options.itemIds.length) {
    return null;
  }

  const preferredTarget = getItemIdAt(
    options.itemIds,
    nextRowIndex,
    options.columnIndex,
    options.columnCount
  );

  if (preferredTarget) {
    return preferredTarget;
  }

  const nextRowEndExclusive = Math.min(
    nextRowStartIndex + options.columnCount,
    options.itemIds.length
  );
  const nextRowItemIds = options.itemIds.slice(
    nextRowStartIndex,
    nextRowEndExclusive
  );

  return nextRowItemIds.at(-1) ?? null;
}

export function buildLanguagePickerGridNavigation({
  itemIds,
  searchInputId,
  columnCount,
}: Readonly<BuildLanguagePickerGridNavigationOptions>) {
  const overridesByItemId: Record<string, FocusOverrides> = {};
  const coordinatesByItemId: Record<string, GridItemCoordinates> = {};

  itemIds.forEach((itemId, index) => {
    const { rowIndex, columnIndex } = getCoordinates(index, columnCount);
    const leftItemId =
      columnIndex > 0
        ? getItemIdAt(itemIds, rowIndex, columnIndex - 1, columnCount)
        : null;
    const rightItemId =
      columnIndex < columnCount - 1
        ? getItemIdAt(itemIds, rowIndex, columnIndex + 1, columnCount)
        : null;
    const upItemId =
      rowIndex > 0
        ? getItemIdAt(itemIds, rowIndex - 1, columnIndex, columnCount)
        : null;
    const downItemId = getDownTargetId({
      itemIds,
      rowIndex,
      columnIndex,
      columnCount,
    });

    overridesByItemId[itemId] = {
      left: leftItemId ? getItemFocusTarget(leftItemId) : { type: "block" },
      right: rightItemId ? getItemFocusTarget(rightItemId) : { type: "block" },
      up: upItemId
        ? getItemFocusTarget(upItemId)
        : getItemFocusTarget(searchInputId),
      down: downItemId ? getItemFocusTarget(downItemId) : { type: "block" },
    };

    coordinatesByItemId[itemId] = {
      rowIndex,
      columnIndex,
    };
  });

  return {
    overridesByItemId,
    coordinatesByItemId,
  } satisfies LanguagePickerGridNavigation;
}

export function findLanguagePickerReplacementFocusId(options: {
  itemIds: string[];
  coordinatesByItemId: Record<string, GridItemCoordinates>;
  previousCoordinates?: GridItemCoordinates;
}) {
  if (options.itemIds.length === 0) return null;

  if (!options.previousCoordinates) {
    return options.itemIds[0] ?? null;
  }

  const sameColumnCandidates = options.itemIds.filter((itemId) => {
    return (
      options.coordinatesByItemId[itemId]?.columnIndex ===
      options.previousCoordinates?.columnIndex
    );
  });

  if (sameColumnCandidates.length === 0) {
    return options.itemIds[0] ?? null;
  }

  return sameColumnCandidates.sort((leftItemId, rightItemId) => {
    const leftCoordinates = options.coordinatesByItemId[leftItemId];
    const rightCoordinates = options.coordinatesByItemId[rightItemId];

    return (
      Math.abs(
        leftCoordinates.rowIndex - options.previousCoordinates!.rowIndex
      ) -
      Math.abs(
        rightCoordinates.rowIndex - options.previousCoordinates!.rowIndex
      )
    );
  })[0];
}
