import { useEffect, useRef, useState } from "react";
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
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { getHeroBackgroundFromImageUrl } from "@renderer/helpers";
import { DEFAULT_USER_PROFILE_BACKGROUND } from "@renderer/context";
import type { FramePurchaseResponse, ShopFrame } from "@types";
import { getShopFrameState } from "./shop-frame-state";

interface ShopItemModalProps {
  frame: ShopFrame;
  coins: number;
  onPurchase: (key: string) => Promise<FramePurchaseResponse>;
  onEquip: (key: string | null) => Promise<void>;
  onClose: () => void;
}

export function ShopItemModal({
  frame: item,
  coins,
  onPurchase,
  onEquip,
  onClose,
}: Readonly<ShopItemModalProps>) {
  const { t } = useTranslation("shop");
  const { formatNumber } = useFormat();
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const { progress, refreshProgress } = useGamificationProgress();
  const { missions, refreshMissions } = useGamificationMissions();
  const { showSuccessToast, showErrorToast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [heroBackground, setHeroBackground] = useState(
    DEFAULT_USER_PROFILE_BACKGROUND
  );
  const state = getShopFrameState(item, coins);

  // Same background your profile shows without a banner: the color of your photo.
  const profileImageUrl = userDetails?.profileImageUrl;
  useEffect(() => {
    if (!profileImageUrl) return;
    let isCancelled = false;
    getHeroBackgroundFromImageUrl(profileImageUrl)
      .then((background) => {
        if (!isCancelled) setHeroBackground(background);
      })
      .catch(() => undefined);
    return () => {
      isCancelled = true;
    };
  }, [profileImageUrl]);
  const kind = t(item.assetType === "VIDEO" ? "kind_animated" : "kind_simple");

  const buy = async () => {
    setIsPending(true);
    try {
      await onPurchase(item.key);
      await refreshProgress();
      showSuccessToast(
        t("purchased_title", {
          price: formatNumber(item.price),
          kind,
          name: item.name,
        }),
        t("purchased_hint")
      );
    } catch {
      showErrorToast(t("purchase_failed"), t("purchase_failed_hint"));
    } finally {
      setIsPending(false);
    }
  };

  const toggleEquipped = async () => {
    setIsPending(true);
    try {
      await onEquip(item.isEquipped ? null : item.key);
      showSuccessToast(t(item.isEquipped ? "removed_title" : "equipped_title"));
      onClose();
    } catch {
      showErrorToast(t("equip_failed"));
    } finally {
      setIsPending(false);
    }
  };

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

  if (!userDetails) return null;

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
              <Button onClick={() => void buy()} disabled={isPending}>
                {isPending
                  ? t("confirming")
                  : t("buy_for_coins", { price: formatNumber(item.price) })}
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
      default:
        return (
          <div className="shop-modal__actions">
            <Button theme="outline" onClick={onClose}>
              {t("close")}
            </Button>
            <Button
              theme={item.isEquipped ? "outline" : "primary"}
              onClick={() => void toggleEquipped()}
              disabled={isPending}
            >
              {t(item.isEquipped ? "remove" : "equip")}
            </Button>
          </div>
        );
    }
  };

  return (
    <Modal
      visible
      title={t("modal_title", { kind, name: item.name })}
      description={t("frame_hint")}
      onClose={onClose}
      className="shop-modal"
    >
      <div className="shop-modal__body">
        <div
          className="shop-modal__profile"
          style={
            userDetails.backgroundImageUrl
              ? undefined
              : { background: heroBackground }
          }
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
              frame={item}
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
