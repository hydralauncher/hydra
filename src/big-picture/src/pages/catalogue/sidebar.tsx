import { useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  Accordion,
  ColorDot,
  Input,
  VerticalFocusGroup,
} from "../../components";
import {
  CATALOGUE_FILTERS_REGION_ID,
  getCatalogueFilterHeaderFocusId,
  getCatalogueFilterInputFocusId,
  getCatalogueFilterRegionId,
} from "./navigation";
import {
  type CatalogueData,
  FilterType,
  type SearchGamesFormValues,
} from "./use-catalogue-data";
import {
  CatalogueFilterList,
  type CatalogueFilterData,
  type CatalogueFilterListAlignment,
  type CatalogueFilterListHandle,
  getCatalogueFilterListItems,
} from "./filter-list";
import { useCatalogueSidebarNavigation } from "./use-catalogue-sidebar-navigation";

interface SidebarProps {
  catalogueData: CatalogueData;
  values: SearchGamesFormValues;
  updateSearchParams: (newValues: Partial<SearchGamesFormValues>) => void;
}

export function CatalogueSidebar({
  catalogueData,
  values,
  updateSearchParams,
}: Readonly<SidebarProps>) {
  const [filtersSearchTerms, setFiltersSearchTerms] = useState<
    Record<FilterType, string>
  >({
    [FilterType.Genres]: "",
    [FilterType.Tags]: "",
    [FilterType.Developers]: "",
    [FilterType.Publishers]: "",
    [FilterType.DownloadSourceFingerprints]: "",
  });
  const [openFilters, setOpenFilters] = useState<Record<FilterType, boolean>>({
    [FilterType.Genres]: true,
    [FilterType.Tags]: true,
    [FilterType.Developers]: true,
    [FilterType.Publishers]: true,
    [FilterType.DownloadSourceFingerprints]: true,
  });
  const filterListRefs = useRef<
    Partial<Record<FilterType, CatalogueFilterListHandle | null>>
  >({});
  const areAllFiltersOpen = Object.values(openFilters).every(Boolean);

  const setFilterSearchTerm = (key: FilterType, term: string) => {
    setFiltersSearchTerms((previousState) => ({
      ...previousState,
      [key]: term,
    }));
  };

  const filterData = useMemo<Record<FilterType, CatalogueFilterData>>(
    () => ({
      [FilterType.Genres]: catalogueData[FilterType.Genres].data,
      [FilterType.Tags]: catalogueData[FilterType.Tags].data,
      [FilterType.Developers]: catalogueData[FilterType.Developers].data,
      [FilterType.Publishers]: catalogueData[FilterType.Publishers].data,
      [FilterType.DownloadSourceFingerprints]:
        catalogueData[FilterType.DownloadSourceFingerprints].data,
    }),
    [catalogueData]
  );
  const filteredItems = useMemo(
    () =>
      Object.fromEntries(
        Object.values(FilterType).map((filterKey) => [
          filterKey,
          getCatalogueFilterListItems(
            filterData[filterKey],
            filterKey,
            filtersSearchTerms[filterKey]
          ),
        ])
      ) as Record<FilterType, ReturnType<typeof getCatalogueFilterListItems>>,
    [filterData, filtersSearchTerms]
  );

  const navigationSections = useMemo(
    () =>
      Object.values(FilterType).map((filterKey) => ({
        key: filterKey,
        headerFocusId: getCatalogueFilterHeaderFocusId(filterKey),
        inputFocusId: getCatalogueFilterInputFocusId(filterKey),
        isOpen: openFilters[filterKey],
        items: filteredItems[filterKey],
        focusItem: (index: number, alignment?: CatalogueFilterListAlignment) =>
          filterListRefs.current[filterKey]?.focusItem(index, alignment) ??
          false,
      })),
    [filteredItems, openFilters]
  );
  useCatalogueSidebarNavigation(navigationSections);

  return (
    <VerticalFocusGroup
      regionId={CATALOGUE_FILTERS_REGION_ID}
      className={`catalogue__sidebar ${
        areAllFiltersOpen ? "catalogue__sidebar--aligned" : ""
      }`}
      style={
        areAllFiltersOpen
          ? {
              gridTemplateRows: "subgrid",
              gap: "inherit",
            }
          : { gap: "calc(var(--spacing-unit) * 2)" }
      }
    >
      {Object.values(FilterType).map((filterKey) => {
        const data = filterData[filterKey];
        const length = Array.isArray(data)
          ? data.length
          : Object.keys(data).length;

        return (
          <VerticalFocusGroup
            key={filterKey}
            regionId={getCatalogueFilterRegionId(filterKey)}
            asChild
          >
            <div
              className={`catalogue__sidebar__filter ${
                openFilters[filterKey]
                  ? "catalogue__sidebar__filter--open"
                  : "catalogue__sidebar__filter--closed"
              }`}
            >
              <Accordion
                open
                focusId={getCatalogueFilterHeaderFocusId(filterKey)}
                hint={`${length} Available`}
                title={catalogueData[filterKey].label}
                icon={<ColorDot color={catalogueData[filterKey].color} />}
                onOpenChange={(isOpen) =>
                  setOpenFilters((previousState) => ({
                    ...previousState,
                    [filterKey]: isOpen,
                  }))
                }
              >
                <div className="catalogue__sidebar__filter__content">
                  <Input
                    focusId={getCatalogueFilterInputFocusId(filterKey)}
                    type="text"
                    placeholder={`Search ${catalogueData[filterKey].label.toLowerCase()}`}
                    iconLeft={<MagnifyingGlassIcon size={24} />}
                    value={filtersSearchTerms[filterKey] ?? ""}
                    onChange={(event) =>
                      setFilterSearchTerm(filterKey, event.target.value)
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />

                  <CatalogueFilterList
                    ref={(handle) => {
                      filterListRefs.current[filterKey] = handle;
                    }}
                    name={filterKey}
                    items={filteredItems[filterKey]}
                    values={values}
                    updateSearchParams={updateSearchParams}
                  />
                </div>
              </Accordion>
            </div>
          </VerticalFocusGroup>
        );
      })}
    </VerticalFocusGroup>
  );
}
