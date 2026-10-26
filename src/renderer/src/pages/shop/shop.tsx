import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { LockIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { CoinIcon, FramedAvatar } from "@renderer/components/gamification";
import {
  useAppSelector,
  useFormat,
  useGamificationProgress,
  useUserDetails,
} from "@renderer/hooks";
import {
  FEATURED_ITEM,
  SHOP_ITEMS,
  getShopItemState,
  type ShopCategory,
  type ShopItem,
} from "./shop-catalog";
import { ShopItemModal } from "./shop-item-modal";
import "./shop.scss";

const CATEGORIES: ShopCategory[] = ["all", "animated", "simple"];

const isInCategory = (item: ShopItem, category: ShopCategory) =>
  category === "all" || (category === "animated") === item.isAnimated;

// Interface only: there is no shop API yet (LBX-1255), so buying and equipping do nothing.
export default function Shop() {
  const { t } = useTranslation("shop");
  const { formatNumber } = useFormat();
  const { userDetails } = useUserDetails();
  const { progress } = useGamificationProgress();
  const isEnabled = useAppSelector((state) => state.gamification.isEnabled);
  const [category, setCategory] = useState<ShopCategory>("all");
  const [hideOwned, setHideOwned] = useState(false);
  const [openItem, setOpenItem] = useState<ShopItem | null>(null);

  const level = progress?.level ?? 1;
  const coins = progress?.coins ?? 0;

  const visibleItems = useMemo(
    () =>
      SHOP_ITEMS.filter(
        (item) => isInCategory(item, category) && (!hideOwned || !item.isOwned)
      ),
    [category, hideOwned]
  );

  if (!isEnabled || !progress || !userDetails) return null;

  const countIn = (target: ShopCategory) =>
    SHOP_ITEMS.filter(
      (item) => isInCategory(item, target) && (!hideOwned || !item.isOwned)
    ).length;
  const ownedCount = SHOP_ITEMS.filter((item) => item.isOwned).length;

  const renderPrice = (item: ShopItem) => {
    switch (getShopItemState(item, level, coins)) {
      case "owned":
        return item.isEquipped ? (
          <span className="shop__price shop__price--muted">
            {t("equipped_on_profile")}
          </span>
        ) : (
          <span className="shop__price shop__price--equip">{t("equip")}</span>
        );
      case "locked":
        return (
          <span className="shop__price shop__price--muted">
            <LockIcon size={14} />
            {t("level_required", { level: item.levelRequired })}
          </span>
        );
      case "short":
        return (
          <span className="shop__price shop__price--muted">
            <CoinIcon />
            {t("price_short", {
              price: formatNumber(item.price),
              missing: formatNumber(item.price - coins),
            })}
          </span>
        );
      default:
        return (
          <span className="shop__price">
            <CoinIcon />
            {formatNumber(item.price)}
          </span>
        );
    }
  };

  const renderTag = (item: ShopItem) => {
    if (item.isEquipped) {
      return (
        <span className="shop__tag shop__tag--equipped">
          {t("tag_equipped")}
        </span>
      );
    }
    if (item.isOwned) {
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
    if (item.isNew) {
      return <span className="shop__tag shop__tag--new">{t("tag_new")}</span>;
    }
    return null;
  };

  const featuredState = getShopItemState(FEATURED_ITEM, level, coins);

  const renderFeaturedAction = () => {
    if (featuredState === "owned") {
      return FEATURED_ITEM.isEquipped ? (
        <Button theme="outline">{t("remove")}</Button>
      ) : (
        <Button>{t("equip")}</Button>
      );
    }
    if (featuredState === "locked") {
      return (
        <span className="shop__price shop__price--muted">
          <LockIcon size={14} />
          {t("level_required", { level: FEATURED_ITEM.levelRequired })}
        </span>
      );
    }
    return (
      <>
        <Button onClick={() => setOpenItem(FEATURED_ITEM)}>
          {t("buy_for")}
          <CoinIcon />
          {formatNumber(FEATURED_ITEM.price)}
        </Button>
        {featuredState === "short" && (
          <span className="shop__featured-short">
            {t("missing_coins", {
              count: FEATURED_ITEM.price - coins,
              amount: formatNumber(FEATURED_ITEM.price - coins),
            })}
          </span>
        )}
      </>
    );
  };

  return (
    <div className="shop">
      <section
        className={cn("shop__featured", {
          "shop__featured--has-banner": userDetails.backgroundImageUrl,
        })}
      >
        {userDetails.backgroundImageUrl && (
          <img
            src={userDetails.backgroundImageUrl}
            alt=""
            className="shop__featured-banner"
          />
        )}

        <div className="shop__featured-avatar">
          <FramedAvatar
            size={132}
            src={userDetails.profileImageUrl}
            alt={userDetails.displayName}
          />
          <span>{userDetails.displayName}</span>
        </div>

        <div className="shop__featured-text">
          <span className="shop__chip">{t("featured_chip")}</span>
          <h2>{FEATURED_ITEM.name}</h2>
          <p>{FEATURED_ITEM.description}</p>
          <div className="shop__featured-actions">{renderFeaturedAction()}</div>
        </div>
      </section>

      <div className="shop__bar">
        <div className="shop__tabs" role="tablist">
          {CATEGORIES.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              className={cn("shop__tab", {
                "shop__tab--active": category === id,
              })}
              onClick={() => setCategory(id)}
            >
              {t(`tab_${id}`)}
              <span className="shop__count">{countIn(id)}</span>
            </button>
          ))}
        </div>

        <div className="shop__bar-right">
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
            <strong>{formatNumber(coins)}</strong>
            {t("coins", { count: coins })}
          </span>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="shop__empty">{t("empty_category")}</div>
      ) : (
        <div className="shop__grid">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="shop__item"
              onClick={() => setOpenItem(item)}
            >
              <span className="shop__item-art">
                <FramedAvatar size={64} isFrameOnly />
                {renderTag(item)}
              </span>
              <span className="shop__item-meta">
                <small>
                  {t(item.isAnimated ? "kind_animated" : "kind_simple")}
                </small>
                <strong>{item.name}</strong>
                {renderPrice(item)}
              </span>
            </button>
          ))}
        </div>
      )}

      <ShopItemModal
        item={openItem}
        level={level}
        coins={coins}
        onClose={() => setOpenItem(null)}
      />
    </div>
  );
}
