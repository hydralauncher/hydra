import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { useFormat } from "@renderer/hooks";
import { ChevronDownIcon } from "@primer/octicons-react";
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
    group?: string;
  }[];
  groups?: readonly {
    label: string;
    value: string;
  }[];
  onSelect: (value: string | number) => void;
  color: string;
  onClear: () => void;
  /** The list hasn't loaded yet: keep the section's full height meanwhile. */
  isLoading?: boolean;
}

const FILTER_ITEM_HEIGHT = 28;
const FILTER_VISIBLE_ITEMS = 10;

export function FilterSection({
  title,
  items,
  groups,
  color,
  onSelect,
  onClear,
  isLoading = false,
}: FilterSectionProps) {
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const { t } = useTranslation("catalogue");

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
        items.some((item) => item.checked && item.group === group.value)
      )?.value ??
      availableGroups[0]?.value ??
      null
    );
  }, [availableGroups, items, selectedGroup]);

  const visibleItems = useMemo(() => {
    if (!activeGroup) return items;
    return items.filter((item) => item.group === activeGroup);
  }, [activeGroup, items]);

  const filteredItems = useMemo(() => {
    if (search.length > 0) {
      return visibleItems.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase())
      );
    }

    return visibleItems;
  }, [visibleItems, search]);

  const selectedItemsCount = useMemo(() => {
    return items.filter((item) => item.checked).length;
  }, [items]);

  const onSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const { formatNumber } = useFormat();

  const isWaitingForItems = isLoading && !items.length;

  if (!items.length && !isLoading) {
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
          <span
            className="filter-section__header-count"
            style={isWaitingForItems ? { visibility: "hidden" } : undefined}
          >
            {formatNumber(selectedItemsCount || items.length)}
          </span>
        </div>
      </button>

      <div
        className={`filter-section__content${isOpen ? "" : " filter-section__content--closed"}`}
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

          {availableGroups.length > 1 && (
            <div
              className="filter-section__group-tabs"
              role="tablist"
              aria-label={title}
            >
              {availableGroups.map((group) => {
                const selectedInGroup = items.filter(
                  (item) => item.checked && item.group === group.value
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
            onChange={(e) => onSearch(e.target.value)}
            value={search}
            containerProps={{ className: "filter-section__search" }}
            theme="dark"
          />

          {isWaitingForItems && (
            <div
              className="filter-section__list-placeholder"
              style={{ height: FILTER_ITEM_HEIGHT * FILTER_VISIBLE_ITEMS }}
              aria-busy="true"
            />
          )}

          <List
            data={filteredItems}
            height={
              FILTER_ITEM_HEIGHT *
              Math.min(filteredItems.length, FILTER_VISIBLE_ITEMS)
            }
            itemHeight={FILTER_ITEM_HEIGHT}
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
