import { SortAscendingIcon } from "@phosphor-icons/react";
import {
  Chip,
  DropdownSelect,
  FocusItem,
  GridFocusGroup,
  Typography,
} from "../../components";
import { useNavigationActions } from "../../hooks";
import { useNavigationStore } from "../../stores";
import {
  CATALOGUE_CLEAR_FILTERS_ID,
  CATALOGUE_HEADER_CONTROLS_REGION_ID,
  CATALOGUE_SORT_SELECT_ID,
  getCatalogueActiveFilterChipFocusId,
  getCatalogueFilterHeaderFocusId,
} from "./navigation";
import {
  CATALOGUE_SORT_OPTIONS,
  type CatalogueSortValue,
  type CatalogueData,
  FilterType,
  type SearchGamesFormValues,
} from "./use-catalogue-data";
import { useCatalogueHeaderNavigation } from "./use-catalogue-header-navigation";

interface HeaderProps {
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
  catalogueData: CatalogueData;
}

interface FilterItem {
  type: FilterType;
  value: string | number;
  label: string;
}

export function CatalogueHeader({
  values,
  updateSearchParams,
  catalogueData,
}: Readonly<HeaderProps>) {
  const {
    title,
    genres,
    tags,
    publishers,
    developers,
    downloadSourceFingerprints,
  } = values;
  const { setFocus } = useNavigationActions();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const selectedSortOption =
    CATALOGUE_SORT_OPTIONS.find(
      (option) =>
        option.sortBy === values.sortBy && option.sortOrder === values.sortOrder
    ) ?? CATALOGUE_SORT_OPTIONS[0];

  const activeFilters: FilterItem[] = [
    ...(genres?.map((value) => ({
      type: FilterType.Genres,
      label: value,
      value,
    })) ?? []),
    ...(tags?.map((id) => {
      const name =
        Object.entries(catalogueData[FilterType.Tags].data).find(
          ([, tagId]) => tagId === id
        )?.[0] ?? id.toString();

      return {
        type: FilterType.Tags,
        label: name,
        value: id,
      };
    }) ?? []),
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
  ];
  const chipFocusIds = activeFilters.map((filter) =>
    getCatalogueActiveFilterChipFocusId(filter.type, filter.value)
  );
  const headerFocusIds = [
    ...chipFocusIds,
    ...(activeFilters.length > 0 ? [CATALOGUE_CLEAR_FILTERS_ID] : []),
    CATALOGUE_SORT_SELECT_ID,
  ];
  const navigationOverridesById = useCatalogueHeaderNavigation(headerFocusIds);

  const hasActiveFilters = Boolean(title) || activeFilters.length > 0;

  const restoreHeaderFocus = (sourceId: string, targetId: string) => {
    if (currentFocusId !== sourceId) return;

    globalThis.requestAnimationFrame(() => {
      setFocus(targetId);
    });
  };

  const handleRemoveFilter = (
    { type, value }: FilterItem,
    filterIndex: number
  ) => {
    const currentFilters = values[type];
    if (!currentFilters) return;

    const sourceId = getCatalogueActiveFilterChipFocusId(type, value);
    const nextFilter =
      activeFilters[filterIndex + 1] ?? activeFilters[filterIndex - 1];
    const targetId = nextFilter
      ? getCatalogueActiveFilterChipFocusId(nextFilter.type, nextFilter.value)
      : CATALOGUE_SORT_SELECT_ID;

    updateSearchParams({
      [type]: currentFilters.filter((item) => item !== value),
    });
    restoreHeaderFocus(sourceId, targetId);
  };

  const handleRemoveAllFilters = () => {
    updateSearchParams({
      genres: [],
      tags: [],
      publishers: [],
      developers: [],
      downloadSourceFingerprints: [],
    });
    restoreHeaderFocus(CATALOGUE_CLEAR_FILTERS_ID, CATALOGUE_SORT_SELECT_ID);
  };

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
            <div className="catalogue-header__filters-container">
              {activeFilters.map((filter, index) => {
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
                    focusNavigationOverrides={navigationOverridesById[focusId]}
                    onRemove={() => handleRemoveFilter(filter, index)}
                  />
                );
              })}

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
          ) : null}
        </div>
      </div>

      <div className="catalogue-header__sort">
        <DropdownSelect
          className="catalogue-header__sort-select"
          label="Sort by"
          hideLabel
          leadingIcon={<SortAscendingIcon size={22} />}
          ariaLabel="Sort catalogue games"
          focusId={CATALOGUE_SORT_SELECT_ID}
          focusNavigationOverrides={{
            ...navigationOverridesById[CATALOGUE_SORT_SELECT_ID],
            down: {
              type: "item",
              itemId: getCatalogueFilterHeaderFocusId(FilterType.Genres),
            },
          }}
          value={selectedSortOption.value}
          options={CATALOGUE_SORT_OPTIONS.map(({ value, label }) => ({
            value,
            label,
          }))}
          onValueChange={handleSortChange}
        />
      </div>
    </GridFocusGroup>
  );
}
