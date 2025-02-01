import { CheckboxField, TextField } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { useCallback, useMemo, useState } from "react";
import "./filter.scss";
import List from "rc-virtual-list";
import { useTranslation } from "react-i18next";

export interface FilterSectionProps {
  title: string;
  items: {
    label: string;
    value: string | number;
    checked: boolean;
  }[];
  onSelect: (value: string | number) => void;
  color: string;
  onClear: () => void;
}

export function FilterSection({
  title,
  items,
  color,
  onSelect,
  onClear,
}: FilterSectionProps) {
  const [search, setSearch] = useState("");
  const { t } = useTranslation("catalogue");

  const filteredItems = useMemo(() => {
    if (search.length > 0) {
      return items.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      );
    }

    return items;
  }, [items, search]);

  const selectedItemsCount = useMemo(() => {
    return items.filter((item) => item.checked).length;
  }, [items]);

  const onSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const { formatNumber } = useFormat();

  if (!items.length) {
    return null;
  }

  return (
    <div>
      <div className="filter-section__header">
        <div
          className="filter-section__orb"
          style={{ backgroundColor: color }}
        />
        <h3 className="filter-section__title">{title}</h3>
      </div>

      {selectedItemsCount > 0 ? (
        <button
          type="button"
          className="filter-section__clear-button"
          onClick={onClear}
        >
          {t("clear_filters", {
            filterCount: formatNumber(selectedItemsCount),
          })}
        </button>
      ) : (
        <span className="filter-section__count">
          {t("filter_count", {
            filterCount: formatNumber(items.length),
          })}
        </span>
      )}

      <TextField
        placeholder={t("search")}
        onChange={(e) => onSearch(e.target.value)}
        value={search}
        containerProps={{ className: "filter-section__search" }}
        theme="dark"
      />

      <List
        data={filteredItems}
        height={28 * (filteredItems.length > 10 ? 10 : filteredItems.length)}
        itemHeight={28}
        itemKey="value"
        styles={{
          verticalScrollBar: {
            backgroundColor: "rgba(255, 255, 255, 0.03)",
          },
          verticalScrollBarThumb: {
            backgroundColor: "rgba(255, 255, 255, 0.08)",
            borderRadius: "24px",
          },
        }}
      >
        {(item) => (
          <div key={item.value} className="filter-section__item">
            <CheckboxField
              label={item.label}
              checked={item.checked}
              onChange={() => onSelect(item.value)}
            />
          </div>
        )}
      </List>
    </div>
  );
}
