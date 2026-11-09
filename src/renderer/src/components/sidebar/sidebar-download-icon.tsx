import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { useAppSelector, useDownloadLayout } from "@renderer/hooks";
import { formatDownloadProgress } from "@renderer/helpers";

import {
  getDownloadIndicatorState,
  type DownloadIndicatorState,
} from "./download-indicator";
import {
  DOWNLOAD_FLIGHT_CANCEL_EVENT,
  DOWNLOAD_FLIGHT_START_EVENT,
  DOWNLOAD_LANDED_EVENT,
  REDUCED_MOTION_QUERY,
} from "./download-flight";

import "./sidebar-download-icon.scss";

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const STEP_GAP = 2.5;
const MAX_STEPS = 5;
const SPINNER_LENGTH = RING_LENGTH * 0.25;

// A download that never reports back stops holding the icon after this long.
const HOLD_TIMEOUT = 20_000;

const CATCH_DURATION = 560;
const CATCH_EASING = "cubic-bezier(0.3, 0.7, 0.4, 1)";

// The icon takes the hit: it squashes, rebounds a little taller and settles.
const CATCH_KEYFRAMES: Keyframe[] = [
  { offset: 0, transform: "translateY(0) scale(1, 1)", easing: CATCH_EASING },
  {
    offset: 0.14,
    transform: "translateY(1px) scale(1.12, 0.82)",
    easing: CATCH_EASING,
  },
  {
    offset: 0.4,
    transform: "translateY(-0.5px) scale(1.16, 1.24)",
    easing: CATCH_EASING,
  },
  {
    offset: 0.68,
    transform: "translateY(0) scale(0.96, 0.96)",
    easing: CATCH_EASING,
  },
  { offset: 1, transform: "translateY(0) scale(1, 1)" },
];

const FLASH_DURATION = 1000;

// The row flashes once, then goes back to its own background.
const FLASH_KEYFRAMES: Keyframe[] = [
  {
    offset: 0.08,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    easing: "ease-out",
  },
];

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

/**
 * The Downloads menu icon. Idle, it is the plain download arrow. While games
 * download, the tray fades out, the arrow shrinks into a ring that shows the
 * current game's progress, and the ring splits into one step per queued game.
 * When a download starts, the game's icon flies in (download-flight.ts) and
 * the icon catches it.
 */
export function SidebarDownloadIcon() {
  const { t } = useTranslation("sidebar");

  const lastPacket = useAppSelector((state) => state.download.lastPacket);
  const extraction = useAppSelector((state) => state.download.extraction);
  const downloads = useAppSelector((state) => state.library.downloadLibrary);
  const { layoutState } = useDownloadLayout();

  const liveState = useMemo(
    () =>
      getDownloadIndicatorState({
        downloads,
        lastPacket,
        extraction,
        queueOrder: layoutState.queueOrder,
      }),
    [downloads, lastPacket, extraction, layoutState.queueOrder]
  );

  // While a download flies in, keep the look from before the click, so the
  // ring changes when the game lands, not while it is still in the air.
  const [heldState, setHeldState] = useState<DownloadIndicatorState | null>(
    null
  );
  const liveStateRef = useRef(liveState);
  liveStateRef.current = liveState;
  const iconRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let holdTimer: number | undefined;

    const release = () => {
      window.clearTimeout(holdTimer);
      setHeldState(null);
    };

    const hold = () => {
      window.clearTimeout(holdTimer);
      setHeldState((held) => held ?? liveStateRef.current);
      holdTimer = window.setTimeout(release, HOLD_TIMEOUT);
    };

    const land = () => {
      release();

      const icon = iconRef.current;
      if (!icon) return;

      if (!window.matchMedia(REDUCED_MOTION_QUERY).matches) {
        icon.animate(CATCH_KEYFRAMES, { duration: CATCH_DURATION });
      }

      icon
        .closest(".sidebar__menu-item")
        ?.animate(FLASH_KEYFRAMES, { duration: FLASH_DURATION });
    };

    window.addEventListener(DOWNLOAD_FLIGHT_START_EVENT, hold);
    window.addEventListener(DOWNLOAD_FLIGHT_CANCEL_EVENT, release);
    window.addEventListener(DOWNLOAD_LANDED_EVENT, land);

    return () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener(DOWNLOAD_FLIGHT_START_EVENT, hold);
      window.removeEventListener(DOWNLOAD_FLIGHT_CANCEL_EVENT, release);
      window.removeEventListener(DOWNLOAD_LANDED_EVENT, land);
    };
  }, []);

  const state = heldState ?? liveState;

  // Keep drawing the last ring while it fades out, so it doesn't collapse first.
  const lastVisibleState = useRef<DownloadIndicatorState>(state);
  if (state.phase !== "idle") lastVisibleState.current = state;

  const isActive = state.phase !== "idle";
  const shown = isActive ? state : lastVisibleState.current;

  const steps = Math.min(shown.games, MAX_STEPS);
  const isStepped = steps >= 2;
  const stepLength = RING_LENGTH / Math.max(steps, 1) - STEP_GAP;
  const progressLength =
    (isStepped ? stepLength : RING_LENGTH) * clamp(shown.progress ?? 0);
  const hasProgress = shown.progress !== null && progressLength > 0;

  const label = useMemo(() => {
    if (!isActive) return undefined;

    const percentage = formatDownloadProgress(state.progress ?? 0, 0);
    const status =
      state.phase === "preparing"
        ? t("download_status_preparing")
        : t(`download_status_${state.phase}`, { percentage });

    if (state.games < 2) return status;

    return `${status}, ${t("download_status_queued", { count: state.games - 1 })}`;
  }, [isActive, state, t]);

  return (
    <svg
      ref={iconRef}
      data-sidebar-downloads-icon
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className={cn("sidebar-download-icon", {
        "sidebar-download-icon--active": isActive,
        "sidebar-download-icon--stepped": isActive && isStepped,
        "sidebar-download-icon--paused": state.phase === "paused",
        "sidebar-download-icon--extracting": state.phase === "extracting",
        "sidebar-download-icon--preparing": state.phase === "preparing",
      })}
      role={isActive ? "img" : undefined}
      aria-label={label}
      aria-hidden={isActive ? undefined : true}
    >
      <path
        className="sidebar-download-icon__tray"
        d="M1.75 9.75v2.5c0 .552.448 1 1 1h10.5c.552 0 1-.448 1-1v-2.5"
      />
      <path
        className="sidebar-download-icon__arrow"
        d="M8 2v7.5M4.75 6.25 8 9.5l3.25-3.25"
      />
      <path className="sidebar-download-icon__pause" d="M6.5 5.5v5M9.5 5.5v5" />

      <g className="sidebar-download-icon__ring">
        <circle
          className="sidebar-download-icon__track"
          cx="8"
          cy="8"
          r={RING_RADIUS}
        />
        <circle
          className="sidebar-download-icon__track sidebar-download-icon__track--dashed"
          cx="8"
          cy="8"
          r={RING_RADIUS}
        />

        {Array.from({ length: MAX_STEPS }, (_, index) => {
          const isVisible = isStepped && index < steps;

          return (
            <circle
              key={index}
              className="sidebar-download-icon__step"
              cx="8"
              cy="8"
              r={RING_RADIUS}
              style={{
                strokeDasharray: `${isVisible ? stepLength : 0} ${RING_LENGTH}`,
                strokeDashoffset: -(index * RING_LENGTH) / Math.max(steps, 1),
                opacity: isVisible ? 1 : 0,
              }}
            />
          );
        })}

        <circle
          className="sidebar-download-icon__progress"
          cx="8"
          cy="8"
          r={RING_RADIUS}
          style={{
            strokeDasharray: `${progressLength} ${RING_LENGTH}`,
            opacity: hasProgress ? 1 : 0,
          }}
        />

        <g className="sidebar-download-icon__spinner">
          <circle
            className="sidebar-download-icon__spinner-arc"
            cx="8"
            cy="8"
            r={RING_RADIUS}
            style={{ strokeDasharray: `${SPINNER_LENGTH} ${RING_LENGTH}` }}
          />
        </g>
      </g>
    </svg>
  );
}
