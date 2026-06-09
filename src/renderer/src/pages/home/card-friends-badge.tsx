/* Per-card "friends playing this game" indicator. Rendered into the
   hover-stats area of every Home card variant (horizontal, vertical,
   and recently-played) when at least one of the user's friends is
   currently playing the card's game. Hovering the icon opens a
   compact tooltip listing up to 5 friends with avatars + names; if
   more than 5 play, a "+N more" row appears at the bottom.

   The data is sourced via `useFriendsForGame` from the
   `HomeFriendsProvider` mounted at the Home root — the per-card
   component itself takes only the game it represents and resolves
   the rest from context, so card call-sites don't need to thread the
   friend list through every layer. */

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
        /* Tiny `data-tooltip-content` placeholder makes react-tooltip
           treat this anchor as a valid tooltip trigger even though
           the actual UI comes from the `render` prop below. Without
           ANY content prop, some react-tooltip versions decline to
           open the tooltip at all (the `render` callback never fires
           because the anchor has no "content" to anchor against). */
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
        /* Render override — supersedes data-tooltip-content with rich
           JSX (avatars + names). The placeholder content above keeps
           react-tooltip's anchor-detection happy; this render fn
           paints what the user actually sees. */
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
