import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import {
  FilterDropdown,
  type FilterDropdownOption,
} from "../profile/profile-content/filter-dropdown";
import type { ShopFrameCollection } from "@types";
import { CollectionIcon, getCollectionGlyph } from "./collection-icon";

// Below this width the chips drop their names and show only the icon.
const COMPACT_WIDTH = 900;
const CHIP_GAP = 8;
// Room kept for the "N more" dropdown when some chips do not fit.
const MORE_WIDTH = 120;

type RailCollection = Pick<
  ShopFrameCollection,
  "slug" | "title" | "iconName" | "iconUrl"
>;

function RailChip({
  collection,
  isSelected,
  isCompact,
  onClick,
}: Readonly<{
  collection: RailCollection;
  isSelected: boolean;
  isCompact: boolean;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      title={isCompact ? collection.title : undefined}
      aria-label={isCompact ? collection.title : undefined}
      className={cn("shop__chip", {
        "shop__chip--selected": isSelected,
        "shop__chip--compact": isCompact,
      })}
      onClick={onClick}
    >
      <CollectionIcon
        iconName={collection.iconName}
        iconUrl={collection.iconUrl}
        className="shop__chip-icon"
      />
      {!isCompact && <span>{collection.title}</span>}
    </button>
  );
}

/**
 * One row of collections: icon and name, only the icon on narrow windows, and
 * whatever does not fit goes into a "N more" dropdown at the end.
 */
export function ShopCollectionRail({
  collections,
  selectedSlug,
  onSelect,
}: Readonly<{
  collections: RailCollection[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}>) {
  const { t } = useTranslation("shop");
  const rowRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [chipWidths, setChipWidths] = useState<number[]>([]);
  const isCompact = width > 0 && width < COMPACT_WIDTH;

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // Widths come from an invisible copy of every chip, so hiding some never changes the measure.
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    setChipWidths(
      Array.from(mirror.children, (chip) => (chip as HTMLElement).offsetWidth)
    );
  }, [collections, isCompact]);

  const visibleCount = useMemo(() => {
    if (!width || chipWidths.length === 0) return collections.length;
    const total = chipWidths.reduce((sum, chip) => sum + chip + CHIP_GAP, 0);
    if (total <= width) return collections.length;

    // chipWidths[0] is "All", which always stays.
    let used = chipWidths[0] + CHIP_GAP + MORE_WIDTH;
    let count = 0;
    for (const chip of chipWidths.slice(1)) {
      if (used + chip + CHIP_GAP > width) break;
      used += chip + CHIP_GAP;
      count += 1;
    }
    return count;
  }, [width, chipWidths, collections.length]);

  const allChip: RailCollection = {
    slug: "",
    title: t("all_collections"),
    iconName: "apps",
    iconUrl: null,
  };
  const visible = collections.slice(0, visibleCount);
  const hidden = collections.slice(visibleCount);
  const moreOptions: FilterDropdownOption<string>[] = hidden.map(
    (collection) => ({
      value: collection.slug,
      label: collection.title,
      icon: getCollectionGlyph(collection.iconName),
      imageUrl: collection.iconUrl,
    })
  );

  return (
    <div className="shop__rail-wrapper">
      <div
        ref={rowRef}
        className="shop__rail"
        role="tablist"
        aria-label={t("collections_label")}
      >
        <RailChip
          collection={allChip}
          isSelected={!selectedSlug}
          isCompact={false}
          onClick={() => onSelect(null)}
        />
        {visible.map((collection) => (
          <RailChip
            key={collection.slug}
            collection={collection}
            isSelected={collection.slug === selectedSlug}
            isCompact={isCompact}
            onClick={() =>
              onSelect(
                collection.slug === selectedSlug ? null : collection.slug
              )
            }
          />
        ))}
        {hidden.length > 0 && (
          <div
            className={cn("shop__rail-more", {
              "shop__rail-more--selected": hidden.some(
                (collection) => collection.slug === selectedSlug
              ),
            })}
          >
            <FilterDropdown
              placeholder={t("more_collections", { count: hidden.length })}
              value={selectedSlug ?? ""}
              options={moreOptions}
              onChange={onSelect}
            />
          </div>
        )}
      </div>

      <div className="shop__rail-mirror" aria-hidden="true">
        <div ref={mirrorRef} className="shop__rail-mirror-row">
          {[allChip, ...collections].map((collection, index) => (
            <RailChip
              key={collection.slug || "all"}
              collection={collection}
              isSelected={false}
              isCompact={index > 0 && isCompact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
