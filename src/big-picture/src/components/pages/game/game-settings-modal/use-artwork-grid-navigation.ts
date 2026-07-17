import { useEffect, useState } from "react";

import type { FocusOverrides } from "../../../../services";
import {
  getClosestItemByCenterX,
  groupItemsIntoRows,
} from "../../../../helpers/row-navigation-utils";

interface GridItemPosition {
  id: string;
  top: number;
  left: number;
  centerX: number;
}

function buildOverrides(
  rows: GridItemPosition[][],
  exitUpFocusId: string
): Record<string, FocusOverrides> {
  const overrides: Record<string, FocusOverrides> = {};

  rows.forEach((row, rowIndex) => {
    row.forEach((item, itemIndex) => {
      const leftItem = row[itemIndex - 1];
      const rightItem = row[itemIndex + 1];
      const upItem = getClosestItemByCenterX(rows[rowIndex - 1], item.centerX);
      const downItem = getClosestItemByCenterX(
        rows[rowIndex + 1],
        item.centerX
      );

      overrides[item.id] = {
        left: leftItem
          ? { type: "item", itemId: leftItem.id }
          : { type: "block" },
        right: rightItem
          ? { type: "item", itemId: rightItem.id }
          : { type: "block" },
        up: upItem
          ? { type: "item", itemId: upItem.id }
          : { type: "item", itemId: exitUpFocusId },
        down: downItem
          ? { type: "item", itemId: downItem.id }
          : { type: "block" },
      };
    });
  });

  return overrides;
}

export function useArtworkGridNavigation(
  itemIds: string[],
  exitUpFocusId: string
) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});
  const itemIdsKey = itemIds.join("\0");

  useEffect(() => {
    const ids = itemIdsKey ? itemIdsKey.split("\0") : [];

    if (ids.length === 0) {
      setOverridesByItemId({});
      return;
    }

    let animationFrameId = 0;

    const computeOverrides = () => {
      const items = ids
        .map((id) => {
          const element = globalThis.document.getElementById(id);
          if (!element) return null;

          const rect = element.getBoundingClientRect();
          return {
            id,
            top: rect.top,
            left: rect.left,
            centerX: rect.left + rect.width / 2,
          } satisfies GridItemPosition;
        })
        .filter((position): position is GridItemPosition => position !== null);

      const rows = groupItemsIntoRows(items);
      setOverridesByItemId(buildOverrides(rows, exitUpFocusId));
    };

    const scheduleCompute = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    };

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener("resize", scheduleCompute);
    };
  }, [itemIdsKey, exitUpFocusId]);

  return overridesByItemId;
}
