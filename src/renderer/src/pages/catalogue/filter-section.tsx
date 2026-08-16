import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { useFormat } from "@renderer/hooks";
import { ChevronDownIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import List from "rc-virtual-list";
import { useTranslation } from "react-i18next";
import "./filter.scss";

export interface FilterSectionProps {
  title: string;
  items: {
    label: string;
    value: string | number;
    checked: boolean;
  }[];
  onSelect: (value: string | number) => void;
  color?: string;
  icon?: React.ReactNode;
  onClear: () => void;
}

export function FilterSection({
  title,
  items,
  icon,
  onSelect,
  onClear,
}: Readonly<FilterSectionProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation("catalogue");
  const { formatNumber } = useFormat();

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const lower = search.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower));
  }, [items, search]);

  const selectedCount = useMemo(
    () => items.filter((item) => item.checked).length,
    [items]
  );

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClickOutside, handleKeyDown]);

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`filter-dropdown__trigger ${
          isOpen ? "filter-dropdown__trigger--open" : ""
        } ${selectedCount > 0 ? "filter-dropdown__trigger--active" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {icon && <span className="filter-dropdown__icon">{icon}</span>}
        <span className="filter-dropdown__title">{title}</span>
        {selectedCount > 0 && (
          <span className="filter-dropdown__badge">
            {formatNumber(selectedCount)}
          </span>
        )}
        <ChevronDownIcon
          className={`filter-dropdown__chevron ${
            isOpen ? "filter-dropdown__chevron--open" : ""
          }`}
          size={12}
        />
      </button>

      {isOpen && (
        <div className="filter-dropdown__popover">
          <div className="filter-dropdown__header">
            <span className="filter-dropdown__count">
              {t("filter_count", {
                filterCount: formatNumber(items.length),
              })}
            </span>
            {selectedCount > 0 && (
              <button
                type="button"
                className="filter-dropdown__clear-btn"
                onClick={onClear}
              >
                {t("clear_filters", {
                  filterCount: formatNumber(selectedCount),
                })}
              </button>
            )}
          </div>

          <div className="filter-dropdown__search-box">
            <SearchIcon size={12} className="filter-dropdown__search-icon" />
            <input
              type="text"
              className="filter-dropdown__search-input"
              placeholder={t("search", { defaultValue: "Filtrar..." })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="filter-dropdown__search-clear"
                onClick={() => setSearch("")}
              >
                <XIcon size={10} />
              </button>
            )}
          </div>

          {filteredItems.length === 0 ? (
            <div className="filter-dropdown__empty">
              {t("no_results", { defaultValue: "Nenhum resultado" })}
            </div>
          ) : (
            <List
              data={filteredItems}
              height={
                30 * (filteredItems.length > 7 ? 7 : filteredItems.length)
              }
              itemHeight={30}
              itemKey="value"
              styles={{
                verticalScrollBar: {
                  backgroundColor: "rgba(255, 255, 255, 0.02)",
                  width: 5,
                },
                verticalScrollBarThumb: {
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  borderRadius: "10px",
                },
              }}
            >
              {(item) => (
                <div key={item.value} className="filter-dropdown__item">
                  <CheckboxField
                    label={item.label}
                    checked={item.checked}
                    onChange={() => onSelect(item.value)}
                  />
                </div>
              )}
            </List>
          )}
        </div>
      )}
    </div>
  );
}
