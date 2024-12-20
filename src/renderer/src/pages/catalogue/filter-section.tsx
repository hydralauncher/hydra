import { CheckboxField, TextField } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { useCallback, useMemo, useState } from "react";

export interface FilterSectionProps<T extends string | number> {
  title: string;
  items: {
    label: string;
    value: T;
    checked: boolean;
  }[];
  onSelect: (value: T) => void;
}

export function FilterSection<T extends string | number>({
  title,
  items,
  onSelect,
}: FilterSectionProps<T>) {
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (search.length > 0) {
      return items.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      );
    }

    return items;
  }, [items, search]);

  const onSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const { formatNumber } = useFormat();

  return (
    <div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "#fff",
        }}
      >
        {title}
      </h3>

      <span style={{ fontSize: 12, marginBottom: 12, display: "block" }}>
        {formatNumber(items.length)} disponíveis
      </span>

      <TextField
        placeholder="Search..."
        onChange={(e) => onSearch(e.target.value)}
        value={search}
        containerProps={{ style: { marginBottom: 16 } }}
        theme="dark"
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflowY: "auto",
          maxHeight: 28 * 10,
        }}
      >
        {filteredItems.map((item) => (
          <div key={item.value}>
            <CheckboxField
              label={item.label}
              checked={item.checked}
              onChange={() => onSelect(item.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
