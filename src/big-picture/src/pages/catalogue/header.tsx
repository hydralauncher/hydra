import { DeviceDesktopIcon } from "@primer/octicons-react";
import { FunnelIcon, SortAscendingIcon } from "@phosphor-icons/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";
import {
  Button,
  Chip,
  DropdownSelect,
  FocusItem,
  GridFocusGroup,
  Tabs,
  type TabsItem,
  Typography,
} from "../../components";
import { useNavigationActions } from "../../hooks";
import { useNavigationStore } from "../../stores";
import {
  CATALOGUE_CLEAR_FILTERS_ID,
  CATALOGUE_FILTERS_BUTTON_ID,
  CATALOGUE_HEADER_CONTROLS_REGION_ID,
  CATALOGUE_HIDDEN_FILTERS_BUTTON_ID,
  CATALOGUE_MODE_CLASSICS_ID,
  CATALOGUE_MODE_MODERN_ID,
  CATALOGUE_SORT_SELECT_ID,
  getCatalogueActiveFilterChipFocusId,
} from "./navigation";
import {
  CATALOGUE_SORT_OPTIONS,
  type CatalogueSortValue,
  type CatalogueData,
  type CatalogueMode,
  FilterType,
  type SearchGamesFormValues,
} from "./use-catalogue-data";
import { useCatalogueHeaderNavigation } from "./use-catalogue-header-navigation";

interface HeaderProps {
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
  catalogueData: CatalogueData;
  onOpenFilters: () => void;
}

interface FilterItem {
  type: FilterType;
  value: string | number;
  label: string;
}

interface HeaderFilterMeasurements {
  containerWidth: number;
  gap: number;
  chipWidths: Record<string, number>;
  hiddenChipWidths: Record<number, number>;
  clearAllWidth: number;
}

const MAX_VISIBLE_FILTER_ROWS = 2;
const EMPTY_FILTER_MEASUREMENTS: HeaderFilterMeasurements = {
  containerWidth: 0,
  gap: 0,
  chipWidths: {},
  hiddenChipWidths: {},
  clearAllWidth: 0,
};

function getFilterItemKey({ type, value }: FilterItem) {
  return `${type}:${value}`;
}

function areNumberMapsEqual(
  current: Record<string | number, number>,
  next: Record<string | number, number>
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  if (currentKeys.length !== nextKeys.length) return false;

  return currentKeys.every((key) => current[key] === next[key]);
}

function areFilterMeasurementsEqual(
  current: HeaderFilterMeasurements,
  next: HeaderFilterMeasurements
) {
  return (
    current.containerWidth === next.containerWidth &&
    current.gap === next.gap &&
    current.clearAllWidth === next.clearAllWidth &&
    areNumberMapsEqual(current.chipWidths, next.chipWidths) &&
    areNumberMapsEqual(current.hiddenChipWidths, next.hiddenChipWidths)
  );
}

function fitsWithinRows(
  itemWidths: number[],
  containerWidth: number,
  gap: number,
  maxRows: number
) {
  if (!itemWidths.length) return true;

  let rowCount = 1;
  let currentRowWidth = 0;

  for (const itemWidth of itemWidths) {
    if (currentRowWidth === 0) {
      currentRowWidth = itemWidth;
      continue;
    }

    if (currentRowWidth + gap + itemWidth <= containerWidth) {
      currentRowWidth += gap + itemWidth;
      continue;
    }

    rowCount += 1;
    currentRowWidth = itemWidth;

    if (rowCount > maxRows) {
      return false;
    }
  }

  return true;
}

function getVisibleFilterLayout(
  activeFilters: FilterItem[],
  measurements: HeaderFilterMeasurements
) {
  if (!activeFilters.length) {
    return { visibleCount: 0, hiddenCount: 0 };
  }

  if (measurements.containerWidth <= 0 || measurements.clearAllWidth <= 0) {
    return { visibleCount: 0, hiddenCount: activeFilters.length };
  }

  const chipWidths = activeFilters.map(
    (filter) => measurements.chipWidths[getFilterItemKey(filter)] ?? 0
  );

  if (
    chipWidths.some((width) => width <= 0) ||
    Object.keys(measurements.hiddenChipWidths).length < activeFilters.length
  ) {
    return { visibleCount: 0, hiddenCount: activeFilters.length };
  }

  for (
    let visibleCount = activeFilters.length;
    visibleCount >= 0;
    visibleCount -= 1
  ) {
    const hiddenCount = activeFilters.length - visibleCount;
    const itemWidths = chipWidths.slice(0, visibleCount);

    if (hiddenCount > 0) {
      const hiddenChipWidth = measurements.hiddenChipWidths[hiddenCount];

      if (!hiddenChipWidth) {
        return { visibleCount: 0, hiddenCount: activeFilters.length };
      }

      itemWidths.push(hiddenChipWidth);
    }

    itemWidths.push(measurements.clearAllWidth);

    if (
      fitsWithinRows(
        itemWidths,
        measurements.containerWidth,
        measurements.gap,
        MAX_VISIBLE_FILTER_ROWS
      )
    ) {
      return { visibleCount, hiddenCount };
    }
  }

  return { visibleCount: 0, hiddenCount: activeFilters.length };
}

export function CatalogueHeader({
  values,
  updateSearchParams,
  catalogueData,
  onOpenFilters,
}: Readonly<HeaderProps>) {
  const {
    mode = "modern",
    title,
    platforms,
    genres,
    tags,
    publishers,
    developers,
    downloadSourceFingerprints,
  } = values;
  const { setFocus } = useNavigationActions();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const filtersContainerRef = useRef<HTMLDivElement | null>(null);
  const filtersMeasurementsRef = useRef<HTMLDivElement | null>(null);
  const [filterMeasurements, setFilterMeasurements] = useState(
    EMPTY_FILTER_MEASUREMENTS
  );
  const selectedSortOption =
    CATALOGUE_SORT_OPTIONS.find(
      (option) =>
        option.sortBy === values.sortBy && option.sortOrder === values.sortOrder
    ) ?? CATALOGUE_SORT_OPTIONS[0];

  const activeFilters = useMemo<FilterItem[]>(
    () => [
      ...(mode === "classics"
        ? (platforms?.map((value) => {
            const label =
              Object.entries(catalogueData[FilterType.Platforms].data).find(
                ([, platformKey]) => platformKey === value
              )?.[0] ?? value;

            return {
              type: FilterType.Platforms,
              label,
              value,
            };
          }) ?? [])
        : []),
      ...(genres?.map((value) => ({
        type: FilterType.Genres,
        label: value,
        value,
      })) ?? []),
      ...(mode === "modern"
        ? (tags?.map((id) => {
            const name =
              Object.entries(catalogueData[FilterType.Tags].data).find(
                ([, tagId]) => tagId === id
              )?.[0] ?? id.toString();

            return {
              type: FilterType.Tags,
              label: name,
              value: id,
            };
          }) ?? [])
        : []),
      ...(publishers?.map((value) => ({
        type: FilterType.Publishers,
        label: value,
        value,
      })) ?? []),
      ...(developers?.map((value) => ({
        type: FilterType.Developers,
        label: value,
        value,
      })) ?? []),
      ...(downloadSourceFingerprints?.map((value) => {
        const label =
          Object.entries(
            catalogueData[FilterType.DownloadSourceFingerprints].data
          ).find(([, fingerprint]) => fingerprint === value)?.[0] ?? value;

        return {
          type: FilterType.DownloadSourceFingerprints,
          label,
          value,
        };
      }) ?? []),
    ],
    [
      catalogueData,
      developers,
      downloadSourceFingerprints,
      genres,
      mode,
      platforms,
      publishers,
      tags,
    ]
  );

  useLayoutEffect(() => {
    if (!activeFilters.length) {
      setFilterMeasurements((current) =>
        areFilterMeasurementsEqual(current, EMPTY_FILTER_MEASUREMENTS)
          ? current
          : EMPTY_FILTER_MEASUREMENTS
      );
      return;
    }

    let frameId = 0;

    const measureFilters = () => {
      const filtersContainer = filtersContainerRef.current;
      const measurementsRoot = filtersMeasurementsRef.current;

      if (!filtersContainer || !measurementsRoot) return;

      const computedStyles = globalThis.getComputedStyle(filtersContainer);
      const nextMeasurements: HeaderFilterMeasurements = {
        containerWidth: filtersContainer.getBoundingClientRect().width,
        gap:
          Number.parseFloat(computedStyles.columnGap || computedStyles.gap) ||
          0,
        chipWidths: {},
        hiddenChipWidths: {},
        clearAllWidth:
          measurementsRoot
            .querySelector<HTMLElement>("[data-catalogue-clear-all-measure]")
            ?.getBoundingClientRect().width ?? 0,
      };

      measurementsRoot
        .querySelectorAll<HTMLElement>("[data-catalogue-filter-measure-key]")
        .forEach((element) => {
          const { catalogueFilterMeasureKey } = element.dataset;

          if (!catalogueFilterMeasureKey) return;

          nextMeasurements.chipWidths[catalogueFilterMeasureKey] =
            element.getBoundingClientRect().width;
        });

      measurementsRoot
        .querySelectorAll<HTMLElement>("[data-catalogue-hidden-filters-count]")
        .forEach((element) => {
          const count = Number.parseInt(
            element.dataset.catalogueHiddenFiltersCount ?? "",
            10
          );

          if (!Number.isFinite(count)) return;

          nextMeasurements.hiddenChipWidths[count] =
            element.getBoundingClientRect().width;
        });

      setFilterMeasurements((current) =>
        areFilterMeasurementsEqual(current, nextMeasurements)
          ? current
          : nextMeasurements
      );
    };

    const scheduleMeasure = () => {
      globalThis.cancelAnimationFrame(frameId);
      frameId = globalThis.requestAnimationFrame(measureFilters);
    };

    scheduleMeasure();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        globalThis.cancelAnimationFrame(frameId);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleMeasure);

    if (filtersContainerRef.current) {
      resizeObserver.observe(filtersContainerRef.current);
    }

    if (filtersMeasurementsRef.current) {
      resizeObserver.observe(filtersMeasurementsRef.current);
    }

    return () => {
      globalThis.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [activeFilters]);

  const { hiddenCount: hiddenFiltersCount, visibleCount: visibleFilterCount } =
    useMemo(
      () => getVisibleFilterLayout(activeFilters, filterMeasurements),
      [activeFilters, filterMeasurements]
    );
  const visibleFilters = useMemo(
    () => activeFilters.slice(0, visibleFilterCount),
    [activeFilters, visibleFilterCount]
  );
  const hiddenFilterCountOptions = useMemo(
    () => Array.from({ length: activeFilters.length }, (_, index) => index + 1),
    [activeFilters.length]
  );
  const chipFocusIds = visibleFilters.map((filter) =>
    getCatalogueActiveFilterChipFocusId(filter.type, filter.value)
  );
  const headerFocusIds = [
    CATALOGUE_MODE_MODERN_ID,
    CATALOGUE_MODE_CLASSICS_ID,
    ...chipFocusIds,
    ...(hiddenFiltersCount > 0 ? [CATALOGUE_HIDDEN_FILTERS_BUTTON_ID] : []),
    ...(activeFilters.length > 0 ? [CATALOGUE_CLEAR_FILTERS_ID] : []),
    CATALOGUE_FILTERS_BUTTON_ID,
    CATALOGUE_SORT_SELECT_ID,
  ];
  const navigationOverridesById = useCatalogueHeaderNavigation(headerFocusIds);
  const hasActiveFilters = Boolean(title) || activeFilters.length > 0;
  const hiddenFiltersLabel = `+${hiddenFiltersCount}`;
  const modeTabItems = [
    {
      id: CATALOGUE_MODE_MODERN_ID,
      value: "modern",
      label: (
        <span className="catalogue-header__mode-tab-content">
          <DeviceDesktopIcon
            size={16}
            className="catalogue-header__mode-tab-icon"
            aria-hidden="true"
          />
          <span>PC</span>
        </span>
      ),
      navigationOverrides: navigationOverridesById[CATALOGUE_MODE_MODERN_ID],
    },
    {
      id: CATALOGUE_MODE_CLASSICS_ID,
      value: "classics",
      label: (
        <span className="catalogue-header__mode-tab-content">
          <ClassicsIcon
            size={16}
            className="catalogue-header__mode-tab-icon catalogue-header__mode-tab-icon--classics"
          />
          <span>Classics</span>
        </span>
      ),
      navigationOverrides: navigationOverridesById[CATALOGUE_MODE_CLASSICS_ID],
    },
  ] satisfies Array<TabsItem<CatalogueMode>>;

  const restoreHeaderFocus = (sourceId: string, targetId: string) => {
    if (currentFocusId !== sourceId) return;

    globalThis.requestAnimationFrame(() => {
      setFocus(targetId);
    });
  };

  const handleRemoveFilter = (
    { type, value }: FilterItem,
    visibleFilterIndex: number
  ) => {
    const currentFilters = values[type];
    if (!currentFilters) return;

    const sourceId = getCatalogueActiveFilterChipFocusId(type, value);
    const nextFilters = activeFilters.filter(
      (filter) => !(filter.type === type && filter.value === value)
    );
    const nextLayout = getVisibleFilterLayout(nextFilters, filterMeasurements);
    const nextVisibleFilters = nextFilters.slice(0, nextLayout.visibleCount);
    const nextVisibleFilter =
      nextVisibleFilters[visibleFilterIndex] ??
      nextVisibleFilters[visibleFilterIndex - 1];
    const targetId = nextVisibleFilter
      ? getCatalogueActiveFilterChipFocusId(
          nextVisibleFilter.type,
          nextVisibleFilter.value
        )
      : nextLayout.hiddenCount > 0
        ? CATALOGUE_HIDDEN_FILTERS_BUTTON_ID
        : nextFilters.length > 0
          ? CATALOGUE_CLEAR_FILTERS_ID
          : CATALOGUE_FILTERS_BUTTON_ID;

    updateSearchParams({
      [type]: currentFilters.filter((item) => item !== value),
    });
    restoreHeaderFocus(sourceId, targetId);
  };

  const handleRemoveAllFilters = () => {
    updateSearchParams({
      platforms: [],
      genres: [],
      tags: [],
      publishers: [],
      developers: [],
      downloadSourceFingerprints: [],
    });
    restoreHeaderFocus(CATALOGUE_CLEAR_FILTERS_ID, CATALOGUE_FILTERS_BUTTON_ID);
  };

  const handleOpenHiddenFilters = useCallback(() => {
    onOpenFilters();
  }, [onOpenFilters]);

  const handleModeChange = useCallback(
    (nextMode: CatalogueMode) => {
      if (mode === nextMode) return;

      updateSearchParams({
        mode: nextMode,
      });
    },
    [mode, updateSearchParams]
  );

  const handleSortChange = (value: CatalogueSortValue) => {
    const sortOption =
      CATALOGUE_SORT_OPTIONS.find((option) => option.value === value) ??
      CATALOGUE_SORT_OPTIONS[0];

    updateSearchParams({
      sortBy: sortOption.sortBy,
      sortOrder: sortOption.sortOrder,
    });
  };

  return (
    <GridFocusGroup
      regionId={CATALOGUE_HEADER_CONTROLS_REGION_ID}
      className="catalogue-header"
    >
      <div className="catalogue-header__summary">
        <div className="catalogue-header__search-term">
          {hasActiveFilters ? (
            <Typography
              variant="label"
              className="catalogue-header__search-term-text"
            >
              Showing search results for {title && <q>{title}</q>}
            </Typography>
          ) : (
            <Typography
              variant="label"
              className="catalogue-header__search-term-text"
            >
              Sorted by: {selectedSortOption.label}
            </Typography>
          )}
        </div>

        <div className="catalogue-header__filters">
          {activeFilters.length > 0 ? (
            <>
              <div
                ref={filtersContainerRef}
                className="catalogue-header__filters-container"
              >
                {visibleFilters.map((filter, index) => {
                  const focusId = getCatalogueActiveFilterChipFocusId(
                    filter.type,
                    filter.value
                  );

                  return (
                    <Chip
                      key={`${filter.type}-${filter.value}`}
                      color={catalogueData[filter.type].color}
                      label={filter.label}
                      focusId={focusId}
                      focusNavigationOverrides={
                        navigationOverridesById[focusId]
                      }
                      onRemove={() => handleRemoveFilter(filter, index)}
                    />
                  );
                })}

                {hiddenFiltersCount > 0 ? (
                  <Chip
                    focusId={CATALOGUE_HIDDEN_FILTERS_BUTTON_ID}
                    label={hiddenFiltersLabel}
                    onClick={handleOpenHiddenFilters}
                    focusNavigationOverrides={
                      navigationOverridesById[
                        CATALOGUE_HIDDEN_FILTERS_BUTTON_ID
                      ]
                    }
                  />
                ) : null}

                <FocusItem
                  id={CATALOGUE_CLEAR_FILTERS_ID}
                  actions={{ primary: handleRemoveAllFilters }}
                  navigationOverrides={
                    navigationOverridesById[CATALOGUE_CLEAR_FILTERS_ID]
                  }
                  asChild
                >
                  <button
                    type="button"
                    className="catalogue-header__filters__clear-button"
                    onClick={handleRemoveAllFilters}
                  >
                    <Typography
                      variant="label"
                      className="catalogue-header__filters__clear-button-text"
                    >
                      Clear all
                    </Typography>
                  </button>
                </FocusItem>
              </div>

              <div
                ref={filtersMeasurementsRef}
                className="catalogue-header__filters-measurements"
                aria-hidden="true"
              >
                {activeFilters.map((filter) => {
                  const filterKey = getFilterItemKey(filter);

                  return (
                    <div
                      key={`measure-${filterKey}`}
                      data-catalogue-filter-measure-key={filterKey}
                    >
                      <Chip
                        color={catalogueData[filter.type].color}
                        label={filter.label}
                        onRemove={() => undefined}
                      />
                    </div>
                  );
                })}

                {hiddenFilterCountOptions.map((count) => (
                  <div
                    key={`measure-hidden-${count}`}
                    data-catalogue-hidden-filters-count={count}
                  >
                    <Chip label={`+${count}`} />
                  </div>
                ))}

                <button
                  type="button"
                  className="catalogue-header__filters__clear-button"
                  data-catalogue-clear-all-measure
                >
                  <Typography
                    variant="label"
                    className="catalogue-header__filters__clear-button-text"
                  >
                    Clear all
                  </Typography>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="catalogue-header__actions">
        <Tabs
          className="catalogue-header__mode-tabs"
          items={modeTabItems}
          value={mode}
          onValueChange={handleModeChange}
          manageFocusRegion={false}
          selectOnFocus={false}
          ignoreInitialFocusSelection
          variant="segmented"
          ariaLabel="Catalogue mode"
        />

        <Button
          className="catalogue-header__filters-button"
          variant="rounded"
          icon={<FunnelIcon size={20} />}
          focusId={CATALOGUE_FILTERS_BUTTON_ID}
          focusNavigationOverrides={
            navigationOverridesById[CATALOGUE_FILTERS_BUTTON_ID]
          }
          onClick={onOpenFilters}
        >
          Filters
        </Button>

        <div className="catalogue-header__sort">
          <DropdownSelect
            className="catalogue-header__sort-select"
            label="Sort by"
            hideLabel
            leadingIcon={<SortAscendingIcon size={22} />}
            ariaLabel="Sort catalogue games"
            focusId={CATALOGUE_SORT_SELECT_ID}
            focusNavigationOverrides={
              navigationOverridesById[CATALOGUE_SORT_SELECT_ID]
            }
            value={selectedSortOption.value}
            options={CATALOGUE_SORT_OPTIONS.map(({ value, label }) => ({
              value,
              label,
            }))}
            onValueChange={handleSortChange}
          />
        </div>
      </div>
    </GridFocusGroup>
  );
}
