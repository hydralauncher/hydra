import type { LibraryGame } from "@types";
import { useEffect, useMemo, useState } from "react";
import type { FocusOverrides } from "../../../services";
import { LIBRARY_FILTERS_TOOLBAR_REGION_ID } from "./navigation";
import {
  groupItemsIntoRows,
  getClosestItemByCenterX,
} from "../../../helpers/row-navigation-utils";

interface ItemPosition {
  id: string;
  top: number;
  left: number;
  centerX: number;
}

interface UseMeasuredRowNavigationParams {
  games: LibraryGame[];
  getItemId: (gameId: string) => string;
  regionId: string;
}

function buildFocusOverridesForItem(
  item: ItemPosition,
  row: ItemPosition[],
  itemIndex: number,
  rowIndex: number,
  rows: ItemPosition[][]
): FocusOverrides {
  const leftItem = row[itemIndex - 1];
  const rightItem = row[itemIndex + 1];
  const upItem = getClosestItemByCenterX(rows[rowIndex - 1], item.centerX);
  const downItem = getClosestItemByCenterX(rows[rowIndex + 1], item.centerX);

  return {
    ...(leftItem
      ? {
          left: {
            type: "item" as const,
            itemId: leftItem.id,
          },
        }
      : {}),
    ...(rightItem
      ? {
          right: {
            type: "item" as const,
            itemId: rightItem.id,
          },
        }
      : {
          right: {
            type: "block" as const,
          },
        }),
    ...(upItem
      ? {
          up: {
            type: "item" as const,
            itemId: upItem.id,
          },
        }
      : {
          up: {
            type: "region" as const,
            regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
            entryDirection: "down" as const,
          },
        }),
    ...(downItem
      ? {
          down: {
            type: "item" as const,
            itemId: downItem.id,
          },
        }
      : {
          down: {
            type: "block" as const,
          },
        }),
  };
}

function buildOverridesMapFromRows(rows: ItemPosition[][]) {
  const nextOverridesByItemId: Record<string, FocusOverrides> = {};

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    for (let itemIndex = 0; itemIndex < row.length; itemIndex++) {
      const item = row[itemIndex];
      nextOverridesByItemId[item.id] = buildFocusOverridesForItem(
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

export function useMeasuredRowNavigation({
  games,
  getItemId,
  regionId,
}: Readonly<UseMeasuredRowNavigationParams>) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});

  const itemIds = useMemo(() => {
    return games.map((game) => getItemId(game.id));
  }, [games, getItemId]);

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
        .filter((item): item is ItemPosition => item !== null);

      const rows = groupItemsIntoRows(items);
      setOverridesByItemId(buildOverridesMapFromRows(rows));
    };

    const scheduleCompute = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    };

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    const containerElement = globalThis.document.querySelector(
      `[data-focus-region-id="${regionId}"]`
    );

    if (containerElement instanceof HTMLElement) {
      resizeObserver = new ResizeObserver(scheduleCompute);
      resizeObserver.observe(containerElement);

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
  }, [itemIds, regionId]);

  return overridesByItemId;
}
