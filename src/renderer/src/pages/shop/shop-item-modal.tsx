import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { Button, Modal } from "@renderer/components";
import {
  CoinIcon,
  FramedAvatar,
  XpBar,
} from "@renderer/components/gamification";
import {
  useFormat,
  useGamificationMissions,
  useGamificationProgress,
  useUserDetails,
} from "@renderer/hooks";
import { getShopItemState, type ShopItem } from "./shop-catalog";

interface ShopItemModalProps {
  item: ShopItem | null;
  level: number;
  coins: number;
  onClose: () => void;
}

export function ShopItemModal({
  item,
  level,
  coins,
  onClose,
}: Readonly<ShopItemModalProps>) {
  const { t } = useTranslation("shop");
  const { formatNumber } = useFormat();
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const { progress } = useGamificationProgress();
  const { missions, refreshMissions } = useGamificationMissions();
  const state = item ? getShopItemState(item, level, coins) : null;

  // The "not enough coins" hint counts today's unclaimed dailies, so cached missions from before
  // the daily reset are fetched again.
  const isDailyExpired =
    !!missions && Date.parse(missions.daily.resetsAt) <= Date.now();
  // One refetch per expired reset, so a clock ahead of the server cannot loop.
  const refetchedResetRef = useRef<string | null>(null);
  useEffect(() => {
    if (state !== "short") return;
    if (!missions) {
      void refreshMissions();
    } else if (
      isDailyExpired &&
      refetchedResetRef.current !== missions.daily.resetsAt
    ) {
      refetchedResetRef.current = missions.daily.resetsAt;
      void refreshMissions();
    }
  }, [state, missions, isDailyExpired, refreshMissions]);

  if (!item || !state || !userDetails) return null;

  const coinsLeftToday = (
    isDailyExpired ? [] : (missions?.daily.missions ?? [])
  )
    .filter((mission) => !mission.isClaimed)
    .reduce((sum, mission) => sum + mission.coins, 0);

  const renderTicket = () => {
    const isShort = state === "short";
    return (
      <div className="shop-modal__ticket">
        <div className="shop-modal__ticket-row">
          <span>{t("price")}</span>
          <strong>
            <CoinIcon />
            {formatNumber(item.price)}
          </strong>
        </div>
        <div className="shop-modal__ticket-row">
          <span>{t("current_balance")}</span>
          <strong>
            <CoinIcon />
            {formatNumber(coins)}
          </strong>
        </div>
        <div className="shop-modal__ticket-cut">
          <i />
          <i />
        </div>
        <div
          className={cn(
            "shop-modal__ticket-row",
            "shop-modal__ticket-row--total",
            { "shop-modal__ticket-row--negative": isShort }
          )}
        >
          <span>{t(isShort ? "missing" : "balance_after")}</span>
          <strong>
            <CoinIcon size={20} />
            {formatNumber(isShort ? item.price - coins : coins - item.price)}
          </strong>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    switch (state) {
      case "buy":
        return (
          <>
            {renderTicket()}
            <div className="shop-modal__actions">
              <Button theme="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button>
                {t("buy_for_coins", { price: formatNumber(item.price) })}
              </Button>
            </div>
          </>
        );
      case "short":
        return (
          <>
            {renderTicket()}
            <p className="shop-modal__hint">
              {t("short_hint", { coins: formatNumber(coinsLeftToday) })}
            </p>
            <div className="shop-modal__actions">
              <Button theme="outline" onClick={onClose}>
                {t("close")}
              </Button>
              <Button
                onClick={() =>
                  navigate(`/profile/${userDetails.id}?tab=missions`)
                }
              >
                {t("see_missions")}
              </Button>
            </div>
          </>
        );
      case "locked":
        return (
          <>
            <div className="shop-modal__row">
              {t("locked_row", {
                level: item.levelRequired,
                current: level,
              })}
            </div>
            <div className="shop-modal__actions">
              <Button theme="outline" onClick={onClose}>
                {t("close")}
              </Button>
            </div>
          </>
        );
      default:
        return (
          <div className="shop-modal__actions">
            <Button theme="outline" onClick={onClose}>
              {t("close")}
            </Button>
            <Button>{t(item.isEquipped ? "tag_equipped" : "equip")}</Button>
          </div>
        );
    }
  };

  return (
    <Modal
      visible
      title={`${t(item.isAnimated ? "kind_animated" : "kind_simple")} ${item.name}`}
      description={t("frame_hint")}
      onClose={onClose}
      className="shop-modal"
    >
      <div className="shop-modal__body">
        <div
          className={cn("shop-modal__profile", {
            "shop-modal__profile--has-banner": userDetails.backgroundImageUrl,
          })}
        >
          {userDetails.backgroundImageUrl && (
            <img
              src={userDetails.backgroundImageUrl}
              alt=""
              className="shop-modal__banner"
            />
          )}
          <i className="shop-modal__shade" />
          <div className="shop-modal__who">
            <FramedAvatar
              size={72}
              src={userDetails.profileImageUrl}
              alt={userDetails.displayName}
            />
            <div className="shop-modal__who-text">
              <strong>{userDetails.displayName}</strong>
              {progress && (
                <span className="shop-modal__level">
                  <strong>{t("level", { level: progress.level })}</strong>
                  <XpBar
                    xp={progress.xp}
                    xpToNextLevel={progress.xpToNextLevel}
                    className="shop-modal__level-bar"
                  />
                </span>
              )}
            </div>
          </div>
        </div>

        {renderBody()}
      </div>
    </Modal>
  );
}
