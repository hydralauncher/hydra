import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  Avatar,
  getRankTier,
  isMedalTier,
  RankFrameRing,
  RankMedal,
} from "@renderer/components";
import { LEADERBOARD_ROW_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useProcessedImage } from "@renderer/hooks";
import type { LeaderboardRow as LeaderboardRowData } from "./game-leaderboard";

export interface LeaderboardRowProps {
  row: LeaderboardRowData;
  value: string;
  showProgress?: boolean;
  rankAddon?: React.ReactNode;
  valuePrefix?: React.ReactNode;
  valueMuted?: boolean;
  tooltip?: React.ReactNode;
  // A control beside the row (the row itself is a button, so it cannot hold
  // one). `reserveAction` keeps the same right padding on rows without it.
  action?: React.ReactNode;
  reserveAction?: boolean;
  // The game page card: a metal strip on the top 3 instead of the medal and frame.
  strip?: boolean;
  subtitle?: React.ReactNode;
  // The Rankings table: a plain number and the rank change in its own column.
  isTableRow?: boolean;
  deltaColumn?: React.ReactNode;
}

// Which side of the pointer the tooltip sits on. The position itself is
// written to the element on each mouse move, outside React, so moving the
// pointer does not re-render the row.
interface TooltipSide {
  flipX: boolean;
  flipY: boolean;
}

const TOOLTIP_FALLBACK_WIDTH = 360;
const TOOLTIP_FALLBACK_HEIGHT = 120;
const TOOLTIP_OFFSET = 12;

export function LeaderboardRow({
  row,
  value,
  showProgress = true,
  rankAddon,
  valuePrefix,
  valueMuted = false,
  tooltip,
  action,
  reserveAction = false,
  strip = false,
  subtitle,
  isTableRow = false,
  deltaColumn,
}: Readonly<LeaderboardRowProps>) {
  const { t } = useTranslation("leaderboard");
  const navigate = useNavigate();
  const { entry, isViewer, gapBefore, progress } = row;
  const tier = getRankTier(entry.rank);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSide, setTooltipSide] = useState<TooltipSide | null>(null);

  // Back to the keyboard-focus placement (CSS), without the pointer position.
  const stopFollowing = useCallback(() => setTooltipSide(null), []);

  // The inline position is only dropped after the render that hid the
  // tooltip. Dropping it first leaves a fixed, visible element with no
  // offsets for one frame, which flashes at the top left of the page.
  const isFollowing = tooltipSide !== null;
  useEffect(() => {
    if (isFollowing) return;
    tooltipRef.current?.style.removeProperty("left");
    tooltipRef.current?.style.removeProperty("top");
  }, [isFollowing]);

  // Scrolling moves the row away from a fixed tooltip, so hide it until the
  // pointer moves again.
  useEffect(() => {
    if (!isFollowing) return;
    const options = { capture: true, passive: true };
    globalThis.addEventListener("scroll", stopFollowing, options);
    globalThis.addEventListener("wheel", stopFollowing, options);

    return () => {
      globalThis.removeEventListener("scroll", stopFollowing, options);
      globalThis.removeEventListener("wheel", stopFollowing, options);
    };
  }, [isFollowing, stopFollowing]);

  // The tooltip sits above and to the right of the pointer, flipped to the
  // other side when that would leave the window.
  const followPointer = (event: React.MouseEvent) => {
    const element = tooltipRef.current;
    if (!tooltip || !element) return;
    const width = element.offsetWidth || TOOLTIP_FALLBACK_WIDTH;
    const height = element.offsetHeight || TOOLTIP_FALLBACK_HEIGHT;
    const x = event.clientX;
    const y = event.clientY;

    const flipX = x + TOOLTIP_OFFSET + width > window.innerWidth;
    const flipY = y - TOOLTIP_OFFSET - height < 0;

    element.style.left = `${x + (flipX ? -1 : 1) * TOOLTIP_OFFSET}px`;
    element.style.top = `${y}px`;

    // Same object back when nothing changed, so React skips the render.
    setTooltipSide((current) =>
      current?.flipX === flipX && current.flipY === flipY
        ? current
        : { flipX, flipY }
    );
  };
  const banner = useProcessedImage(
    entry.user.backgroundImageUrl,
    LEADERBOARD_ROW_BANNER_IMAGE_SIZE
  );

  return (
    <li
      className={cn("leaderboard-row__item", {
        "leaderboard-row__item--tooltip": tooltip,
      })}
      onMouseMove={tooltip ? followPointer : undefined}
      onMouseLeave={tooltip ? stopFollowing : undefined}
    >
      {tooltip && (
        <div
          ref={tooltipRef}
          className={cn("leaderboard-row__tooltip", {
            "leaderboard-row__tooltip--pointer": tooltipSide,
            "leaderboard-row__tooltip--flip-x": tooltipSide?.flipX,
            "leaderboard-row__tooltip--flip-y": tooltipSide?.flipY,
          })}
          style={
            {
              "--leaderboard-tooltip-offset": `${TOOLTIP_OFFSET}px`,
            } as React.CSSProperties
          }
          role="tooltip"
        >
          {tooltip}
        </div>
      )}

      {gapBefore && (
        <div className="leaderboard-row__gap" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}

      <div className="leaderboard-row__line">
        <button
          type="button"
          className={cn("leaderboard-row", {
            "leaderboard-row--with-action": action || reserveAction,
            "leaderboard-row--viewer": isViewer,
            "leaderboard-row--banner": banner,
            "leaderboard-row--strip": strip,
            "leaderboard-row--table": isTableRow,
            [`rank-frame rank-frame--${tier}`]: !strip && isMedalTier(tier),
          })}
          style={
            banner
              ? ({
                  "--leaderboard-row-banner": `url(${JSON.stringify(banner)})`,
                } as React.CSSProperties)
              : undefined
          }
          onClick={() => navigate(`/profile/${entry.user.id}`)}
          aria-current={isViewer ? "true" : undefined}
        >
          {!strip && isMedalTier(tier) && <RankFrameRing />}
          {strip ? (
            <span
              className={cn("leaderboard-row__strip", {
                [`leaderboard-row__strip--${tier}`]: isMedalTier(tier),
              })}
              role={isMedalTier(tier) ? "img" : undefined}
              aria-label={isMedalTier(tier) ? t(`medal_${tier}`) : undefined}
            >
              <span className="leaderboard-row__strip-number">
                {entry.rank}
              </span>
            </span>
          ) : (
            <span className="leaderboard-row__rank">
              <RankMedal rank={entry.rank} highlighted={isViewer} />
              {rankAddon}
            </span>
          )}

          <Avatar
            size={strip ? 40 : 36}
            src={entry.user.profileImageUrl}
            alt={entry.user.displayName}
          />

          <span className="leaderboard-row__body">
            <span className="leaderboard-row__name-line">
              <span className="leaderboard-row__name">
                {entry.user.displayName}
              </span>
              {isViewer && (
                <span className="leaderboard-row__you">{t("you")}</span>
              )}
            </span>

            {subtitle && (
              <span className="leaderboard-row__subtitle">{subtitle}</span>
            )}

            {showProgress && (
              <span className="leaderboard-row__progress" aria-hidden="true">
                <span
                  className="leaderboard-row__progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </span>
            )}
          </span>

          {isTableRow && deltaColumn !== undefined && (
            <span className="leaderboard-row__delta">{deltaColumn}</span>
          )}

          <span
            className={cn("leaderboard-row__value", {
              "leaderboard-row__value--muted": valueMuted,
            })}
          >
            {valuePrefix}
            {value}
          </span>
        </button>
        {action && <span className="leaderboard-row__action">{action}</span>}
      </div>
    </li>
  );
}
