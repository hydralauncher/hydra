import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  buildLeaderboardBoardLabel,
  type LeaderboardNotificationInfo,
} from "@shared";
import {
  runSlam,
  slamScale,
  SLAM_CENTER_Y,
  SLAM_NUMBER_HEIGHT,
  SLAM_NUMBER_TOP,
} from "./slam-canvas";
import { LeaderboardRankChip } from "./leaderboard-notification-icon";

import "./leaderboard-notification.scss";

const TAG_GAP = 32;
const FOOT_GAP = 40;
const MIN_TOP = 16;
const APP_ROOT_ID = "root";

const slamTagKey = (info: LeaderboardNotificationInfo) => {
  if (info.moment === "leader") return "leaderboard_slam_leader";
  if (info.moment === "top100") return "leaderboard_slam_top100";
  return "leaderboard_slam_up";
};

interface LeaderboardSlamProps {
  info: LeaderboardNotificationInfo;
  gameLogoUrl: string | null;
  onClose: () => void;
  onOpen: () => void;
}

export function LeaderboardSlam({
  info,
  gameLogoUrl,
  onClose,
  onOpen,
}: Readonly<LeaderboardSlamProps>) {
  const { t } = useTranslation("notifications_page");
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagRef = useRef<HTMLSpanElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const rankText = `#${info.rank}`;
  const tag = t(slamTagKey(info));
  const board = buildLeaderboardBoardLabel(t, info);
  const scope = t(`leaderboard_scope_${info.scope}`);
  const meta =
    info.previousRank === null
      ? t("leaderboard_slam_meta", { scope })
      : t("leaderboard_slam_meta_previous", {
          scope,
          previousRank: info.previousRank,
        });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const foot = footRef.current;
    if (!root || !canvas || !foot) return;

    const slam = runSlam(canvas, rankText);
    const place = () => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      const scale = slamScale(width, height);
      const numberTop = height / 2 + (SLAM_NUMBER_TOP - SLAM_CENTER_Y) * scale;
      const numberHeight = SLAM_NUMBER_HEIGHT * scale;
      const tagHeight = tagRef.current
        ? tagRef.current.offsetHeight + TAG_GAP
        : 0;
      const total = tagHeight + numberHeight + FOOT_GAP + foot.offsetHeight;
      const top = Math.max(MIN_TOP, (height - total) / 2);
      if (tagRef.current) tagRef.current.style.top = `${Math.round(top)}px`;
      slam.setOffsetY(Math.round(top + tagHeight - numberTop));
      foot.style.top = `${Math.round(top + tagHeight + numberHeight + FOOT_GAP)}px`;
    };
    place();

    const observer = new ResizeObserver(() => {
      slam.resize();
      place();
    });
    observer.observe(root);

    return () => {
      observer.disconnect();
      slam.stop();
    };
  }, [rankText]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById(APP_ROOT_ID);
    appRoot?.setAttribute("inert", "");
    closeRef.current?.focus();

    return () => {
      appRoot?.removeAttribute("inert");
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !rootRef.current) return;
      const buttons = [...rootRef.current.querySelectorAll("button")];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!rootRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className="leaderboard-slam"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leaderboard-slam-title"
    >
      <h3 id="leaderboard-slam-title" className="leaderboard-slam__sr">
        {t("leaderboard_slam_label", { tag, rank: info.rank, board })}
      </h3>
      <span ref={tagRef} className="leaderboard-slam__tag">
        {tag}
      </span>
      <canvas ref={canvasRef} className="leaderboard-slam__canvas" />
      <div ref={footRef} className="leaderboard-slam__foot">
        <div className="leaderboard-slam__card leaderboard-slam__rise">
          {gameLogoUrl && (
            <img
              className="leaderboard-slam__logo"
              src={gameLogoUrl}
              alt={info.game?.title ?? ""}
            />
          )}
          <span className="leaderboard-slam__board">
            <b>{board}</b>
            <LeaderboardRankChip info={info} />
          </span>
          <small>{meta}</small>
        </div>
        <div className="leaderboard-slam__actions leaderboard-slam__rise leaderboard-slam__rise--late">
          <button
            ref={closeRef}
            type="button"
            className="leaderboard-slam__button"
            onClick={onClose}
          >
            {t("leaderboard_close")}
          </button>
          <button
            type="button"
            className="leaderboard-slam__button leaderboard-slam__button--primary"
            onClick={onOpen}
          >
            {t("leaderboard_view_ranking")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
