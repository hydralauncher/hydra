import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { LockIcon } from "@primer/octicons-react";
import { DoneIcon, RewardChips } from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import type { Trail, TrailLevel } from "@types";

export type TrailLevelState = "claimed" | "claimable" | "current" | "locked";

// Wheel geometry from the designer's prototype (v2).
const ITEM_SPACING = 46;
const CENTER_GAP = 22;
const SCALE_STEP = 0.16;
const MIN_SCALE = 0.55;
const BLUR_STEP = 1.4;
const MAX_BLUR = 4;
const OPACITY_STEP = 0.24;
const HIDDEN_DISTANCE = 3;
const STEP_PX = 40;
const CURRENT_BAR_BACKGROUND = "linear-gradient(90deg, #22c7ee, #7a7cff)";

/** Amount at `fraction` of a level, so texts match the bar while a celebration replays old progress. */
export const getAmountAt = (
  trail: Trail,
  level: TrailLevel,
  fraction: number
) => {
  const start =
    trail.levels.find((candidate) => candidate.level === level.level - 1)
      ?.threshold ?? 0;
  return Math.round((start + fraction * (level.threshold - start)) * 10) / 10;
};

interface TrailLevelWheelProps {
  trail: Trail;
  selectedLevel: number;
  getState: (level: TrailLevel) => TrailLevelState;
  getFraction: (level: TrailLevel) => number;
  formatAmount: (amount: number) => string;
  isClaimDisabled: boolean;
  onSelect: (level: number) => void;
  onClaim: (level: number, origin: Element) => void;
}

export function TrailLevelWheel({
  trail,
  selectedLevel,
  getState,
  getFraction,
  formatAmount,
  isClaimDisabled,
  onSelect,
  onClaim,
}: Readonly<TrailLevelWheelProps>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const wheelDelta = useRef(0);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  const levels = [...trail.levels].reverse();
  const selectedIndex = Math.max(
    0,
    levels.findIndex((level) => level.level === selectedLevel)
  );

  const selectIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(levels.length - 1, index));
    if (clamped !== selectedIndex) onSelect(levels[clamped].level);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    wheelDelta.current += event.deltaY;
    const steps = Math.trunc(wheelDelta.current / STEP_PX);
    if (steps !== 0) {
      wheelDelta.current -= steps * STEP_PX;
      selectIndex(selectedIndex + steps);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectIndex(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectIndex(selectedIndex - 1);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY, moved: false };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const steps = Math.trunc((drag.current.y - event.clientY) / STEP_PX);
    if (steps !== 0) {
      drag.current = { y: event.clientY, moved: true };
      selectIndex(selectedIndex + steps);
    }
  };

  const endDrag = () => {
    setTimeout(() => {
      drag.current = null;
    }, 0);
  };

  const renderStatus = (level: TrailLevel, state: TrailLevelState) => {
    switch (state) {
      case "claimable":
        return (
          <span className="trail-wheel__status trail-wheel__status--claim">
            <button
              type="button"
              className="missions-tab__claim trail-wheel__cta"
              disabled={isClaimDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onClaim(level.level, event.currentTarget);
              }}
            >
              {t("trail_wheel_claim")}
            </button>
            <RewardChips xp={level.xp} coins={level.coins} />
          </span>
        );
      case "claimed":
        return (
          <span className="trail-wheel__status">
            <DoneIcon size={14} isDim />
            {t("trail_wheel_done")}
          </span>
        );
      case "current": {
        const fraction = getFraction(level);
        return (
          <span className="trail-wheel__status trail-wheel__status--current">
            <span className="trail-wheel__bar">
              <span
                style={{
                  width: `${fraction * 100}%`,
                  background: CURRENT_BAR_BACKGROUND,
                }}
              />
            </span>
            {t("trail_wheel_current", {
              percent: Math.floor(fraction * 100),
              remaining: formatNumber(
                level.threshold - getAmountAt(trail, level, fraction)
              ),
            })}
          </span>
        );
      }
      default:
        return (
          <span className="trail-wheel__status">
            <LockIcon size={14} />
            {t("trail_wheel_locked")}
          </span>
        );
    }
  };

  return (
    <div
      className="trail-wheel"
      role="listbox"
      tabIndex={0}
      aria-label={t("trail_wheel_label", { trail: t(`trail_${trail.key}`) })}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={(event) => {
        const item = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-level]"
        );
        if (item && !drag.current?.moved) onSelect(Number(item.dataset.level));
      }}
    >
      {levels.map((level, index) => {
        const distance = index - selectedIndex;
        const absolute = Math.abs(distance);
        const state = getState(level);
        const isCenter = distance === 0;
        const offset =
          distance * ITEM_SPACING + Math.sign(distance) * CENTER_GAP;

        return (
          <div
            key={level.level}
            role="option"
            aria-selected={isCenter}
            tabIndex={-1}
            data-level={level.level}
            className={cn("trail-wheel__item", `trail-wheel__item--${state}`, {
              "trail-wheel__item--center": isCenter,
            })}
            style={{
              transform: `translateY(calc(-50% + ${offset}px)) scale(${Math.max(MIN_SCALE, 1 - absolute * SCALE_STEP)})`,
              filter: absolute
                ? `blur(${Math.min(MAX_BLUR, absolute * BLUR_STEP)}px)`
                : "none",
              opacity:
                absolute > HIDDEN_DISTANCE ? 0 : 1 - absolute * OPACITY_STEP,
            }}
          >
            <span className="trail-wheel__value">
              {formatAmount(level.threshold)}
              {state === "locked" && <LockIcon size={14} />}
              {state === "claimable" && !isCenter && (
                <span className="trail-wheel__dot" />
              )}
            </span>
            {isCenter && renderStatus(level, state)}
          </div>
        );
      })}
    </div>
  );
}
