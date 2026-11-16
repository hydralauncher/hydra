import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDownIcon,
  SearchIcon,
  SortAscIcon,
  SortDescIcon,
  XIcon,
} from "@primer/octicons-react";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { Button } from "@renderer/components";
import { CoinIcon, FramedAvatar } from "@renderer/components/gamification";
import {
  useAppSelector,
  useFormat,
  useGamificationProgress,
  useUserDetails,
} from "@renderer/hooks";
import type { ShopFrame, ShopFrameCollection } from "@types";
import {
  FilterDropdown,
  type FilterDropdownOption,
} from "../profile/profile-content/filter-dropdown";
import { sectionVariants } from "../profile/profile-content/profile-animations";
import { CollectionIcon } from "./collection-icon";
import {
  ShopCarouselDots,
  ShopCarouselRow,
  useShopCarousel,
} from "./shop-carousel";
import { ShopCollectionRail } from "./shop-collection-rail";
import { getShopFrameState } from "./shop-frame-state";
import { ShopItemModal } from "./shop-item-modal";
import { useShopFrames } from "./use-shop-frames";
import "./shop.scss";

const NEW_FRAME_DAYS = 14;
// Typing filters after a short pause, so the list doesn't flash on every key.
const SEARCH_DELAY_MS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKELETON_SECTIONS = 2;
const SKELETON_CARDS = 5;
const SKELETON_CHIPS = [90, 150, 130, 190, 140];

type FrameTab = "all" | "animated" | "static" | "not_owned";
type CollectionSort = "updated" | "oldest" | "name_asc" | "name_desc";

const FRAME_TABS: FrameTab[] = ["all", "animated", "static", "not_owned"];

const isNewFrame = (frame: ShopFrame) =>
  Date.now() - Date.parse(frame.releasedAt) < NEW_FRAME_DAYS * DAY_MS;

const matchesTab = (frame: ShopFrame, tab: FrameTab) => {
  if (tab === "animated") return frame.assetType === "VIDEO";
  if (tab === "static") return frame.assetType === "IMAGE";
  if (tab === "not_owned") return !frame.isOwned;
  return true;
};

// Accents and case don't matter: "relampago" finds "Relâmpago".
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const updatedTime = (collection: ShopFrameCollection) =>
  Date.parse(collection.updatedAt ?? collection.releasedAt ?? "") || 0;

const compareCollections = (sort: CollectionSort, locale: string) => {
  return (a: ShopFrameCollection, b: ShopFrameCollection) => {
    if (sort === "name_asc") return a.title.localeCompare(b.title, locale);
    if (sort === "name_desc") return b.title.localeCompare(a.title, locale);
    const difference = updatedTime(b) - updatedTime(a);
    return sort === "oldest" ? -difference : difference;
  };
};

// Memoized: a filter change only flips `isHidden`, so the other cards don't re-render.
const ShopFrameCard = memo(function ShopFrameCard({
  frame,
  collection,
  coins,
  isHidden,
  onOpen,
}: Readonly<{
  frame: ShopFrame;
  collection: ShopFrameCollection;
  coins: number;
  isHidden: boolean;
  onOpen: (frame: ShopFrame) => void;
}>) {
  const { t } = useTranslation("shop");
  const { formatNumber } = useFormat();
  const state = getShopFrameState(frame, coins);

  const renderTag = () => {
    if (frame.isEquipped) {
      return (
        <span className="shop__tag shop__tag--equipped">
          {t("tag_equipped")}
        </span>
      );
    }
    if (frame.isOwned) {
      return (
        <span
          className="shop__owned-check"
          role="img"
          aria-label={t("in_collection")}
          title={t("in_collection")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 8.4 6.8 11 12 5.2" />
          </svg>
        </span>
      );
    }
    if (isNewFrame(frame)) {
      return <span className="shop__tag shop__tag--new">{t("tag_new")}</span>;
    }
    return null;
  };

  const renderPrice = () => {
    if (state === "owned") {
      return frame.isEquipped ? (
        <span className="shop__price shop__price--muted">
          {t("equipped_on_profile")}
        </span>
      ) : (
        <span className="shop__price shop__price--equip">{t("equip")}</span>
      );
    }
    if (state === "short") {
      return (
        <span className="shop__price shop__price--muted">
          <CoinIcon />
          {t("price_short", {
            price: formatNumber(frame.price),
            missing: formatNumber(frame.price - coins),
          })}
        </span>
      );
    }
    return (
      <span className="shop__price">
        <CoinIcon />
        {formatNumber(frame.price)}
      </span>
    );
  };

  return (
    <button
      type="button"
      className="shop__item"
      hidden={isHidden}
      onClick={() => onOpen(frame)}
    >
      <span className="shop__item-art">
        <FramedAvatar size={64} isFrameOnly frame={frame} />
        {renderTag()}
      </span>
      <span className="shop__item-meta">
        <small>
          {t("kind_by_author", {
            kind: t(
              frame.assetType === "VIDEO" ? "kind_animated" : "kind_simple"
            ),
            author: collection.author.name,
          })}
        </small>
        <strong>{frame.name}</strong>
        {renderPrice()}
      </span>
    </button>
  );
});

function ShopCollectionSection({
  collection,
  visibleKeys,
  coins,
  onOpen,
}: Readonly<{
  collection: ShopFrameCollection;
  visibleKeys: ReadonlySet<string>;
  coins: number;
  onOpen: (frame: ShopFrame) => void;
}>) {
  const { t } = useTranslation("shop");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const visibleCount = collection.frames.filter((frame) =>
    visibleKeys.has(frame.key)
  ).length;
  const { rowRef, pages } = useShopCarousel(visibleCount);
  const authorUrl = collection.author.url;

  return (
    <section className="shop__collection" hidden={visibleCount === 0}>
      <header className="shop__collection-header">
        <CollectionIcon
          iconName={collection.iconName}
          iconUrl={collection.iconUrl}
          size={16}
          className="shop__collection-icon"
        />
        <button
          type="button"
          className="shop__collection-title"
          aria-expanded={!isCollapsed}
          onClick={() => setIsCollapsed((value) => !value)}
        >
          <h2>{collection.title}</h2>
          <ChevronDownIcon
            size={16}
            className={cn("shop__collection-chevron", {
              "shop__collection-chevron--collapsed": isCollapsed,
            })}
          />
        </button>
        {/* The rule fills the row up to the author, so a short row never looks empty. */}
        <span className="shop__collection-rule" aria-hidden="true" />
        <span className="shop__collection-author">
          {t("by")}{" "}
          {authorUrl ? (
            <button
              type="button"
              className="shop__author-link"
              onClick={() => void window.electron.openExternal(authorUrl)}
            >
              @{collection.author.name}
            </button>
          ) : (
            <strong>@{collection.author.name}</strong>
          )}
        </span>
        {!isCollapsed && (
          <ShopCarouselDots pages={pages} label={collection.title} />
        )}
      </header>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="row"
            className="shop__collection-body"
            variants={sectionVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
          >
            <ShopCarouselRow rowRef={rowRef}>
              {collection.frames.map((frame) => (
                <ShopFrameCard
                  key={frame.key}
                  frame={frame}
                  collection={collection}
                  coins={coins}
                  isHidden={!visibleKeys.has(frame.key)}
                  onOpen={onOpen}
                />
              ))}
            </ShopCarouselRow>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ShopSkeleton() {
  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <div className="shop__rail" aria-hidden="true">
        {SKELETON_CHIPS.map((width) => (
          <Skeleton
            key={width}
            width={width}
            height={36}
            borderRadius={8}
            containerClassName="shop__skeleton-chip"
          />
        ))}
      </div>
      {Array.from({ length: SKELETON_SECTIONS }, (_, section) => (
        <section key={section} className="shop__collection" aria-hidden="true">
          <div className="shop__collection-header">
            <Skeleton width={32} height={32} borderRadius={8} />
            <Skeleton width={180} height={20} />
          </div>
          <div className="shop__carousel">
            {Array.from({ length: SKELETON_CARDS }, (_, card) => (
              <Skeleton
                key={card}
                width={220}
                height={232}
                borderRadius={4}
                containerClassName="shop__skeleton-card"
              />
            ))}
          </div>
        </section>
      ))}
    </SkeletonTheme>
  );
}

export default function Shop() {
  const { t, i18n } = useTranslation("shop");
  const { formatNumber } = useFormat();
  const { userDetails } = useUserDetails();
  const { progress, refreshProgress } = useGamificationProgress();
  const isEnabled = useAppSelector(
    (state) => state.gamification.isEnabled && state.gamification.isShopEnabled
  );
  const areFeaturesLoaded = useAppSelector(
    (state) => state.gamification.areFeaturesLoaded
  );
  const { collections, hasFailed, reload, purchase, equip } =
    useShopFrames(isEnabled);
  const [tab, setTab] = useState<FrameTab>("all");
  const [sort, setSort] = useState<CollectionSort>("updated");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [openFrameKey, setOpenFrameKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // The balance decides what can be bought, so it is read fresh on open.
  useEffect(() => {
    if (isEnabled) void refreshProgress();
  }, [isEnabled, refreshProgress]);

  const sortedCollections = useMemo(
    () =>
      [...(collections ?? [])].sort(compareCollections(sort, i18n.language)),
    [collections, sort, i18n.language]
  );

  // Filters hide cards instead of unmounting them: remounting dozens of videos is what made it stall.
  const visibleKeys = useMemo(() => {
    const term = normalize(appliedQuery.trim());
    const keys = new Set<string>();
    for (const collection of collections ?? []) {
      if (selectedSlug && collection.slug !== selectedSlug) continue;
      const collectionMatches =
        !term || normalize(collection.title).includes(term);
      for (const frame of collection.frames) {
        if (
          matchesTab(frame, tab) &&
          (collectionMatches || normalize(frame.name).includes(term))
        ) {
          keys.add(frame.key);
        }
      }
    }
    return keys;
  }, [collections, selectedSlug, appliedQuery, tab]);

  const handleOpenFrame = useCallback(
    (frame: ShopFrame) => setOpenFrameKey(frame.key),
    []
  );

  if (!isEnabled) return areFeaturesLoaded ? <Navigate to="/" replace /> : null;
  if (!progress || !userDetails) return null;

  const coins = progress.coins;
  const isFiltering = tab !== "all" || !!selectedSlug || !!appliedQuery.trim();
  const resultCount = visibleKeys.size;
  // The modal follows purchases and equips, so it reads the frame from the latest catalogue.
  const openFrame = collections
    ?.flatMap((collection) => collection.frames)
    .find((frame) => frame.key === openFrameKey);

  const sortOptions: FilterDropdownOption<CollectionSort>[] = [
    { value: "updated", label: t("sort_updated"), icon: SortDescIcon },
    { value: "oldest", label: t("sort_oldest"), icon: SortAscIcon },
    { value: "name_asc", label: t("sort_name_asc"), icon: SortAscIcon },
    { value: "name_desc", label: t("sort_name_desc"), icon: SortDescIcon },
  ];

  const clearFilters = () => {
    setTab("all");
    setSelectedSlug(null);
    setQuery("");
    setAppliedQuery("");
  };

  const renderContent = () => {
    if (hasFailed) {
      return (
        <div className="shop__empty">
          <p>{t("load_failed")}</p>
          <Button theme="outline" onClick={() => void reload()}>
            {t("try_again")}
          </Button>
        </div>
      );
    }
    if (!collections) return <ShopSkeleton />;

    return (
      <>
        <ShopCollectionRail
          collections={sortedCollections}
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
        />

        {isFiltering && (
          <div className="shop__results" aria-live="polite">
            <span>
              <strong>{t("results_count", { count: resultCount })}</strong>
              {appliedQuery.trim() && (
                <> {t("results_for", { query: appliedQuery.trim() })}</>
              )}
            </span>
            <button
              type="button"
              className="shop__clear"
              onClick={clearFilters}
            >
              <XIcon size={12} />
              {t("clear_filters")}
            </button>
          </div>
        )}

        {/* Kept mounted across filters: cards are hidden, not removed, so nothing reloads. */}
        <div>
          {resultCount === 0 && (
            <div className="shop__empty">
              {t(collections.length === 0 ? "empty_shop" : "empty_results")}
            </div>
          )}
          {sortedCollections.map((collection) => (
            <ShopCollectionSection
              key={collection.slug}
              collection={collection}
              visibleKeys={visibleKeys}
              coins={coins}
              onOpen={handleOpenFrame}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="shop">
      {/* Sticks to the top while scrolling, so the balance is always in view. */}
      <div className="shop__bar">
        <div
          className="shop__tabs"
          role="tablist"
          aria-label={t("type_filter")}
        >
          {FRAME_TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={cn("shop__tab", {
                "shop__tab--active": tab === value,
              })}
              onClick={() => setTab(value)}
            >
              {t(`tab_${value}`)}
            </button>
          ))}
        </div>
        <FilterDropdown
          placeholder={t("sort_label")}
          value={sort}
          options={sortOptions}
          onChange={setSort}
        />
        <label className="shop__search">
          <SearchIcon size={14} />
          <input
            type="search"
            value={query}
            placeholder={t("search_placeholder")}
            aria-label={t("search_placeholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="shop__balance">
          <CoinIcon />
          {t("coins_balance", { count: coins, amount: formatNumber(coins) })}
        </span>
      </div>

      {renderContent()}

      {openFrame && (
        <ShopItemModal
          frame={openFrame}
          coins={coins}
          onPurchase={purchase}
          onEquip={equip}
          onClose={() => setOpenFrameKey(null)}
        />
      )}
    </div>
  );
}
