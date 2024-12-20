import { CheckboxField, TextField } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { useCallback, useMemo, useState } from "react";

export interface FilterSectionProps {
  title: string;
  items: {
    label: string;
    value: string;
    checked: boolean;
  }[];
  onSelect: (value: string) => void;
}

export function FilterSection({ title, items, onSelect }: FilterSectionProps) {
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (items.length > 10 && search.length > 0) {
      return items.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      );
    }

    return items.slice(0, 10);
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

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredItems.map((item) => (
          <div key={item.value}>
            <CheckboxField
              label={item.label}
              checked={item.checked}
              onChange={() => onSelect(item.value)}
            />
          </div>
        ))}

        <button
          type="button"
          style={{
            color: "#fff",
            fontSize: 14,
            textAlign: "left",
            marginTop: 8,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          View more ({items.length - filteredItems.length})
        </button>
      </div>
    </div>
  );
}
