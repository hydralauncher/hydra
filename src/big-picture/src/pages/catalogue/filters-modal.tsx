import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import List from "rc-virtual-list";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Input, SidebarModal, Typography } from "../../components";
import {
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
const CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT = 56;
const CATALOGUE_FILTERS_MODAL_FALLBACK_VISIBLE_ITEMS = 8;

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

function CatalogueFiltersModalList({
  items,
  name,
  color,
  values,
  updateSearchParams,
}: Readonly<CatalogueFiltersModalListProps>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
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
          className="catalogue-filters-modal__list"
          data={items}
          height={height}
          itemHeight={CATALOGUE_FILTERS_MODAL_ITEM_HEIGHT}
          itemKey={(item) => item.focusId}
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
}

export function CatalogueFiltersModal({
  visible,
  catalogueData,
  values,
  updateSearchParams,
  onClose,
}: Readonly<CatalogueFiltersModalProps>) {
  const [filtersSearchTerms, setFiltersSearchTerms] = useState<
    Record<FilterType, string>
  >({
    [FilterType.Genres]: "",
    [FilterType.Tags]: "",
    [FilterType.Developers]: "",
    [FilterType.Publishers]: "",
    [FilterType.DownloadSourceFingerprints]: "",
  });

  const tabs = useMemo(
    () =>
      Object.values(FilterType).map((filterType) => {
        const items = getCatalogueFilterListItems(
          catalogueData[filterType].data,
          filterType,
          filtersSearchTerms[filterType],
          CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX
        );

        return {
          id: filterType,
          label: catalogueData[filterType].label,
          content: (
            <div className="catalogue-filters-modal__content">
              <Input
                className="catalogue-filters-modal__search"
                focusId={`${CATALOGUE_FILTERS_MODAL_FOCUS_PREFIX}:input:${filterType}`}
                type="text"
                placeholder={`Search ${catalogueData[
                  filterType
                ].label.toLowerCase()}`}
                iconLeft={<MagnifyingGlassIcon size={24} />}
                value={filtersSearchTerms[filterType] ?? ""}
                onChange={(event) =>
                  setFiltersSearchTerms((previousState) => ({
                    ...previousState,
                    [filterType]: event.target.value,
                  }))
                }
                autoComplete="off"
                spellCheck={false}
              />

              <CatalogueFiltersModalList
                name={filterType}
                color={catalogueData[filterType].color}
                items={items}
                values={values}
                updateSearchParams={updateSearchParams}
              />
            </div>
          ),
        };
      }),
    [catalogueData, filtersSearchTerms, updateSearchParams, values]
  );

  return (
    <SidebarModal
      title="Filters"
      visible={visible}
      onClose={onClose}
      className="catalogue-filters-modal"
      ariaLabel="Catalogue filters"
      tabs={tabs}
    />
  );
}
