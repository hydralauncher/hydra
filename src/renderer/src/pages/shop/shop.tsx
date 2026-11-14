import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import cn from "classnames";
import { ChevronDownIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
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
  ShopCarouselDots,
  ShopCarouselRow,
  useShopCarousel,
} from "./shop-carousel";
import { getShopFrameState } from "./shop-frame-state";
import { ShopItemModal } from "./shop-item-modal";
import { useShopFrames } from "./use-shop-frames";
import "./shop.scss";

const NEW_COLLECTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKELETON_SECTIONS = 2;
const SKELETON_CARDS = 5;

const isNewCollection = (collection: ShopFrameCollection) =>
  !!collection.releasedAt &&
  Date.now() - Date.parse(collection.releasedAt) < NEW_COLLECTION_DAYS * DAY_MS;

function ShopFrameCard({
  frame,
  collection,
  coins,
  onOpen,
}: Readonly<{
  frame: ShopFrame;
  collection: ShopFrameCollection;
  coins: number;
  onOpen: () => void;
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
    if (isNewCollection(collection)) {
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
    <button type="button" className="shop__item" onClick={onOpen}>
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
}

function ShopCollectionSection({
  collection,
  frames,
  coins,
  onOpen,
}: Readonly<{
  collection: ShopFrameCollection;
  frames: ShopFrame[];
  coins: number;
  onOpen: (frame: ShopFrame) => void;
}>) {
  const { t } = useTranslation("shop");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { rowRef, pages } = useShopCarousel();
  const authorUrl = collection.author.url;

  return (
    <section className="shop__collection">
      <header className="shop__collection-header">
        {collection.iconUrl && (
          <span className="shop__collection-icon">
            <img src={collection.iconUrl} alt="" />
          </span>
        )}
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

      {!isCollapsed && (
        <ShopCarouselRow rowRef={rowRef}>
          {frames.map((frame) => (
            <ShopFrameCard
              key={frame.key}
              frame={frame}
              collection={collection}
              coins={coins}
              onOpen={() => onOpen(frame)}
            />
          ))}
        </ShopCarouselRow>
      )}
    </section>
  );
}

export default function Shop() {
  const { t } = useTranslation("shop");
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
  const [hideOwned, setHideOwned] = useState(false);

  // The balance decides what can be bought, so it is read fresh on open.
  useEffect(() => {
    if (isEnabled) void refreshProgress();
  }, [isEnabled, refreshProgress]);
  const [openFrameKey, setOpenFrameKey] = useState<string | null>(null);

  const visibleCollections = useMemo(
    () =>
      (collections ?? [])
        .map((collection) => ({
          collection,
          frames: collection.frames.filter(
            (frame) => !hideOwned || !frame.isOwned
          ),
        }))
        .filter(({ frames }) => frames.length > 0),
    [collections, hideOwned]
  );

  if (!isEnabled) return areFeaturesLoaded ? <Navigate to="/" replace /> : null;
  if (!progress || !userDetails) return null;

  const coins = progress.coins;
  const ownedCount = (collections ?? []).reduce(
    (total, collection) =>
      total + collection.frames.filter((frame) => frame.isOwned).length,
    0
  );
  // The modal follows purchases and equips, so it reads the frame from the latest catalogue.
  const openFrame = collections
    ?.flatMap((collection) => collection.frames)
    .find((frame) => frame.key === openFrameKey);

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
    if (!collections) {
      return Array.from({ length: SKELETON_SECTIONS }, (_, section) => (
        <section key={section} className="shop__collection" aria-hidden="true">
          <Skeleton width={220} height={24} />
          <div className="shop__carousel">
            {Array.from({ length: SKELETON_CARDS }, (_, card) => (
              <Skeleton
                key={card}
                width={220}
                height={232}
                containerClassName="shop__skeleton-card"
              />
            ))}
          </div>
        </section>
      ));
    }
    if (visibleCollections.length === 0) {
      return (
        <div className="shop__empty">
          {t(collections.length === 0 ? "empty_shop" : "empty_owned_all")}
        </div>
      );
    }
    return visibleCollections.map(({ collection, frames }) => (
      <ShopCollectionSection
        key={collection.slug}
        collection={collection}
        frames={frames}
        coins={coins}
        onOpen={(frame) => setOpenFrameKey(frame.key)}
      />
    ));
  };

  return (
    <div className="shop">
      <div className="shop__bar">
        <label className="shop__toggle">
          <input
            type="checkbox"
            checked={hideOwned}
            onChange={(event) => setHideOwned(event.target.checked)}
          />
          <span />
          {t("hide_owned")}
          <small className="shop__count">{ownedCount}</small>
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
