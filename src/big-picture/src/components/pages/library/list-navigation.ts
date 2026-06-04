import type { LibraryGame } from "@types";
import type { FocusOverrides } from "../../../services";
import { useEffect, useMemo, useState } from "react";
import {
  getLibraryFocusListItemId,
  LIBRARY_FILTERS_TABS_REGION_ID,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "./navigation";

interface ListItemPosition {
  id: string;
  top: number;
  left: number;
  centerX: number;
}

const ROW_TOLERANCE_PX = 24;

function groupItemsIntoRows(items: ListItemPosition[]) {
  const sortedItems = [...items].sort((a, b) => {
    if (Math.abs(a.top - b.top) > ROW_TOLERANCE_PX) {
      return a.top - b.top;
    }

    return a.left - b.left;
  });

  return sortedItems.reduce<ListItemPosition[][]>((rows, item) => {
    const lastRow = rows.at(-1);

    if (!lastRow || Math.abs(lastRow[0].top - item.top) > ROW_TOLERANCE_PX) {
      rows.push([item]);
      return rows;
    }

    lastRow.push(item);
    lastRow.sort((leftItem, rightItem) => leftItem.left - rightItem.left);
    return rows;
  }, []);
}

function getClosestItemByCenterX(
  items: ListItemPosition[] | undefined,
  centerX: number
) {
  if (!items?.length) return null;

  return [...items].sort((leftItem, rightItem) => {
    return (
      Math.abs(leftItem.centerX - centerX) -
      Math.abs(rightItem.centerX - centerX)
    );
  })[0];
}

function buildFocusOverridesForListItem(
  item: ListItemPosition,
  row: ListItemPosition[],
  itemIndex: number,
  rowIndex: number,
  rows: ListItemPosition[][]
): FocusOverrides {
  const leftItem = row[itemIndex - 1];
  const rightItem = row[itemIndex + 1];
  const upItem = getClosestItemByCenterX(rows[rowIndex - 1], item.centerX);
  const downItem = getClosestItemByCenterX(rows[rowIndex + 1], item.centerX);

  return {
    ...(leftItem
      ? {
          left: {
            type: "item",
            itemId: leftItem.id,
          },
        }
      : {}),
    ...(rightItem
      ? {
          right: {
            type: "item",
            itemId: rightItem.id,
          },
        }
      : {
          right: {
            type: "block",
          },
        }),
    ...(upItem
      ? {
          up: {
            type: "item",
            itemId: upItem.id,
          },
        }
      : {
          up: {
            type: "region",
            regionId: LIBRARY_FILTERS_TABS_REGION_ID,
            entryDirection: "down",
          },
        }),
    ...(downItem
      ? {
          down: {
            type: "item",
            itemId: downItem.id,
          },
        }
      : {
          down: {
            type: "block",
          },
        }),
  };
}

function buildOverridesMapFromRows(rows: ListItemPosition[][]) {
  const nextOverridesByItemId: Record<string, FocusOverrides> = {};

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    for (let itemIndex = 0; itemIndex < row.length; itemIndex++) {
      const item = row[itemIndex];
      nextOverridesByItemId[item.id] = buildFocusOverridesForListItem(
        item,
        row,
        itemIndex,
        rowIndex,
        rows
      );
    }
  }

  return nextOverridesByItemId;
}

export function useLibraryListNavigation(games: LibraryGame[]) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});

  const itemIds = useMemo(() => {
    return games.map((game) => getLibraryFocusListItemId(game.id));
  }, [games]);

  useEffect(() => {
    if (itemIds.length === 0) {
      setOverridesByItemId({});
      return;
    }

    let animationFrameId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const computeOverrides = () => {
      const items = itemIds
        .map((id) => {
          const element = globalThis.document.getElementById(id);
          const rect = element?.getBoundingClientRect();

          if (!element || !rect) return null;

          return {
            id,
            top: rect.top,
            left: rect.left,
            centerX: rect.left + rect.width / 2,
          };
        })
        .filter((item): item is ListItemPosition => item !== null);

      const rows = groupItemsIntoRows(items);
      setOverridesByItemId(buildOverridesMapFromRows(rows));
    };

    const scheduleCompute = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    };

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    const listElement = globalThis.document.querySelector(
      `[data-focus-region-id="${LIBRARY_FOCUS_LIST_REGION_ID}"]`
    );

    if (listElement instanceof HTMLElement) {
      resizeObserver = new ResizeObserver(scheduleCompute);
      resizeObserver.observe(listElement);

      itemIds.forEach((id) => {
        const itemElement = globalThis.document.getElementById(id);

        if (!itemElement) return;

        resizeObserver?.observe(itemElement);
      });
    }

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener("resize", scheduleCompute);
      resizeObserver?.disconnect();
    };
  }, [itemIds]);

  return overridesByItemId;
}
