import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { useFormat } from "@renderer/hooks";
import { ChevronDownIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const content = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);
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

  useEffect(() => {
    if (content.current && content.current.scrollHeight !== height) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    } else if (!isOpen) {
      setHeight(0);
    }
  }, [isOpen, filteredItems, height, search]);

  if (!items.length) {
    return null;
  }

  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-section__button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <ChevronDownIcon
          className={`filter-section__chevron ${
            isOpen ? "filter-section__chevron--open" : ""
          }`}
        />
        <div className="filter-section__header">
          <div
            className="filter-section__orb"
            style={{ backgroundColor: color }}
          />
          <h3 className="filter-section__title">{title}</h3>
          <span className="filter-section__header-count">
            {formatNumber(selectedItemsCount || items.length)}
          </span>
        </div>
      </button>

      <div
        ref={content}
        className="filter-section__content"
        style={{ maxHeight: `${height}px` }}
      >
        <div className="filter-section__content-inner">
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
            height={
              28 * (filteredItems.length > 10 ? 10 : filteredItems.length)
            }
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
      </div>
    </div>
  );
}
