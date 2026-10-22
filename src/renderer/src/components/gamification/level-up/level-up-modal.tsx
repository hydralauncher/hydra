import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { dismissLevelUp } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { prefersReducedMotion } from "../gamification-colors";
import { getSlamLayout, runSlam, type SlamHandle } from "./slam";
import { useLevelUpWatcher } from "./use-level-up-watcher";
import "./level-up-modal.scss";

export function LevelUpModal() {
  useLevelUpWatcher();
  const level = useAppSelector((state) => state.gamification.levelUpTo);
  if (level === null) return null;
  return createPortal(<SlamOverlay key={level} level={level} />, document.body);
}

function SlamOverlay({ level }: Readonly<{ level: number }>) {
  const { t } = useTranslation("user_profile");
  const dispatch = useAppDispatch();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagRef = useRef<HTMLSpanElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const slamRef = useRef<SlamHandle | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const [isSkipped, setIsSkipped] = useState(reduced);
  const isSkippedRef = useRef(isSkipped);

  const close = useCallback(() => dispatch(dismissLevelUp()), [dispatch]);

  const skip = useCallback(() => {
    if (isSkippedRef.current) return;
    isSkippedRef.current = true;
    slamRef.current?.skip();
    setIsSkipped(true);
  }, []);

  const layout = useCallback(() => {
    const root = rootRef.current;
    if (!root || !tagRef.current || !footerRef.current) return;
    const { tagTop, numberOffset, footerTop } = getSlamLayout(
      root.clientWidth,
      root.clientHeight,
      tagRef.current.offsetHeight,
      footerRef.current.offsetHeight
    );
    tagRef.current.style.top = `${tagTop}px`;
    footerRef.current.style.top = `${footerTop}px`;
    slamRef.current?.setOffsetY(numberOffset);
  }, []);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    slamRef.current = runSlam(canvasRef.current, String(level), reduced);
    layout();
    return () => slamRef.current?.stop();
  }, [level, reduced, layout]);

  // Clicking anywhere skips the animation. Enter/Space skip it too, then work as "Continue".
  // Esc closes at any time.
  useEffect(() => {
    const root = rootRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isSkippedRef.current) close();
        else skip();
      }
    };
    window.addEventListener("resize", layout);
    window.addEventListener("keydown", onKeyDown);
    root?.addEventListener("click", skip);
    return () => {
      window.removeEventListener("resize", layout);
      window.removeEventListener("keydown", onKeyDown);
      root?.removeEventListener("click", skip);
    };
  }, [layout, close, skip]);

  return (
    <div
      ref={rootRef}
      className={cn("level-up", { "level-up--skipped": isSkipped })}
      role="dialog"
      aria-modal="true"
      aria-labelledby="level-up-title"
    >
      <h2 id="level-up-title" className="level-up__sr">
        {t("level_up_title", { level })}
      </h2>
      <span ref={tagRef} className="level-up__tag">
        {t("level_up_tag")}
      </span>
      <canvas ref={canvasRef} className="level-up__number" />
      <div
        ref={footerRef}
        className="level-up__footer"
        onAnimationEnd={() => {
          isSkippedRef.current = true;
        }}
      >
        <button
          type="button"
          className="level-up__continue"
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          {t("level_up_continue")}
        </button>
      </div>
      <span className="level-up__skip">{t("level_up_skip")}</span>
    </div>
  );
}
