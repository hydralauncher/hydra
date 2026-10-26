import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { useFormat } from "@renderer/hooks";
import type { CatalogueFilterListKey } from "@renderer/features";
import { ChevronDownIcon } from "@primer/octicons-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./filter.scss";
import List from "rc-virtual-list";
import { useTranslation } from "react-i18next";

export interface FilterSectionItem {
  label: string;
  value: string | number;
  group?: string;
}

export interface FilterSectionProps {
  title: string;
  sectionKey: CatalogueFilterListKey;
  items: FilterSectionItem[];
  selectedValues: readonly (string | number)[];
  groups?: readonly {
    label: string;
    value: string;
  }[];
  onToggle: (key: CatalogueFilterListKey, value: string | number) => void;
  color: string;
  onClear: (key: CatalogueFilterListKey) => void;
}

export const FilterSection = memo(function FilterSection({
  title,
  sectionKey,
  items,
  selectedValues,
  groups,
  color,
  onToggle,
  onClear,
}: FilterSectionProps) {
  const content = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(0);
  const { t } = useTranslation("catalogue");

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const availableGroups = useMemo(() => {
    return (groups ?? []).filter((group) =>
      items.some((item) => item.group === group.value)
    );
  }, [groups, items]);

  const activeGroup = useMemo(() => {
    if (
      selectedGroup &&
      availableGroups.some((group) => group.value === selectedGroup)
    ) {
      return selectedGroup;
    }

    return (
      availableGroups.find((group) =>
        items.some(
          (item) => item.group === group.value && selectedSet.has(item.value)
        )
      )?.value ??
      availableGroups[0]?.value ??
      null
    );
  }, [availableGroups, items, selectedGroup, selectedSet]);

  const visibleItems = useMemo(() => {
    if (!activeGroup) return items;
    return items.filter((item) => item.group === activeGroup);
  }, [activeGroup, items]);

  const filteredItems = useMemo(() => {
    if (deferredSearch.length > 0) {
      const query = deferredSearch.toLowerCase();
      return visibleItems.filter((item) =>
        item.label.toLowerCase().includes(query)
      );
    }

    return visibleItems;
  }, [visibleItems, deferredSearch]);

  const selectedItemsCount = useMemo(() => {
    if (selectedSet.size === 0) return 0;
    return items.filter((item) => selectedSet.has(item.value)).length;
  }, [items, selectedSet]);

  const { formatNumber } = useFormat();

  useEffect(() => {
    if (content.current && content.current.scrollHeight !== height) {
      setHeight(isOpen ? content.current.scrollHeight : 0);
    } else if (!isOpen) {
      setHeight(0);
    }
  }, [isOpen, filteredItems, height, selectedItemsCount]);

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
              onClick={() => onClear(sectionKey)}
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

          {availableGroups.length > 1 && (
            <div
              className="filter-section__group-tabs"
              role="tablist"
              aria-label={title}
            >
              {availableGroups.map((group) => {
                const selectedInGroup = items.filter(
                  (item) =>
                    item.group === group.value && selectedSet.has(item.value)
                ).length;

                return (
                  <button
                    key={group.value}
                    type="button"
                    role="tab"
                    aria-selected={activeGroup === group.value}
                    className={`filter-section__group-tab ${
                      activeGroup === group.value
                        ? "filter-section__group-tab--active"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedGroup(group.value);
                      setSearch("");
                    }}
                  >
                    <span>{group.label}</span>
                    {selectedInGroup > 0 && (
                      <span className="filter-section__group-tab-count">
                        {formatNumber(selectedInGroup)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <TextField
            placeholder={t("search")}
            onChange={(e) => setSearch(e.target.value)}
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
                  checked={selectedSet.has(item.value)}
                  onChange={() => onToggle(sectionKey, item.value)}
                />
              </div>
            )}
          </List>
        </div>
      </div>
    </div>
  );
});
