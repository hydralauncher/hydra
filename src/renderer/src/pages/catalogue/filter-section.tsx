import { CheckboxField, TextField } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { useCallback, useMemo, useState } from "react";

import List from "rc-virtual-list";
import { useTranslation } from "react-i18next";
import "../../scss/_variables.scss";

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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          style={{
            width: 10,
            height: 10,
            backgroundColor: color,
            borderRadius: "50%",
          }}
        />
        <h3
          style={{
            fontSize: 16,
            fontWeight: 500,
          }}
        >
          {title}
        </h3>
      </div>

      {selectedItemsCount > 0 ? (
        <button
          type="button"
          style={{
            fontSize: 12,
            marginBottom: 12,
            display: "block",
            color: "var(--body-color)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={onClear}
        >
          {t("clear_filters", {
            filterCount: formatNumber(selectedItemsCount),
          })}
        </button>
      ) : (
        <span style={{ fontSize: 12, marginBottom: 12, display: "block" }}>
          {t("filter_count", {
            filterCount: formatNumber(items.length),
          })}
        </span>
      )}

      <TextField
        placeholder={t("search")}
        onChange={(e) => onSearch(e.target.value)}
        value={search}
        containerProps={{ style: { marginBottom: 16 } }}
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
          <div key={item.value} style={{ height: 28, maxHeight: 28 }}>
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
