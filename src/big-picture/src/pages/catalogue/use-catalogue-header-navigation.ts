import { useEffect, useState } from "react";
import { BIG_PICTURE_HEADER_REGION_ID } from "../../layout";
import type { FocusOverrides } from "../../services";
import {
  CATALOGUE_FILTERS_BUTTON_ID,
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_HEADER_CONTROLS_REGION_ID,
  CATALOGUE_SORT_SELECT_ID,
} from "./navigation";
import {
  getActivePositionsInRegion,
  getCatalogueFocusPosition,
  getClosestPositionInDirection,
} from "./navigation-geometry";

export function useCatalogueHeaderNavigation(itemIds: string[]) {
  const [overridesByItemId, setOverridesByItemId] = useState<
    Record<string, FocusOverrides>
  >({});
  const itemIdsKey = itemIds.join("\u0000");

  useEffect(() => {
    const ids = itemIdsKey ? itemIdsKey.split("\u0000") : [];
    let animationFrameId = 0;

    const computeOverrides = () => {
      const positions = ids
        .map((id) => getCatalogueFocusPosition(id))
        .filter((position) => !!position);
      const chipAndClearPositions = positions.filter(
        (position) =>
          position.id !== CATALOGUE_FILTERS_BUTTON_ID &&
          position.id !== CATALOGUE_SORT_SELECT_ID
      );
      const gridPositions = getActivePositionsInRegion(
        CATALOGUE_GRID_REGION_ID
      );
      const nextOverrides: Record<string, FocusOverrides> = {};

      positions.forEach((position) => {
        const leftPosition = getClosestPositionInDirection(
          position,
          positions,
          "left"
        );
        const rightPosition = getClosestPositionInDirection(
          position,
          positions,
          "right"
        );
        const gridPosition = getClosestPositionInDirection(
          position,
          gridPositions,
          "down"
        );

        if (
          position.id === CATALOGUE_FILTERS_BUTTON_ID ||
          position.id === CATALOGUE_SORT_SELECT_ID
        ) {
          nextOverrides[position.id] = {
            left: leftPosition
              ? { type: "item", itemId: leftPosition.id }
              : { type: "block" },
            right:
              position.id === CATALOGUE_SORT_SELECT_ID || !rightPosition
                ? { type: "block" }
                : { type: "item", itemId: rightPosition.id },
            up: {
              type: "region",
              regionId: BIG_PICTURE_HEADER_REGION_ID,
              entryDirection: "down",
            },
            down: gridPosition
              ? { type: "item", itemId: gridPosition.id }
              : { type: "block" },
          };
          return;
        }

        const upPosition = getClosestPositionInDirection(
          position,
          chipAndClearPositions,
          "up"
        );
        const downPosition = getClosestPositionInDirection(
          position,
          chipAndClearPositions,
          "down"
        );
        nextOverrides[position.id] = {
          left: leftPosition
            ? { type: "item", itemId: leftPosition.id }
            : { type: "block" },
          right: rightPosition
            ? { type: "item", itemId: rightPosition.id }
            : { type: "block" },
          up: upPosition
            ? { type: "item", itemId: upPosition.id }
            : {
                type: "region",
                regionId: BIG_PICTURE_HEADER_REGION_ID,
                entryDirection: "down",
              },
          down: downPosition
            ? { type: "item", itemId: downPosition.id }
            : gridPosition
              ? { type: "item", itemId: gridPosition.id }
              : { type: "block" },
        };
      });

      setOverridesByItemId(nextOverrides);
    };

    const scheduleCompute = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(computeOverrides);
    };

    scheduleCompute();
    globalThis.addEventListener("resize", scheduleCompute);
    const resizeObserver = new ResizeObserver(scheduleCompute);
    const mutationObserver = new MutationObserver(scheduleCompute);

    [CATALOGUE_HEADER_CONTROLS_REGION_ID, CATALOGUE_GRID_REGION_ID].forEach(
      (regionId) => {
        const element = globalThis.document.querySelector(
          `[data-focus-region-id="${regionId}"]`
        );

        if (!(element instanceof HTMLElement)) return;

        resizeObserver.observe(element);
        mutationObserver.observe(element, {
          childList: true,
          subtree: true,
        });
      }
    );

    ids.forEach((id) => {
      const itemElement = globalThis.document.getElementById(id);

      if (itemElement) {
        resizeObserver.observe(itemElement);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener("resize", scheduleCompute);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [itemIdsKey]);

  return overridesByItemId;
}
