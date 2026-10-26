import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  PixelIcon,
  RewardChips,
  launchConfetti,
  rampColor,
} from "@renderer/components/gamification";
import { useAppSelector, useFormat, useToast } from "@renderer/hooks";
import type { Trail, TrailKey, TrailLevel } from "@types";
import { TRAIL_ICONS } from "./mission-catalog";
import {
  TrailLevelWheel,
  getAmountAt,
  type TrailLevelState,
} from "./trail-level-wheel";
import { useMissionActions } from "./use-mission-actions";

const ORBIT_SIZE = 300;
const ORBIT_CENTER = ORBIT_SIZE / 2;
const FIRST_RADIUS = 34;
const LAST_RADIUS = 140;
const LOCKED_DOT_OFFSET = -0.7;
const SELECTOR_RING_RADIUS = 33;
const SELECTOR_SEGMENT_GAP = 6;
const CURRENT_COLOR = rampColor(0.5);
const FILL_PHASE_MS = 1100;
const DONE_PHASE_MS = 2600;
// Rings draw themselves, inside out, when a trail is shown.
const INTRO_RING_MS = 600;
const INTRO_STAGGER_MS = 80;
const SEEN_STORAGE_PREFIX = "hydra:gamification:trails-seen:";

interface Celebration {
  trail: TrailKey;
  level: number;
  fromFraction: number;
  phase: "fill" | "done";
}

type SeenTrails = Record<string, { reached: number; current: number }>;

const countReached = (trail: Trail) =>
  trail.levels.filter((level) => level.isReached).length;

const getLevelFraction = (
  trail: Trail,
  level: TrailLevel,
  current = trail.current
) => {
  const previous = trail.levels.find(
    (candidate) => candidate.level === level.level - 1
  );
  const start = previous?.threshold ?? 0;
  return Math.max(
    0,
    Math.min(1, (current - start) / (level.threshold - start))
  );
};

const getRealState = (trail: Trail, level: TrailLevel): TrailLevelState => {
  if (level.isClaimed) return "claimed";
  if (level.isReached) return "claimable";
  const firstLocked = trail.levels.find((candidate) => !candidate.isReached);
  return firstLocked?.level === level.level ? "current" : "locked";
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

  const fraction = (trail: Trail) => {
    const current = trail.levels.find((level) => !level.isReached);
    return current ? getLevelFraction(trail, current) : -1;
  };
  return [...trails].sort((a, b) => fraction(b) - fraction(a))[0]?.key ?? null;
};

const ringRadius = (index: number, total: number) =>
  FIRST_RADIUS +
  (index * (LAST_RADIUS - FIRST_RADIUS)) / Math.max(1, total - 1);

const pointOn = (radius: number, angle: number) => ({
  x: ORBIT_CENTER + radius * Math.cos(angle),
  y: ORBIT_CENTER + radius * Math.sin(angle),
});

const readSeen = (key: string): SeenTrails | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SeenTrails) : null;
  } catch {
    return null;
  }
};

const writeSeen = (key: string, trails: Trail[]) => {
  try {
    const seen: SeenTrails = {};
    for (const trail of trails) {
      seen[trail.key] = {
        reached: countReached(trail),
        current: trail.current,
      };
    }
    window.localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Storage can be unavailable; the animation just won't replay.
  }
};

function useTrailAmount() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  return useCallback(
    (trail: TrailKey, amount: number) =>
      t(`trail_amount_${trail}`, {
        count: amount,
        amount: formatNumber(amount),
      }),
    [t, formatNumber]
  );
}

function SelectorRing({ trail }: Readonly<{ trail: Trail }>) {
  const size = 72;
  const circumference = 2 * Math.PI * SELECTOR_RING_RADIUS;
  const segments = trail.levels.length;
  const segmentLength =
    (circumference - segments * SELECTOR_SEGMENT_GAP) / segments;
  const reached = countReached(trail);

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

interface TrailOrbitsProps {
  trail: Trail;
  selectedLevel: number;
  celebration: Celebration | null;
  getState: (level: TrailLevel) => TrailLevelState;
  getFraction: (level: TrailLevel) => number;
  bannerText: string;
  orbitsRef: React.RefObject<HTMLDivElement>;
  onSelect: (level: number) => void;
}

function TrailOrbits({
  trail,
  selectedLevel,
  celebration,
  getState,
  getFraction,
  bannerText,
  orbitsRef,
  onSelect,
}: Readonly<TrailOrbitsProps>) {
  const { t } = useTranslation("user_profile");
  const total = trail.levels.length;
  const celebrating = celebration?.trail === trail.key ? celebration : null;
  const [intro, setIntro] = useState(() => ({
    trail: trail.key,
    isPlaying: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  if (intro.trail !== trail.key) {
    setIntro({
      trail: trail.key,
      isPlaying: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }
  // The level celebration animates these rings itself, so it replaces the intro.
  const isIntro = intro.isPlaying && !celebrating;

  useEffect(() => {
    if (!isIntro) return;
    const timer = setTimeout(
      () => setIntro((current) => ({ ...current, isPlaying: false })),
      INTRO_RING_MS + (total - 1) * INTRO_STAGGER_MS
    );
    return () => clearTimeout(timer);
  }, [isIntro, intro.trail, total]);

  useEffect(() => {
    if (celebrating) setIntro((current) => ({ ...current, isPlaying: false }));
  }, [celebrating]);

  const introStyle = (index: number, circumference: number) =>
    ({
      "--intro-delay": `${index * INTRO_STAGGER_MS}ms`,
      "--intro-duration": `${INTRO_RING_MS}ms`,
      "--circumference": `${circumference}`,
    }) as React.CSSProperties;

  return (
    <div className="trails-board__orbits" ref={orbitsRef}>
      <svg
        key={trail.key}
        width={ORBIT_SIZE}
        height={ORBIT_SIZE}
        viewBox={`0 0 ${ORBIT_SIZE} ${ORBIT_SIZE}`}
        aria-hidden="true"
      >
        {trail.levels.map((level, index) => {
          const radius = ringRadius(index, total);
          const circumference = 2 * Math.PI * radius;
          const state = getState(level);
          const color = rampColor(index / Math.max(1, total - 1));
          const isCelebrated = celebrating?.level === level.level;

          if (state === "current") {
            const fraction = getFraction(level);
            const isFilling = isCelebrated && celebrating?.phase === "fill";
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
                  className={cn({
                    "trails-board__arc--filling": isFilling,
                    "trails-board__intro-draw": isIntro,
                  })}
                  style={
                    {
                      ...introStyle(index, circumference),
                      "--from": `${fraction * circumference}`,
                    } as React.CSSProperties
                  }
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
                className={cn({ "trails-board__intro-fade": isIntro })}
                style={introStyle(index, circumference)}
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

          const isJustDone = isCelebrated && celebrating?.phase === "done";
          const isNewTrack =
            celebrating?.phase === "done" &&
            celebrating.level + 1 === level.level;

          return (
            <g key={level.level}>
              <circle
                className={cn({
                  "trails-board__ring--just-done": isJustDone,
                  "trails-board__ring--new": isNewTrack,
                  "trails-board__intro-draw": isIntro,
                })}
                style={introStyle(index, circumference)}
                cx={ORBIT_CENTER}
                cy={ORBIT_CENTER}
                r={radius}
                fill="none"
                stroke={color}
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeDasharray={`${circumference} ${circumference}`}
                transform={`rotate(-90 ${ORBIT_CENTER} ${ORBIT_CENTER})`}
              />
              {isJustDone && (
                <>
                  <circle
                    className="trails-board__wave"
                    cx={ORBIT_CENTER}
                    cy={ORBIT_CENTER}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                  />
                  <circle
                    className="trails-board__wave trails-board__wave--second"
                    cx={ORBIT_CENTER}
                    cy={ORBIT_CENTER}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>

      {trail.levels.map((level, index) => {
        const radius = ringRadius(index, total);
        const state = getState(level);
        let sweep = 0;
        if (state === "current") {
          sweep = getFraction(level) * 2 * Math.PI;
        } else if (state === "locked") {
          sweep = LOCKED_DOT_OFFSET;
        }
        // During the intro the current dot starts at the top and rides the arc tip.
        const isRiding = isIntro && state === "current";
        const point = pointOn(radius, -Math.PI / 2 + (isRiding ? 0 : sweep));
        const isRacing =
          celebrating?.phase === "fill" && celebrating.level === level.level;
        const isPopping =
          celebrating?.phase === "done" && celebrating.level === level.level;

        return (
          <button
            key={`${trail.key}-${level.level}`}
            type="button"
            className={cn("trails-board__dot", `trails-board__dot--${state}`, {
              "trails-board__dot--selected": level.level === selectedLevel,
              "trails-board__dot--racing": isRacing,
              "trails-board__dot--pop": isPopping,
              "trails-board__intro-ride": isRiding,
              "trails-board__intro-fade": isIntro && state === "locked",
            })}
            style={
              {
                ...introStyle(index, 0),
                "--intro-angle": `${sweep}rad`,
                left: point.x - 9,
                top: point.y - 9,
                transformOrigin: isRiding
                  ? `${ORBIT_CENTER - point.x + 9}px ${ORBIT_CENTER - point.y + 9}px`
                  : undefined,
              } as React.CSSProperties
            }
            onClick={() => onSelect(level.level)}
            aria-label={t("trail_level", { level: level.level })}
          >
            <span />
          </button>
        );
      })}

      <span
        className={cn("trails-board__core", {
          "trails-board__core--bump": celebrating?.phase === "done",
        })}
      >
        <PixelIcon name={TRAIL_ICONS[trail.key]} size={24} />
      </span>

      {celebrating?.phase === "done" && (
        <div className="trails-board__banner">
          <small>{t("trail_level_reached_banner")}</small>
          <strong>{bannerText}</strong>
        </div>
      )}
    </div>
  );
}

function TrailLevelDetail({
  trail,
  level,
  state,
  fraction,
  formatAmount,
}: Readonly<{
  trail: Trail;
  level: TrailLevel;
  state: TrailLevelState;
  fraction: number;
  formatAmount: (trail: TrailKey, amount: number) => string;
}>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const { claimTrail, pendingAction } = useMissionActions();
  const previous = trail.levels.find(
    (candidate) => candidate.level === level.level - 1
  );

  const renderStatus = () => {
    switch (state) {
      case "claimable":
        return t("trail_status_claimable");
      case "claimed":
        return t("trail_status_claimed");
      case "current": {
        const current = getAmountAt(trail, level, fraction);
        return t("trail_status_current", {
          current: formatNumber(current),
          target: formatNumber(level.threshold),
          remaining: formatNumber(level.threshold - current),
        });
      }
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
              style={{ width: `${fraction * 100}%`, background: CURRENT_COLOR }}
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
            onClick={(event) =>
              void claimTrail(trail.key, level.level, event.currentTarget)
            }
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
  const { showSuccessToast } = useToast();
  const { claimTrail, pendingAction } = useMissionActions();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const [selectedTrailKey, setSelectedTrailKey] = useState<TrailKey | null>(
    null
  );
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const queueRef = useRef<Omit<Celebration, "phase">[]>([]);
  const orbitsRef = useRef<HTMLDivElement>(null);

  // Queue an animation for every level reached since the last visit.
  useEffect(() => {
    if (!userId || trails.length === 0) return;
    const storageKey = `${SEEN_STORAGE_PREFIX}${userId}`;
    const seen = readSeen(storageKey);
    writeSeen(storageKey, trails);
    if (!seen) return;

    for (const trail of trails) {
      const before = seen[trail.key];
      if (!before) continue;
      const reached = countReached(trail);
      for (let level = before.reached + 1; level <= reached; level++) {
        const levelData = trail.levels.find((item) => item.level === level);
        if (!levelData) continue;
        queueRef.current.push({
          trail: trail.key,
          level,
          fromFraction:
            level === before.reached + 1
              ? getLevelFraction(trail, levelData, before.current)
              : 0,
        });
      }
    }
  }, [trails, userId]);

  // Play queued animations one at a time.
  useEffect(() => {
    if (celebration || queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    setSelectedTrailKey(next.trail);
    setSelectedLevel(next.level);
    setCelebration({ ...next, phase: "fill" });
  }, [celebration, trails]);

  useEffect(() => {
    if (!celebration) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (celebration.phase === "fill") {
      const timer = setTimeout(
        () => {
          setCelebration({ ...celebration, phase: "done" });
          const trail = trails.find((item) => item.key === celebration.trail);
          const hasNext = trail?.levels.some(
            (level) => level.level === celebration.level + 1
          );
          if (hasNext) setSelectedLevel(celebration.level + 1);

          const orbits = orbitsRef.current?.getBoundingClientRect();
          if (orbits) {
            const index = celebration.level - 1;
            const point = pointOn(
              ringRadius(index, trail?.levels.length ?? 5),
              -Math.PI / 2
            );
            launchConfetti(
              new DOMRect(
                orbits.left + point.x - 9,
                orbits.top + point.y - 9,
                18,
                18
              )
            );
          }
          if (trail) {
            const level = trail.levels.find(
              (item) => item.level === celebration.level
            );
            showSuccessToast(
              t("trail_level_reached_title", {
                amount: formatAmount(trail.key, level?.threshold ?? 0),
              }),
              t("trail_level_reached_message")
            );
          }
        },
        reduced ? 50 : FILL_PHASE_MS
      );
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(
      () => {
        setSelectedLevel(celebration.level);
        setCelebration(null);
      },
      reduced ? 50 : DONE_PHASE_MS
    );
    return () => clearTimeout(timer);
  }, [celebration, trails, formatAmount, showSuccessToast, t]);

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
    if (selectedTrail && !celebration) {
      setSelectedLevel(getDefaultLevel(selectedTrail));
    }
    // Only when the trail (or its data) changes, not when the celebration ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrail]);

  const levelsDone = trails.reduce(
    (sum, trail) => sum + countReached(trail),
    0
  );

  if (!selectedTrail) return null;

  const celebrating =
    celebration?.trail === selectedTrail.key ? celebration : null;

  // While a level fills, show the trail as it was before that level was reached.
  const getState = (level: TrailLevel): TrailLevelState => {
    if (celebrating?.phase === "fill") {
      if (level.level === celebrating.level) return "current";
      if (level.level > celebrating.level) return "locked";
    }
    return getRealState(selectedTrail, level);
  };

  const getFraction = (level: TrailLevel) => {
    if (celebrating?.phase === "fill" && level.level === celebrating.level) {
      return celebrating.fromFraction;
    }
    return getLevelFraction(selectedTrail, level);
  };

  const level =
    selectedTrail.levels.find(
      (candidate) => candidate.level === selectedLevel
    ) ?? selectedTrail.levels[0];
  const celebratedLevel = selectedTrail.levels.find(
    (candidate) => candidate.level === celebrating?.level
  );

  return (
    <section className="missions-tab__section">
      <header className="missions-tab__section-header">
        <h2>{t("trails_title")}</h2>
        <span className="missions-tab__chip">
          {t("trail_levels_done", { count: levelsDone })}
        </span>
      </header>

      <div className="trails-board__wrap">
        <div className="trails-board__selector">
          {trails.map((trail) => {
            const reached = countReached(trail);
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
                disabled={celebration !== null}
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
              celebration={celebration}
              getState={getState}
              getFraction={getFraction}
              bannerText={formatAmount(
                selectedTrail.key,
                celebratedLevel?.threshold ?? 0
              )}
              orbitsRef={orbitsRef}
              onSelect={setSelectedLevel}
            />
            <TrailLevelWheel
              trail={selectedTrail}
              selectedLevel={level.level}
              getState={getState}
              getFraction={getFraction}
              formatAmount={(amount) => formatAmount(selectedTrail.key, amount)}
              isClaimDisabled={pendingAction !== null || celebration !== null}
              onSelect={setSelectedLevel}
              onClaim={(claimLevel, origin) =>
                void claimTrail(selectedTrail.key, claimLevel, origin)
              }
            />
          </div>

          <TrailLevelDetail
            trail={selectedTrail}
            level={level}
            state={getState(level)}
            fraction={getFraction(level)}
            formatAmount={formatAmount}
          />
        </div>
      </div>
    </section>
  );
}
