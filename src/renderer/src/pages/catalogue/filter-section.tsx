import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { useFormat } from "@renderer/hooks";
import { ChevronDownIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./filter.scss";
import List from "rc-virtual-list";
import { useTranslation } from "react-i18next";

type FilterSectionItem = {
  label: string;
  value: string | number;
  checked: boolean;
};

export interface FilterSectionProps {
  title: string;
  items: FilterSectionItem[] | (() => FilterSectionItem[]);
  itemCount?: number;
  selectedItemCount?: number;
  defaultOpen?: boolean;
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
  itemCount,
  selectedItemCount,
  defaultOpen = true,
}: FilterSectionProps) {
  const content = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(0);
  const { t } = useTranslation("catalogue");
  const hasDeferredItems = typeof items === "function";

  const resolvedItems = useMemo<FilterSectionItem[]>(() => {
    if (typeof items === "function") {
      return isOpen ? items() : [];
    }

    return items;
  }, [isOpen, items]);

  const resolvedItemCount = itemCount ?? resolvedItems.length;

  const filteredItems = useMemo(() => {
    if (search.length > 0) {
      return resolvedItems.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      );
    }

    return resolvedItems;
  }, [resolvedItems, search]);

  const resolvedSelectedItemCount = useMemo(
    () =>
      selectedItemCount ?? resolvedItems.filter((item) => item.checked).length,
    [resolvedItems, selectedItemCount]
  );

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

  if (!resolvedItemCount) {
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
            {formatNumber(resolvedSelectedItemCount || resolvedItemCount)}
          </span>
        </div>
      </button>

      <div
        ref={content}
        className="filter-section__content"
        style={{ maxHeight: `${height}px` }}
      >
        {isOpen || !hasDeferredItems ? (
          <div className="filter-section__content-inner">
            {resolvedSelectedItemCount > 0 ? (
              <button
                type="button"
                className="filter-section__clear-button"
                onClick={onClear}
              >
                {t("clear_filters", {
                  filterCount: formatNumber(resolvedSelectedItemCount),
                })}
              </button>
            ) : (
              <span className="filter-section__count">
                {t("filter_count", {
                  filterCount: formatNumber(resolvedItemCount),
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
        ) : null}
      </div>
    </div>
  );
}
