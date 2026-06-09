import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import List, { type ListRef } from "rc-virtual-list";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { Input, SidebarModal, Typography } from "../../components";
import { useNavigationActions, useNavigationScreenActions } from "../../hooks";
import { useNavigationStore } from "../../stores";
import {
  type CatalogueFilterListAlignment,
  type CatalogueFilterListItem,
  getCatalogueFilterListItems,
} from "./filter-list";
import { CatalogueFilterCheckbox } from "./filter-checkbox";
import {
  type CatalogueData,
  FilterType,
  type SearchGamesFormValues,
} from "./use-catalogue-data";

const CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX = "catalogue-filters-modal";
const CATALOGUE_FILTERS_MODAL_SELECTED_FOCUS_PREFIX =
  "catalogue-filters-modal-selected";
const CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT = 56;
const CATALOGUE_FILTERS_MODAL_FALLBACK_VISIBLE_ITEMS = 8;
const CATALOGUE_FILTERS_MODAL_SCROLL_DURATION_MS = 180;
const CATALOGUE_FILTERS_MODAL_FADE_SWAP_DELAY_MS = 140;

function getCatalogueFiltersModalInputFocusId(filterType: FilterType) {
  return `${CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX}:input:${filterType}`;
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function animateCatalogueFiltersModalScroll(
  listRef: RefObject<ListRef | null>,
  animationFrameRef: MutableRefObject<number | null>,
  targetTop: number
) {
  if (animationFrameRef.current !== null) {
    globalThis.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }

  const list = listRef.current;

  if (!list) return;

  const startTop = list.getScrollInfo().y;
  const distanceTop = targetTop - startTop;

  if (distanceTop === 0) return;

  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(
      Math.max(elapsed / CATALOGUE_FILTERS_MODAL_SCROLL_DURATION_MS, 0),
      1
    );
    const easedProgress = easeOutCubic(progress);

    listRef.current?.scrollTo({
      top: startTop + distanceTop * easedProgress,
    });

    if (progress < 1) {
      animationFrameRef.current = globalThis.requestAnimationFrame(step);
      return;
    }

    listRef.current?.scrollTo({ top: targetTop });
    animationFrameRef.current = null;
  };

  animationFrameRef.current = globalThis.requestAnimationFrame(step);
}

interface CatalogueFiltersModalProps {
  visible: boolean;
  catalogueData: CatalogueData;
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
  onClose: () => void;
}

interface CatalogueFiltersModalListProps {
  items: CatalogueFilterListItem[];
  name: FilterType;
  color: string;
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
}

interface CatalogueFiltersModalListHandle {
  focusItem: (
    index: number,
    alignment?: CatalogueFilterListAlignment
  ) => boolean;
  focusItemCentered: (index: number) => boolean;
}

interface SelectedCatalogueFilterItem extends CatalogueFilterListItem {
  filterType: FilterType;
  color: string;
}

function useCatalogueFiltersModalNavigation({
  visible,
  activeFilterType,
  searchFocusId,
  items,
  selectedItems,
  focusItem,
  focusItemCentered,
}: {
  visible: boolean;
  activeFilterType: FilterType;
  searchFocusId: string;
  items: CatalogueFilterListItem[];
  selectedItems: SelectedCatalogueFilterItem[];
  focusItem: CatalogueFiltersModalListHandle["focusItem"];
  focusItemCentered: CatalogueFiltersModalListHandle["focusItemCentered"];
}) {
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const { moveFocus, setFocus } = useNavigationActions();

  const currentItemIndex = items.findIndex(
    (item) => item.focusId === currentFocusId
  );
  const currentSelectedIndex = selectedItems.findIndex(
    (item) => item.focusId === currentFocusId
  );
  const hasSearchFocus = currentFocusId === searchFocusId;
  const hasItemFocus = currentItemIndex >= 0;
  const hasSelectedFocus = currentSelectedIndex >= 0;
  const hasMainFocus = visible && (hasSearchFocus || hasItemFocus);
  const hasSelectedSidebarFocus = visible && hasSelectedFocus;

  const moveWithinModalList = useCallback(
    (direction: "up" | "down") => {
      if (hasSelectedFocus) {
        const nextIndex =
          currentSelectedIndex + (direction === "down" ? 1 : -1);
        const nextItem = selectedItems[nextIndex];

        if (nextItem) {
          setFocus(nextItem.focusId);
        }
        return;
      }

      if (hasSearchFocus) {
        if (direction === "down" && items.length > 0) {
          focusItem(0, "top");
          return;
        }

        moveFocus(direction);
        return;
      }

      if (!hasItemFocus) {
        moveFocus(direction);
        return;
      }

      const nextIndex = currentItemIndex + (direction === "down" ? 1 : -1);

      if (nextIndex < 0) {
        setFocus(searchFocusId);
        return;
      }

      const nextItem = items[nextIndex];

      if (!nextItem) {
        moveFocus(direction);
        return;
      }

      if (!focusItemCentered(nextIndex)) {
        setFocus(nextItem.focusId);
      }
    },
    [
      currentItemIndex,
      currentSelectedIndex,
      focusItem,
      focusItemCentered,
      hasItemFocus,
      hasSearchFocus,
      hasSelectedFocus,
      items,
      moveFocus,
      searchFocusId,
      selectedItems,
      setFocus,
    ]
  );

  const moveHorizontallyWithinModal = useCallback(
    (direction: "left" | "right") => {
      if (direction === "right" && (hasSearchFocus || hasItemFocus)) {
        const selectedIndex = hasItemFocus
          ? Math.min(currentItemIndex, selectedItems.length - 1)
          : 0;
        const selectedItem = selectedItems[selectedIndex];

        if (selectedItem) {
          setFocus(selectedItem.focusId);
          return;
        }

        moveFocus(direction);
        return;
      }

      if (direction === "left" && hasSelectedFocus) {
        const currentSelectedItem = selectedItems[currentSelectedIndex];
        const matchingItemIndex =
          currentSelectedItem?.filterType === activeFilterType
            ? items.findIndex((item) => item.value === currentSelectedItem.value)
            : -1;

        if (matchingItemIndex >= 0) {
          if (!focusItemCentered(matchingItemIndex)) {
            setFocus(items[matchingItemIndex].focusId);
          }
          return;
        }

        setFocus(searchFocusId);
        return;
      }

      if (direction === "right" && hasSelectedFocus) return;

      moveFocus(direction);
    },
    [
      activeFilterType,
      currentItemIndex,
      currentSelectedIndex,
      focusItemCentered,
      hasItemFocus,
      hasSearchFocus,
      hasSelectedFocus,
      items,
      moveFocus,
      searchFocusId,
      selectedItems,
      setFocus,
    ]
  );

  useNavigationScreenActions(
    hasMainFocus
      ? {
          direction: {
            right: () => moveHorizontallyWithinModal("right"),
            up: () => moveWithinModalList("up"),
            down: () => moveWithinModalList("down"),
          },
        }
      : hasSelectedSidebarFocus
        ? {
            direction: {
              left: () => moveHorizontallyWithinModal("left"),
              right: () => moveHorizontallyWithinModal("right"),
              up: () => moveWithinModalList("up"),
              down: () => moveWithinModalList("down"),
            },
          }
        : {}
  );
}

const CatalogueFiltersModalList = forwardRef<
  CatalogueFiltersModalListHandle,
  Readonly<CatalogueFiltersModalListProps>
>(function CatalogueFiltersModalList(
  { items, name, color, values, updateSearchParams },
  ref
) {
  const listRef = useRef<ListRef>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const pendingFrameIdRef = useRef<number | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const { setFocus } = useNavigationActions();
  const selected = (values[name] ?? []) as Array<string | number>;
  const visibleItemCount =
    viewportHeight === null
      ? CATALOGUE_FILTERS_MODAL_FALLBACK_VISIBLE_ITEMS
      : Math.max(
          1,
          Math.floor(viewportHeight / CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT)
        );
  const visibleItemsHeight =
    CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT *
    Math.min(items.length, visibleItemCount);
  const height =
    viewportHeight === null
      ? visibleItemsHeight
      : items.length > visibleItemCount
        ? viewportHeight
        : visibleItemsHeight;

  const resolvePendingFocus = useCallback(() => {
    const pendingFocusId = pendingFocusIdRef.current;

    if (!pendingFocusId) return;

    if (pendingFrameIdRef.current !== null) {
      globalThis.cancelAnimationFrame(pendingFrameIdRef.current);
    }

    pendingFrameIdRef.current = globalThis.requestAnimationFrame(() => {
      pendingFrameIdRef.current = null;

      if (
        pendingFocusIdRef.current === pendingFocusId &&
        setFocus(pendingFocusId)
      ) {
        pendingFocusIdRef.current = null;
      }
    });
  }, [setFocus]);

  const focusItemAtIndex = useCallback(
    (index: number, scroll: () => void) => {
      const item = items[index];

      if (!item) return false;

      pendingFocusIdRef.current = item.focusId;
      scroll();

      if (setFocus(item.focusId)) {
        pendingFocusIdRef.current = null;
        return true;
      }

      resolvePendingFocus();
      return true;
    },
    [items, resolvePendingFocus, setFocus]
  );

  useImperativeHandle(
    ref,
    () => ({
      focusItem: (index, alignment = "auto") => {
        return focusItemAtIndex(index, () => {
          listRef.current?.scrollTo({ index, align: alignment });
        });
      },
      focusItemCentered: (index) => {
        return focusItemAtIndex(index, () => {
          const maxTop = Math.max(
            0,
            items.length * CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT - height
          );
          const targetTop =
            index * CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT -
            (height - CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT) / 2;
          const clampedTargetTop = Math.min(Math.max(targetTop, 0), maxTop);

          animateCatalogueFiltersModalScroll(
            listRef,
            scrollAnimationFrameRef,
            clampedTargetTop
          );
        });
      },
    }),
    [focusItemAtIndex, height, items.length]
  );

  useEffect(() => {
    const pendingFocusId = pendingFocusIdRef.current;

    if (
      pendingFocusId &&
      !items.some((item) => item.focusId === pendingFocusId)
    ) {
      pendingFocusIdRef.current = null;
    }
  }, [items]);

  useEffect(() => {
    return () => {
      if (pendingFrameIdRef.current !== null) {
        globalThis.cancelAnimationFrame(pendingFrameIdRef.current);
      }

      if (scrollAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) return;

    const updateViewportHeight = () => {
      const nextHeight = viewport.clientHeight;
      setViewportHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  const handleChange = (value: string | number, checked: boolean) => {
    updateSearchParams({
      [name]: checked
        ? [...selected, value]
        : selected.filter((item) => item !== value),
    });
  };

  if (items.length === 0) {
    return (
      <div ref={viewportRef} className="catalogue-filters-modal__list-viewport">
        <div className="catalogue-filters-modal__empty">
          <Typography variant="label">No results found</Typography>
        </div>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="catalogue-filters-modal__list-viewport">
      {height > 0 ? (
        <List
          ref={listRef}
          className="catalogue-filters-modal__list"
          data={items}
          height={height}
          itemHeight={CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT}
          itemKey={(item) => item.focusId}
          onVisibleChange={resolvePendingFocus}
        >
          {(item) => (
            <div className="catalogue-filters-modal__list-item">
              <CatalogueFilterCheckbox
                id={`${CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX}-${name}-${item.label}`}
                focusId={item.focusId}
                label={item.label}
                color={color}
                checked={selected.includes(item.value)}
                onChange={(checked) => handleChange(item.value, checked)}
              />
            </div>
          )}
        </List>
      ) : null}
    </div>
  );
});

export function CatalogueFiltersModal({
  visible,
  catalogueData,
  values,
  updateSearchParams,
  onClose,
}: Readonly<CatalogueFiltersModalProps>) {
  const { setFocus } = useNavigationActions();
  const [activeFilterType, setActiveFilterType] = useState<FilterType>(
    FilterType.Genres
  );
  const [displayedFilterType, setDisplayedFilterType] = useState<FilterType>(
    activeFilterType
  );
  const [isMainFading, setIsMainFading] = useState(false);
  const [filtersSearchTerms, setFiltersSearchTerms] = useState<
    Record<FilterType, string>
  >({
    [FilterType.Genres]: "",
    [FilterType.Tags]: "",
    [FilterType.Developers]: "",
    [FilterType.Publishers]: "",
    [FilterType.DownloadSourceFingerprints]: "",
  });
  const filterListRefs = useRef<
    Partial<Record<FilterType, CatalogueFiltersModalListHandle | null>>
  >({});

  useEffect(() => {
    if (activeFilterType === displayedFilterType) return;

    setIsMainFading(true);

    const timeoutId = globalThis.window.setTimeout(() => {
      setDisplayedFilterType(activeFilterType);
    }, CATALOGUE_FILTERS_MODAL_FADE_SWAP_DELAY_MS);

    return () => globalThis.window.clearTimeout(timeoutId);
  }, [activeFilterType, displayedFilterType]);

  useEffect(() => {
    if (!isMainFading || activeFilterType !== displayedFilterType) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      setIsMainFading(false);
    });

    return () => globalThis.cancelAnimationFrame(animationFrameId);
  }, [activeFilterType, displayedFilterType, isMainFading]);

  const filteredItems = useMemo(
    () =>
      Object.fromEntries(
        Object.values(FilterType).map((filterType) => [
          filterType,
          getCatalogueFilterListItems(
            catalogueData[filterType].data,
            filterType,
            filtersSearchTerms[filterType],
            CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX
          ),
        ])
      ) as Record<FilterType, CatalogueFilterListItem[]>,
    [catalogueData, filtersSearchTerms]
  );
  const selectedFilterItems = useMemo(
    () =>
      Object.values(FilterType).flatMap<SelectedCatalogueFilterItem>(
        (filterType) => {
          const selectedValues = (values[filterType] ?? []) as Array<
            string | number
          >;

          if (selectedValues.length === 0) return [];

          return getCatalogueFilterListItems(
            catalogueData[filterType].data,
            filterType,
            "",
            CATALOGUE_FILTERS_MODAL_SELECTED_FOCUS_PREFIX
          )
            .filter((item) => selectedValues.includes(item.value))
            .map((item) => ({
              ...item,
              filterType,
              color: catalogueData[filterType].color,
            }));
        }
      ),
    [catalogueData, values]
  );

  const removeSelectedFilter = useCallback(
    (item: SelectedCatalogueFilterItem, index: number) => {
      const selectedValues = (values[item.filterType] ?? []) as Array<
        string | number
      >;
      const nextFocusTarget =
        selectedFilterItems[index + 1]?.focusId ??
        selectedFilterItems[index - 1]?.focusId ??
        getCatalogueFiltersModalInputFocusId(activeFilterType);

      updateSearchParams({
        [item.filterType]: selectedValues.filter(
          (selectedValue) => selectedValue !== item.value
        ),
      });

      setFocus(nextFocusTarget);
    },
    [activeFilterType, selectedFilterItems, setFocus, updateSearchParams, values]
  );

  useCatalogueFiltersModalNavigation({
    visible,
    activeFilterType,
    searchFocusId: getCatalogueFiltersModalInputFocusId(activeFilterType),
    items: filteredItems[activeFilterType],
    selectedItems: selectedFilterItems,
    focusItem: (index, alignment) =>
      filterListRefs.current[activeFilterType]?.focusItem(index, alignment) ??
      false,
    focusItemCentered: (index) =>
      filterListRefs.current[activeFilterType]?.focusItemCentered(index) ??
      false,
  });

  const displayedItems = filteredItems[displayedFilterType];
  const displayedFilterLabel = catalogueData[displayedFilterType].label;
  const catalogueFiltersModalContent = useMemo(
    () => (
      <div className="catalogue-filters-modal__content">
        <div className="catalogue-filters-modal__main-shell">
          <div className="catalogue-filters-modal__main">
            <Input
              className="catalogue-filters-modal__search"
              focusId={getCatalogueFiltersModalInputFocusId(
                displayedFilterType
              )}
              type="text"
              placeholder={`Search ${displayedFilterLabel.toLowerCase()}`}
              iconLeft={<MagnifyingGlassIcon size={24} />}
              value={filtersSearchTerms[displayedFilterType] ?? ""}
              onChange={(event) =>
                setFiltersSearchTerms((previousState) => ({
                  ...previousState,
                  [displayedFilterType]: event.target.value,
                }))
              }
              autoComplete="off"
              spellCheck={false}
            />

            <div
              className="catalogue-filters-modal__list-fade"
              data-fading={isMainFading || undefined}
            >
              <CatalogueFiltersModalList
                ref={(handle) => {
                  filterListRefs.current[displayedFilterType] = handle;
                }}
                name={displayedFilterType}
                color={catalogueData[displayedFilterType].color}
                items={displayedItems}
                values={values}
                updateSearchParams={updateSearchParams}
              />
            </div>
          </div>
        </div>

        <aside
          className="catalogue-filters-modal__secondary-sidebar"
          aria-label="Selected filters"
        >
          {selectedFilterItems.length > 0 ? (
            <div className="catalogue-filters-modal__selected-list">
              {selectedFilterItems.map((item, index) => (
                <CatalogueFilterCheckbox
                  key={`${item.filterType}-${item.value}`}
                  id={`${CATALOGUE_FILTERS_MODAL_SELECTED_FOCUS_PREFIX}-${item.filterType}-${item.label}`}
                  focusId={item.focusId}
                  label={item.label}
                  color={item.color}
                  checked
                  variant="remove"
                  onChange={() => removeSelectedFilter(item, index)}
                />
              ))}
            </div>
          ) : (
            <div className="catalogue-filters-modal__selected-empty">
              <Typography variant="label">No selected filters</Typography>
            </div>
          )}
        </aside>
      </div>
    ),
    [
      catalogueData,
      displayedFilterLabel,
      displayedFilterType,
      displayedItems,
      filtersSearchTerms,
      isMainFading,
      removeSelectedFilter,
      selectedFilterItems,
      updateSearchParams,
      values,
    ]
  );

  const tabs = useMemo(
    () =>
      Object.values(FilterType).map((filterType) => ({
        id: filterType,
        label: catalogueData[filterType].label,
        content: catalogueFiltersModalContent,
      })),
    [catalogueData, catalogueFiltersModalContent]
  );

  return (
    <SidebarModal
      title="Filters"
      visible={visible}
      onClose={onClose}
      className="catalogue-filters-modal"
      ariaLabel="Catalogue filters"
      activeTabId={activeFilterType}
      onActiveTabChange={(tabId) => setActiveFilterType(tabId as FilterType)}
      contentInitialFocusId={getCatalogueFiltersModalInputFocusId(
        activeFilterType
      )}
      tabs={tabs}
    />
  );
}
