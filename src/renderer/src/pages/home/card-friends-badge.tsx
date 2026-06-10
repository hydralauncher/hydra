import { useId } from "react";
import { PersonIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import { Avatar } from "@renderer/components";

import type { HomeRowGame } from "./home-game-card";
import { useFriendsForGame } from "./home-friends-context";

import "./card-friends-badge.scss";

const MAX_VISIBLE_FRIENDS = 5;

interface CardFriendsBadgeProps {
  game: Pick<HomeRowGame, "shop" | "objectId">;
}

export function CardFriendsBadge({ game }: CardFriendsBadgeProps) {
  const tooltipId = useId();
  const friends = useFriendsForGame(game);
  if (friends.length === 0) return null;

  const visible = friends.slice(0, MAX_VISIBLE_FRIENDS);
  const extraCount = Math.max(0, friends.length - MAX_VISIBLE_FRIENDS);

  return (
    <>
      <span
        className="card-friends-badge"
        data-tooltip-id={tooltipId}
        data-tooltip-place="top"
        data-tooltip-content=" "
        aria-label={`${friends.length} friend${friends.length === 1 ? "" : "s"} playing`}
      >
        <PersonIcon size={14} />
        <span className="card-friends-badge__count">{friends.length}</span>
      </span>
      <Tooltip
        id={tooltipId}
        className="card-friends-badge__tooltip"
        opacity={1}
        render={() => (
          <div className="card-friends-badge__tooltip-body">
            {visible.map((friend) => (
              <div key={friend.id} className="card-friends-badge__row">
                <Avatar
                  size={20}
                  src={friend.profileImageUrl ?? undefined}
                  alt={friend.displayName}
                />
                <span className="card-friends-badge__name">
                  {friend.displayName}
                </span>
              </div>
            ))}
            {extraCount > 0 && (
              <div className="card-friends-badge__more">+{extraCount} more</div>
            )}
          </div>
        )}
      />
    </>
  );
}
