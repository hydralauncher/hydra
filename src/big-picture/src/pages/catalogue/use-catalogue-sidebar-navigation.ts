import { useCallback, useMemo } from "react";
import { useNavigationActions, useNavigationScreenActions } from "../../hooks";
import { useNavigationStore } from "../../stores";
import type {
  CatalogueFilterListAlignment,
  CatalogueFilterListItem,
} from "./filter-list";
import {
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_SORT_SELECT_ID,
  isCatalogueGridFocusId,
} from "./navigation";
import {
  type CatalogueFocusPosition,
  getClosestPositionInDirection,
} from "./navigation-geometry";
import type { FilterType } from "./use-catalogue-data";

interface CatalogueSidebarNavigationSection {
  key: FilterType;
  headerFocusId: string;
  inputFocusId: string;
  isOpen: boolean;
  items: CatalogueFilterListItem[];
  focusItem: (
    index: number,
    alignment?: CatalogueFilterListAlignment
  ) => boolean;
}

interface DirectFocusTarget {
  type: "direct";
  id: string;
}

interface FilterItemFocusTarget {
  type: "filter-item";
  id: string;
  sectionKey: FilterType;
  index: number;
  focusItem: CatalogueSidebarNavigationSection["focusItem"];
}

type SidebarFocusTarget = DirectFocusTarget | FilterItemFocusTarget;
type VerticalDirection = "up" | "down";

export function useCatalogueSidebarNavigation(
  sections: CatalogueSidebarNavigationSection[]
) {
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const navigationNodes = useNavigationStore((state) => state.nodes);
  const { moveFocus, setFocus } = useNavigationActions();

  const targets = useMemo(() => {
    return sections.flatMap<SidebarFocusTarget>((section) => {
      const sectionTargets: SidebarFocusTarget[] = [
        { type: "direct", id: section.headerFocusId },
      ];

      if (!section.isOpen) {
        return sectionTargets;
      }

      sectionTargets.push({ type: "direct", id: section.inputFocusId });
      sectionTargets.push(
        ...section.items.map((item, index) => ({
          type: "filter-item" as const,
          id: item.focusId,
          sectionKey: section.key,
          index,
          focusItem: section.focusItem,
        }))
      );

      return sectionTargets;
    });
  }, [sections]);

  const currentTargetIndex = targets.findIndex(
    (target) => target.id === currentFocusId
  );
  const hasSidebarFocus = currentTargetIndex >= 0;

  const moveWithinSidebar = useCallback(
    (direction: VerticalDirection) => {
      const step = direction === "down" ? 1 : -1;
      const nextTarget = targets[currentTargetIndex + step];
      const currentTarget = targets[currentTargetIndex];

      if (!currentTarget || !nextTarget) {
        if (direction === "up" && currentTargetIndex === 0) {
          setFocus(CATALOGUE_SORT_SELECT_ID);
          return;
        }

        moveFocus(direction);
        return;
      }

      if (nextTarget.type === "direct") {
        setFocus(nextTarget.id);
        return;
      }

      const continuesInSameList =
        currentTarget.type === "filter-item" &&
        currentTarget.sectionKey === nextTarget.sectionKey;
      const alignment: CatalogueFilterListAlignment = continuesInSameList
        ? "auto"
        : direction === "down"
          ? "top"
          : "bottom";

      if (!nextTarget.focusItem(nextTarget.index, alignment)) {
        setFocus(nextTarget.id);
      }
    },
    [currentTargetIndex, moveFocus, setFocus, targets]
  );

  const moveToGrid = useCallback(
    (sourceFocusId: string) => {
      const currentElement = navigationNodes
        .find((node) => node.id === sourceFocusId)
        ?.getElement();

      if (!currentElement) return;

      const currentRect = currentElement.getBoundingClientRect();
      if (currentRect.width <= 0 || currentRect.height <= 0) return;
      const currentPosition: CatalogueFocusPosition = {
        id: sourceFocusId,
        rect: currentRect,
      };
      const gridPositions = navigationNodes
        .filter(
          (node) =>
            node.regionId === CATALOGUE_GRID_REGION_ID &&
            node.navigationState === "active" &&
            isCatalogueGridFocusId(node.id)
        )
        .map((node) => {
          const element = node.getElement();
          const rect = element?.getBoundingClientRect();

          if (!rect || rect.width <= 0 || rect.height <= 0) return null;

          return { id: node.id, rect };
        })
        .filter(
          (position): position is CatalogueFocusPosition => position !== null
        );
      const gridPosition = getClosestPositionInDirection(
        currentPosition,
        gridPositions,
        "left"
      );

      if (gridPosition) {
        setFocus(gridPosition.id);
      }
    },
    [navigationNodes, setFocus]
  );

  useNavigationScreenActions({
    direction: {
      left: ({ currentFocusId: activeFocusId }) => {
        const hasFilterFocus = targets.some(
          (target) => target.id === activeFocusId
        );

        if (activeFocusId && hasFilterFocus) {
          moveToGrid(activeFocusId);
          return;
        }

        moveFocus("left");
      },
      ...(hasSidebarFocus
        ? {
            up: () => moveWithinSidebar("up"),
            down: () => moveWithinSidebar("down"),
          }
        : {}),
    },
  });
}
