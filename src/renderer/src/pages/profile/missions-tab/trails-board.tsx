import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { LockIcon } from "@primer/octicons-react";
import {
  DoneIcon,
  PixelIcon,
  RewardChips,
  rampColor,
} from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import type { Trail, TrailKey, TrailLevel } from "@types";
import { TRAIL_ICONS } from "./mission-catalog";
import { useMissionActions } from "./use-mission-actions";

type LevelState = "claimed" | "claimable" | "current" | "locked";

const ORBIT_SIZE = 300;
const ORBIT_CENTER = ORBIT_SIZE / 2;
const FIRST_RADIUS = 34;
const LAST_RADIUS = 140;
const LOCKED_DOT_OFFSET = -0.7;
const SELECTOR_RING_RADIUS = 33;
const SELECTOR_SEGMENT_GAP = 6;
const CURRENT_COLOR = rampColor(0.5);

const getLevelState = (trail: Trail, level: TrailLevel): LevelState => {
  if (level.isClaimed) return "claimed";
  if (level.isReached) return "claimable";
  const firstLocked = trail.levels.find((candidate) => !candidate.isReached);
  return firstLocked?.level === level.level ? "current" : "locked";
};

const getLevelFraction = (trail: Trail, level: TrailLevel) => {
  const previous = trail.levels.find(
    (candidate) => candidate.level === level.level - 1
  );
  const start = previous?.threshold ?? 0;
  return Math.max(
    0,
    Math.min(1, (trail.current - start) / (level.threshold - start))
  );
};

const getDefaultLevel = (trail: Trail) =>
  trail.levels.find((level) => level.isReached && !level.isClaimed)?.level ??
  trail.levels.find((level) => !level.isReached)?.level ??
  trail.levels.length;

const getDefaultTrail = (trails: Trail[]) => {
  const claimable = trails.find((trail) =>
    trail.levels.some((level) => level.isReached && !level.isClaimed)
  );
  if (claimable) return claimable.key;

  const byProgress = [...trails].sort((a, b) => {
    const fraction = (trail: Trail) => {
      const current = trail.levels.find((level) => !level.isReached);
      return current ? getLevelFraction(trail, current) : -1;
    };
    return fraction(b) - fraction(a);
  });
  return byProgress[0]?.key ?? trails[0]?.key;
};

const ringRadius = (index: number, total: number) =>
  FIRST_RADIUS +
  (index * (LAST_RADIUS - FIRST_RADIUS)) / Math.max(1, total - 1);

const pointOn = (radius: number, angle: number) => ({
  x: ORBIT_CENTER + radius * Math.cos(angle),
  y: ORBIT_CENTER + radius * Math.sin(angle),
});

function useTrailAmount() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  return (trail: TrailKey, amount: number) =>
    t(`trail_amount_${trail}`, { count: amount, amount: formatNumber(amount) });
}

function SelectorRing({ trail }: Readonly<{ trail: Trail }>) {
  const size = 72;
  const circumference = 2 * Math.PI * SELECTOR_RING_RADIUS;
  const segments = trail.levels.length;
  const segmentLength =
    (circumference - segments * SELECTOR_SEGMENT_GAP) / segments;
  const reached = trail.levels.filter((level) => level.isReached).length;

  return (
    <svg
      className="trails-board__selector-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      {trail.levels.map((level, index) => (
        <circle
          key={level.level}
          cx={size / 2}
          cy={size / 2}
          r={SELECTOR_RING_RADIUS}
          fill="none"
          strokeWidth={3}
          stroke={
            index < reached
              ? rampColor(index / Math.max(1, segments - 1))
              : "rgba(255, 255, 255, 0.12)"
          }
          strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
          strokeDashoffset={
            -(index * (segmentLength + SELECTOR_SEGMENT_GAP)) +
            circumference / 4
          }
        />
      ))}
    </svg>
  );
}

function TrailOrbits({
  trail,
  selectedLevel,
  onSelect,
}: Readonly<{
  trail: Trail;
  selectedLevel: number;
  onSelect: (level: number) => void;
}>) {
  const total = trail.levels.length;

  return (
    <div className="trails-board__orbits">
      <svg
        width={ORBIT_SIZE}
        height={ORBIT_SIZE}
        viewBox={`0 0 ${ORBIT_SIZE} ${ORBIT_SIZE}`}
        aria-hidden="true"
      >
        {trail.levels.map((level, index) => {
          const radius = ringRadius(index, total);
          const state = getLevelState(trail, level);

          if (state === "current") {
            const circumference = 2 * Math.PI * radius;
            const fraction = getLevelFraction(trail, level);
            return (
              <g key={level.level}>
                <circle
                  cx={ORBIT_CENTER}
                  cy={ORBIT_CENTER}
                  r={radius}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth={4}
                />
                <circle
                  cx={ORBIT_CENTER}
                  cy={ORBIT_CENTER}
                  r={radius}
                  fill="none"
                  stroke={CURRENT_COLOR}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeDasharray={`${fraction * circumference} ${circumference}`}
                  transform={`rotate(-90 ${ORBIT_CENTER} ${ORBIT_CENTER})`}
                />
              </g>
            );
          }

          if (state === "locked") {
            return (
              <circle
                key={level.level}
                cx={ORBIT_CENTER}
                cy={ORBIT_CENTER}
                r={radius}
                fill="none"
                stroke="rgba(255, 255, 255, 0.12)"
                strokeWidth={1.5}
                strokeDasharray="2 6"
              />
            );
          }

          return (
            <circle
              key={level.level}
              cx={ORBIT_CENTER}
              cy={ORBIT_CENTER}
              r={radius}
              fill="none"
              stroke={rampColor(index / Math.max(1, total - 1))}
              strokeOpacity={0.55}
              strokeWidth={2}
            />
          );
        })}
      </svg>

      {trail.levels.map((level, index) => {
        const radius = ringRadius(index, total);
        const state = getLevelState(trail, level);
        let angle = -Math.PI / 2;
        if (state === "current") {
          angle += getLevelFraction(trail, level) * 2 * Math.PI;
        } else if (state === "locked") {
          angle += LOCKED_DOT_OFFSET;
        }
        const point = pointOn(radius, angle);

        return (
          <button
            key={level.level}
            type="button"
            className={cn("trails-board__dot", `trails-board__dot--${state}`, {
              "trails-board__dot--selected": level.level === selectedLevel,
            })}
            style={{ left: point.x - 9, top: point.y - 9 }}
            onClick={() => onSelect(level.level)}
            aria-label={String(level.level)}
          >
            <span />
          </button>
        );
      })}

      <span className="trails-board__core">
        <PixelIcon name={TRAIL_ICONS[trail.key]} size={24} />
      </span>
    </div>
  );
}

function TrailLegend({
  trail,
  selectedLevel,
  onSelect,
}: Readonly<{
  trail: Trail;
  selectedLevel: number;
  onSelect: (level: number) => void;
}>) {
  const { t } = useTranslation("user_profile");
  const formatAmount = useTrailAmount();

  return (
    <ol className="trails-board__legend">
      {[...trail.levels].reverse().map((level) => {
        const state = getLevelState(trail, level);
        const fraction = getLevelFraction(trail, level);

        return (
          <li key={level.level}>
            <button
              type="button"
              className={cn(
                "trails-board__legend-row",
                `trails-board__legend-row--${state}`,
                {
                  "trails-board__legend-row--selected":
                    level.level === selectedLevel,
                }
              )}
              onClick={() => onSelect(level.level)}
            >
              <span className="trails-board__legend-dot" />
              <span className="trails-board__legend-label">
                {formatAmount(trail.key, level.threshold)}
              </span>
              <span className="trails-board__legend-state">
                {state === "claimed" && <DoneIcon size={14} isDim />}
                {state === "claimable" && <strong>{t("claim_reward")}</strong>}
                {state === "current" && (
                  <>
                    <span className="trails-board__mini-bar">
                      <span
                        style={{
                          width: `${fraction * 100}%`,
                          background: CURRENT_COLOR,
                        }}
                      />
                    </span>
                    {Math.floor(fraction * 100)}%
                  </>
                )}
                {state === "locked" && <LockIcon size={14} />}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function TrailLevelDetail({
  trail,
  level,
}: Readonly<{ trail: Trail; level: TrailLevel }>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const formatAmount = useTrailAmount();
  const { claimTrail, pendingAction } = useMissionActions();
  const state = getLevelState(trail, level);
  const previous = trail.levels.find(
    (candidate) => candidate.level === level.level - 1
  );

  const renderStatus = () => {
    switch (state) {
      case "claimable":
        return t("trail_status_claimable");
      case "claimed":
        return t("trail_status_claimed");
      case "current":
        return t("trail_status_current", {
          current: formatNumber(trail.current),
          target: formatNumber(level.threshold),
          remaining: formatNumber(level.threshold - trail.current),
        });
      default:
        return t("trail_status_locked", {
          previous: formatAmount(trail.key, previous?.threshold ?? 0),
        });
    }
  };

  return (
    <div className="trails-board__detail">
      <div className="trails-board__detail-text">
        <span className="trails-board__detail-label">
          {t("trail_level", { level: level.level })}
        </span>
        <strong>{formatAmount(trail.key, level.threshold)}</strong>
        <small>{renderStatus()}</small>
        {state === "current" && (
          <span className="trails-board__detail-bar">
            <span
              style={{
                width: `${getLevelFraction(trail, level) * 100}%`,
                background: CURRENT_COLOR,
              }}
            />
          </span>
        )}
      </div>

      <div className="trails-board__detail-reward">
        <RewardChips
          xp={level.xp}
          coins={level.coins}
          className={cn({ "trails-board__reward--claimed": level.isClaimed })}
        />
        {state === "claimable" && (
          <button
            type="button"
            className="missions-tab__claim"
            disabled={pendingAction !== null}
            onClick={() => void claimTrail(trail.key, level.level)}
          >
            {t("claim_reward")}
          </button>
        )}
      </div>
    </div>
  );
}

export function TrailsBoard({ trails }: Readonly<{ trails: Trail[] }>) {
  const { t } = useTranslation("user_profile");
  const formatAmount = useTrailAmount();
  const [selectedTrailKey, setSelectedTrailKey] = useState<TrailKey | null>(
    null
  );
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);

  useEffect(() => {
    if (selectedTrailKey === null && trails.length > 0) {
      setSelectedTrailKey(getDefaultTrail(trails));
    }
  }, [trails, selectedTrailKey]);

  const selectedTrail = useMemo(
    () => trails.find((trail) => trail.key === selectedTrailKey) ?? null,
    [trails, selectedTrailKey]
  );

  useEffect(() => {
    if (selectedTrail) setSelectedLevel(getDefaultLevel(selectedTrail));
  }, [selectedTrail]);

  const levelsDone = trails.reduce(
    (sum, trail) =>
      sum + trail.levels.filter((level) => level.isReached).length,
    0
  );

  if (!selectedTrail) return null;

  const level =
    selectedTrail.levels.find(
      (candidate) => candidate.level === selectedLevel
    ) ?? selectedTrail.levels[0];

  return (
    <section className="missions-tab__section">
      <header className="missions-tab__section-header">
        <h2>{t("trails_title")}</h2>
        <span className="missions-tab__chip">
          {t("trail_levels_done", { count: levelsDone })}
        </span>
      </header>

      <div className="trails-board__selector">
        {trails.map((trail) => {
          const reached = trail.levels.filter((item) => item.isReached).length;
          const hasClaimable = trail.levels.some(
            (item) => item.isReached && !item.isClaimed
          );
          const isSelected = trail.key === selectedTrail.key;

          return (
            <button
              key={trail.key}
              type="button"
              className={cn("trails-board__trail", {
                "trails-board__trail--selected": isSelected,
                "trails-board__trail--complete": trail.isComplete,
              })}
              onClick={() => setSelectedTrailKey(trail.key)}
            >
              {hasClaimable && (
                <span className="trails-board__claim-badge">
                  {t("claim_reward")}
                </span>
              )}
              <span className="trails-board__trail-icon">
                <SelectorRing trail={trail} />
                <span>
                  <PixelIcon
                    name={TRAIL_ICONS[trail.key]}
                    isDim={!isSelected}
                  />
                </span>
              </span>
              <strong>{t(`trail_${trail.key}`)}</strong>
              <small>
                {trail.isComplete
                  ? t("trail_complete")
                  : t("trail_level", { level: reached })}
              </small>
            </button>
          );
        })}
      </div>

      <div
        className={cn("trails-board", {
          "trails-board--complete": selectedTrail.isComplete,
        })}
      >
        <div className="trails-board__header">
          <span className="trails-board__header-icon">
            <PixelIcon name={TRAIL_ICONS[selectedTrail.key]} />
          </span>
          <div>
            <strong>{t(`trail_${selectedTrail.key}`)}</strong>
            <small>
              {formatAmount(selectedTrail.key, selectedTrail.current)}
              {selectedTrail.isComplete && ` · ${t("trail_complete")}`}
            </small>
          </div>
        </div>

        <div className="trails-board__body">
          <TrailOrbits
            trail={selectedTrail}
            selectedLevel={level.level}
            onSelect={setSelectedLevel}
          />
          <TrailLegend
            trail={selectedTrail}
            selectedLevel={level.level}
            onSelect={setSelectedLevel}
          />
        </div>

        <TrailLevelDetail trail={selectedTrail} level={level} />
      </div>
    </section>
  );
}
