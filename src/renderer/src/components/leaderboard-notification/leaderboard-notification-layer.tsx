import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSelector, useUserDetails } from "@renderer/hooks";
import {
  buildLeaderboardNotificationTarget,
  parseLeaderboardNotification,
  type LeaderboardNotificationInfo,
} from "@shared";
import type { GameShop, Notification } from "@types";
import { LeaderboardSlam } from "./leaderboard-slam";
import { LeaderboardToast } from "./leaderboard-toast";

import "./leaderboard-notification.scss";

const MAX_TOASTS = 3;

interface LayerItem {
  notification: Notification;
  info: LeaderboardNotificationInfo;
}

interface SlamItem extends LayerItem {
  gameLogoUrl: string | null;
}

const loadGameLogo = async (info: LeaderboardNotificationInfo) => {
  if (!info.game) return null;
  const assets = await window.electron
    .getGameAssets(info.game.objectId, info.game.shop as GameShop)
    .catch(() => null);
  return assets?.logoImageUrl ?? assets?.iconUrl ?? null;
};

export function LeaderboardNotificationLayer() {
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const slamEnabled = useAppSelector(
    (state) => state.userPreferences.value?.leaderboardSlamEnabled ?? true
  );
  const slamEnabledRef = useRef(slamEnabled);
  slamEnabledRef.current = slamEnabled;

  const [toasts, setToasts] = useState<LayerItem[]>([]);
  const [slams, setSlams] = useState<SlamItem[]>([]);

  useEffect(
    () =>
      window.electron.onLeaderboardNotification((notification) => {
        const info = parseLeaderboardNotification(notification);
        if (!info) return;

        if (info.kind === "rank" && info.moment && slamEnabledRef.current) {
          void loadGameLogo(info).then((gameLogoUrl) =>
            setSlams((current) => [
              ...current,
              { notification, info, gameLogoUrl },
            ])
          );
          return;
        }

        setToasts((current) =>
          [...current, { notification, info }].slice(-MAX_TOASTS)
        );
      }),
    []
  );

  const open = useCallback(
    (item: LayerItem) => {
      const target = buildLeaderboardNotificationTarget(
        item.notification.url,
        item.info,
        userDetails?.id ?? null
      );
      if (target) navigate(target);
    },
    [navigate, userDetails?.id]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) =>
      current.filter((item) => item.notification.id !== id)
    );
  }, []);

  const closeSlam = useCallback(() => {
    setSlams((current) => current.slice(1));
  }, []);

  const slam = slams[0];

  return (
    <>
      {slam && (
        <LeaderboardSlam
          key={slam.notification.id}
          info={slam.info}
          gameLogoUrl={slam.gameLogoUrl}
          onClose={closeSlam}
          onOpen={() => {
            closeSlam();
            open(slam);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="leaderboard-toast-stack" role="status">
          {toasts.map((item) => (
            <ToastItem
              key={item.notification.id}
              item={item}
              onOpen={open}
              onDismiss={dismissToast}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ToastItem({
  item,
  onOpen,
  onDismiss,
}: Readonly<{
  item: LayerItem;
  onOpen: (item: LayerItem) => void;
  onDismiss: (id: string) => void;
}>) {
  const id = item.notification.id;
  const handleDismiss = useCallback(() => onDismiss(id), [id, onDismiss]);
  const handleOpen = useCallback(() => {
    onDismiss(id);
    onOpen(item);
  }, [id, item, onDismiss, onOpen]);

  return (
    <LeaderboardToast
      info={item.info}
      onOpen={handleOpen}
      onDismiss={handleDismiss}
    />
  );
}
