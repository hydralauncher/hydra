import { useEffect, useState } from "react";
import type { FocusOverrides } from "../../services";
import {
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_PAGINATION_REGION_ID,
} from "./navigation";
import {
  getActivePositionsInRegion,
  getCatalogueFocusPosition,
  getClosestPositionInDirection,
} from "./navigation-geometry";

export function useCataloguePaginationNavigation(itemIds: string[]) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});
  const itemIdsKey = itemIds.join("\u0000");

  useEffect(() => {
    const ids = itemIdsKey ? itemIdsKey.split("\u0000") : [];

    if (!ids.length) {
      setOverridesByItemId({});
      return;
    }

    let animationFrameId = 0;
    const resizeObserver = new ResizeObserver(() => scheduleCompute());
    const mutationObserver = new MutationObserver(() => scheduleCompute());

    const computeOverrides = () => {
      const positions = ids
        .map((id) => getCatalogueFocusPosition(id))
        .filter((position) => !!position);
      const gridPositions = getActivePositionsInRegion(
        CATALOGUE_GRID_REGION_ID
      );
      const nextOverrides: Record<string, FocusOverrides> = {};

      positions.forEach((position, index) => {
        const upPosition = getClosestPositionInDirection(
          position,
          gridPositions,
          "up"
        );

        nextOverrides[position.id] = {
          left: positions[index - 1]
            ? { type: "item", itemId: positions[index - 1].id }
            : { type: "block" },
          right: positions[index + 1]
            ? { type: "item", itemId: positions[index + 1].id }
            : { type: "block" },
          up: upPosition
            ? { type: "item", itemId: upPosition.id }
            : { type: "block" },
          down: { type: "block" },
        };
      });

      setOverridesByItemId(nextOverrides);
    };

    function scheduleCompute() {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    }

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);

    [CATALOGUE_PAGINATION_REGION_ID, CATALOGUE_GRID_REGION_ID].forEach(
      (regionId) => {
        const element = globalThis.document.querySelector(
          `[data-focus-region-id="${regionId}"]`
        );

        if (!(element instanceof HTMLElement)) return;

        resizeObserver.observe(element);
        mutationObserver.observe(element, { childList: true, subtree: true });
      }
    );

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener("resize", scheduleCompute);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [itemIdsKey]);

  return overridesByItemId;
}
