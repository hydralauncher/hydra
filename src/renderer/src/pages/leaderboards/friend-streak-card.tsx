import cn from "classnames";
import { useTranslation } from "react-i18next";

import { Avatar } from "@renderer/components";
import { LEADERBOARD_ROW_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useProcessedImage } from "@renderer/hooks";
import type { FriendStreak } from "./global-leaderboard";

export interface FriendStreakCardProps {
  item: FriendStreak;
}

export function FriendStreakCard({ item }: Readonly<FriendStreakCardProps>) {
  const { t } = useTranslation("leaderboards");
  const banner = useProcessedImage(
    item.user.backgroundImageUrl,
    LEADERBOARD_ROW_BANNER_IMAGE_SIZE
  );

  return (
    <div
      className={cn("leaderboards__friend-streak", {
        "leaderboards__friend-streak--banner": banner,
      })}
      style={
        banner
          ? ({
              "--friend-banner": `url(${JSON.stringify(banner)})`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="leaderboards__friend-head">
        <span className="leaderboards__friend-avatar">
          <Avatar
            size={40}
            src={item.user.profileImageUrl}
            alt={item.user.displayName}
          />
          <span
            className={cn("leaderboards__presence", {
              "leaderboards__presence--online": item.online,
            })}
            aria-hidden="true"
          />
        </span>
        <span className="leaderboards__friend-text">
          <span className="leaderboards__friend-name">
            {item.user.displayName}
          </span>
          <span className="leaderboards__friend-presence">
            {t(item.online ? "online" : "offline")}
          </span>
        </span>
      </div>
      <span className="leaderboards__friend-days">
        {t("days_count", { count: item.days })}
      </span>
    </div>
  );
}
