import { useEffect, useMemo, useState } from "react";
import type { FocusOverrides } from "../../services";
import {
  getHomeChallengeGameItemId,
  HOME_HARD_PLATINUMS_GRID_REGION_ID,
} from "./navigation";
import type { HomeChallengeGame } from "./home-data";

interface GridItemPosition {
  id: string;
  top: number;
  left: number;
  centerX: number;
}

const ROW_TOLERANCE_PX = 24;

function groupItemsIntoRows(items: GridItemPosition[]) {
  const sortedItems = [...items].sort((a, b) => {
    if (Math.abs(a.top - b.top) > ROW_TOLERANCE_PX) {
      return a.top - b.top;
    }

    return a.left - b.left;
  });

  return sortedItems.reduce<GridItemPosition[][]>((rows, item) => {
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
  items: GridItemPosition[] | undefined,
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

function buildFocusOverridesForGridItem(
  item: GridItemPosition,
  row: GridItemPosition[],
  itemIndex: number,
  rowIndex: number,
  rows: GridItemPosition[][],
  fallbackUpRegionId: string
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
            regionId: fallbackUpRegionId,
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

function buildOverridesMapFromRows(
  rows: GridItemPosition[][],
  fallbackUpRegionId: string
) {
  const nextOverridesByItemId: Record<string, FocusOverrides> = {};

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    for (let itemIndex = 0; itemIndex < row.length; itemIndex++) {
      const item = row[itemIndex];
      nextOverridesByItemId[item.id] = buildFocusOverridesForGridItem(
        item,
        row,
        itemIndex,
        rowIndex,
        rows,
        fallbackUpRegionId
      );
    }
  }

  return nextOverridesByItemId;
}

export function useHomeChallengeGridNavigation(
  games: HomeChallengeGame[],
  fallbackUpRegionId: string
) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});

  const itemIds = useMemo(() => {
    return games.map((game) => getHomeChallengeGameItemId(game));
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
        .filter((item): item is GridItemPosition => item !== null);

      const rows = groupItemsIntoRows(items);
      setOverridesByItemId(buildOverridesMapFromRows(rows, fallbackUpRegionId));
    };

    const scheduleCompute = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    };

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    const gridElement = globalThis.document.querySelector(
      `[data-focus-region-id="${HOME_HARD_PLATINUMS_GRID_REGION_ID}"]`
    );

    if (gridElement instanceof HTMLElement) {
      resizeObserver = new ResizeObserver(scheduleCompute);
      resizeObserver.observe(gridElement);

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
  }, [fallbackUpRegionId, itemIds]);

  return overridesByItemId;
}
