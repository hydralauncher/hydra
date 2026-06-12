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
  });
}
