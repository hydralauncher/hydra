import { useTranslation } from "react-i18next";
import {
  LevelSeal,
  XpBar,
  useHoverHalo,
} from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import type { LevelProgress } from "@types";
import "./level-box.scss";

const SEAL_HALO_ALPHA = 0.04;

export function LevelBox({ level }: Readonly<{ level: LevelProgress }>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const halo = useHoverHalo<HTMLDivElement>(SEAL_HALO_ALPHA);
  const isMaxLevel = level.xpToNextLevel === null;

  return (
    <div className="level-box">
      <div ref={halo.hostRef} className="level-box__seal" {...halo.handlers}>
        <LevelSeal level={level.level} size={119} />
        <canvas
          ref={halo.canvasRef}
          className="level-box__halo"
          aria-hidden="true"
        />
      </div>

      <div className="level-box__info">
        <div className="level-box__header">
          <strong>{t("level_number", { level: level.level })}</strong>
          {!isMaxLevel && (
            <span>
              {t("xp_progress", {
                xp: formatNumber(level.xp),
                total: formatNumber(level.xpToNextLevel!),
              })}
            </span>
          )}
        </div>

        <XpBar xp={level.xp} xpToNextLevel={level.xpToNextLevel} />

        <small className="level-box__hint">
          {isMaxLevel
            ? t("max_level")
            : t("xp_to_next_level", {
                xp: formatNumber(level.xpToNextLevel! - level.xp),
                level: level.level + 1,
              })}
        </small>
      </div>
    </div>
  );
}
