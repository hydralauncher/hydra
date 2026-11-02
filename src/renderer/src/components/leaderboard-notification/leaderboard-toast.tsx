import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  buildLeaderboardBoardLabel,
  type LeaderboardNotificationInfo,
} from "@shared";
import {
  LeaderboardNotificationIcon,
  LeaderboardRankChip,
} from "./leaderboard-notification-icon";

import "./leaderboard-notification.scss";

const TOAST_DURATION_MS = 5_000;

const toastTitleKey = (info: LeaderboardNotificationInfo) => {
  if (info.kind === "missing_photo") return "leaderboard_toast_missing_photo";
  return info.direction === "down"
    ? "leaderboard_toast_down"
    : "leaderboard_toast_up";
};

interface LeaderboardToastProps {
  info: LeaderboardNotificationInfo;
  onOpen: () => void;
  onDismiss: () => void;
}

export function LeaderboardToast({
  info,
  onOpen,
  onDismiss,
}: Readonly<LeaderboardToastProps>) {
  const { t } = useTranslation("notifications_page");

  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const subtitle = [
    buildLeaderboardBoardLabel(t, info),
    t(
      info.direction === "down"
        ? "leaderboard_time_left"
        : "leaderboard_this_week"
    ),
  ].join(" · ");

  return (
    <button type="button" className="leaderboard-toast" onClick={onOpen}>
      <LeaderboardNotificationIcon info={info} />
      <span className="leaderboard-toast__text">
        <b>{t(toastTitleKey(info), { rank: info.rank })}</b>
        <span>{subtitle}</span>
      </span>
      <LeaderboardRankChip info={info} />
    </button>
  );
}
