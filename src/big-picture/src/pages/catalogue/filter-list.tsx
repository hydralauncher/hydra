import { getCatalogueFilterCheckboxFocusId } from "./navigation";
import { FilterType } from "./use-catalogue-data";

export type CatalogueFilterData =
  | string[]
  | Record<string, number>
  | Record<string, string>;

export interface CatalogueFilterListItem {
  label: string;
  value: string | number;
  focusId: string;
}

export type CatalogueFilterListAlignment = "top" | "bottom" | "auto";

function getCatalogueFilterListItem(
  label: string,
  value: string | number,
  name: FilterType,
  focusIdPrefix?: string
): CatalogueFilterListItem {
  return {
    label,
    value,
    focusId: focusIdPrefix
      ? `${focusIdPrefix}:${getCatalogueFilterCheckboxFocusId(
          name,
          String(value)
        )}`
      : getCatalogueFilterCheckboxFocusId(name, String(value)),
  };
}

export function getCatalogueFilterListItems(
  listData: CatalogueFilterData,
  name: FilterType,
  searchTerm = "",
  focusIdPrefix?: string
) {
  const labels = Array.isArray(listData) ? listData : Object.keys(listData);
  const filteredLabels = searchTerm
    ? labels.filter((label) =>
        label.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : labels;

  return filteredLabels.map<CatalogueFilterListItem>((label) => {
    const value = Array.isArray(listData) ? label : listData[label];

    return getCatalogueFilterListItem(label, value, name, focusIdPrefix);
  });
}

export function getSelectedCatalogueFilterListItems(
  listData: CatalogueFilterData,
  name: FilterType,
  selectedValues: Array<string | number>,
  focusIdPrefix?: string
) {
  const selectedValuesSet = new Set(selectedValues);

  if (Array.isArray(listData)) {
    return listData
      .filter((label) => selectedValuesSet.has(label))
      .map((label) =>
        getCatalogueFilterListItem(label, label, name, focusIdPrefix)
      );
  }

  return Object.entries(listData)
    .filter(([, value]) => selectedValuesSet.has(value))
    .map(([label, value]) =>
      getCatalogueFilterListItem(label, value, name, focusIdPrefix)
    );
}
