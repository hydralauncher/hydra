import { useEffect, useState } from "react";
import { DeviceCameraIcon } from "@primer/octicons-react";
import cn from "classnames";

import { useUserDetails } from "@renderer/hooks";
import {
  getLeaderboardRankDelta,
  type LeaderboardNotificationInfo,
} from "@shared";
import type { GameShop, ShopAssets } from "@types";
import { MetricIcon } from "../../pages/leaderboards/metric-icon";

import "./leaderboard-notification.scss";

const assetsByGame = new Map<string, Promise<ShopAssets | null>>();

const loadGameAssets = (shop: string, objectId: string) => {
  const key = `${shop}:${objectId}`;
  let assets = assetsByGame.get(key);
  if (!assets) {
    assets = window.electron
      .getGameAssets(objectId, shop as GameShop)
      .catch(() => null);
    assetsByGame.set(key, assets);
  }
  return assets;
};

function useGameAssets(game: LeaderboardNotificationInfo["game"]) {
  const [assets, setAssets] = useState<ShopAssets | null>(null);
  const shop = game?.shop ?? null;
  const objectId = game?.objectId ?? null;

  useEffect(() => {
    if (!shop || !objectId) return;
    let cancelled = false;
    void loadGameAssets(shop, objectId).then((result) => {
      if (!cancelled) setAssets(result);
    });
    return () => {
      cancelled = true;
    };
  }, [shop, objectId]);

  return assets;
}

function GameTile({ info }: Readonly<{ info: LeaderboardNotificationInfo }>) {
  const assets = useGameAssets(info.game);
  const hero = assets?.libraryHeroImageUrl ?? assets?.coverImageUrl;
  const logo = assets?.logoImageUrl ?? assets?.iconUrl;

  return (
    <div
      className="leaderboard-notification-icon__tile leaderboard-notification-icon__tile--game"
      style={
        hero
          ? {
              backgroundImage: `linear-gradient(rgba(13, 13, 13, 0.55), rgba(13, 13, 13, 0.55)), url("${hero}")`,
            }
          : undefined
      }
    >
      {logo ? (
        <img src={logo} alt={info.game?.title ?? ""} />
      ) : (
        <MetricIcon metric={info.metric} size={20} />
      )}
    </div>
  );
}

function FriendsTile() {
  const { userDetails } = useUserDetails();

  return (
    <div className="leaderboard-notification-icon__tile leaderboard-notification-icon__tile--gradient">
      {userDetails?.profileImageUrl ? (
        <img
          className="leaderboard-notification-icon__self"
          src={userDetails.profileImageUrl}
          alt=""
        />
      ) : (
        <MetricIcon metric="friends" size={20} />
      )}
    </div>
  );
}

export function LeaderboardNotificationIcon({
  info,
}: Readonly<{ info: LeaderboardNotificationInfo }>) {
  const renderTile = () => {
    if (info.kind === "missing_photo") {
      return (
        <div className="leaderboard-notification-icon__tile leaderboard-notification-icon__tile--gradient">
          <DeviceCameraIcon size={20} />
        </div>
      );
    }
    if (info.game) return <GameTile info={info} />;
    if (info.scope === "friends") return <FriendsTile />;
    return (
      <div className="leaderboard-notification-icon__tile leaderboard-notification-icon__tile--gradient">
        <MetricIcon metric={info.metric} size={20} />
      </div>
    );
  };

  return (
    <div className="leaderboard-notification-icon">
      {renderTile()}
      <span
        aria-hidden="true"
        className={cn("leaderboard-notification-icon__arrow", {
          "leaderboard-notification-icon__arrow--down":
            info.direction === "down",
        })}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M5 1.5 8.5 6H6.2v2.5H3.8V6H1.5z" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

export function LeaderboardRankChip({
  info,
}: Readonly<{ info: LeaderboardNotificationInfo }>) {
  const delta = getLeaderboardRankDelta(info);
  if (delta === null) return null;

  return (
    <span
      className={cn("leaderboard-rank-chip", {
        "leaderboard-rank-chip--down": info.direction === "down",
      })}
    >
      {info.direction === "down" ? "▼" : "▲"}
      {delta}
    </span>
  );
}
