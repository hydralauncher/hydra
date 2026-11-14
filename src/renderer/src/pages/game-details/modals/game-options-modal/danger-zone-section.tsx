import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFeature, useFormat } from "@renderer/hooks";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import type { RemoveFilesTarget } from "@shared";
import type { LibraryGame, UserDetails } from "@types";

import { MyScreenshotsDangerZone } from "./my-screenshots-danger-zone";

interface DangerZoneSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isDeletingAchievements: boolean;
  hasAchievements: boolean;
  isGameDownloading: boolean;
  removeFilesTarget: RemoveFilesTarget | null;
  userDetails: UserDetails | null;
  onOpenRemoveFromLibrary: () => void;
  onOpenResetAchievements: () => void;
  onOpenChangePlaytime: () => void;
  onOpenResetPlaytime: () => void;
  onOpenRemoveFiles: (target: RemoveFilesTarget) => void;
}

interface DangerRowProps {
  label: string;
  description: string;
  disabled?: boolean;
  children: ReactNode;
}

/** One row of the table: what it is, what it does, and its action. */
function DangerRow({
  label,
  description,
  disabled = false,
  children,
}: Readonly<DangerRowProps>) {
  return (
    <div
      className={`game-options-modal__danger-row${
        disabled ? " game-options-modal__danger-row--disabled" : ""
      }`}
    >
      <strong className="game-options-modal__danger-row-label">{label}</strong>
      <span className="game-options-modal__danger-row-description">
        {description}
      </span>
      <div className="game-options-modal__danger-row-action">{children}</div>
    </div>
  );
}

export function DangerZoneSection({
  game,
  deleting,
  isDeletingAchievements,
  hasAchievements,
  isGameDownloading,
  removeFilesTarget,
  userDetails,
  onOpenRemoveFromLibrary,
  onOpenResetAchievements,
  onOpenChangePlaytime,
  onOpenResetPlaytime,
  onOpenRemoveFiles,
}: Readonly<DangerZoneSectionProps>) {
  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();
  const { isFeatureEnabled, Feature } = useFeature();

  const minutes = getDisplayedPlayTimeInMilliseconds(game) / 60_000;
  const playTime =
    minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME
      ? t("amount_minutes", { amount: minutes.toFixed(0) })
      : t("amount_hours", { amount: numberFormatter.format(minutes / 60) });

  const getAchievementsDescription = () => {
    if (!userDetails) return t("danger_achievements_sign_in");
    if (!hasAchievements) return t("danger_achievements_none");
    return t("danger_achievements_description");
  };
  const canResetAchievements =
    !deleting && !isDeletingAchievements && hasAchievements && !!userDetails;

  const getFilesDescription = () => {
    if (isGameDownloading) return t("danger_files_downloading");
    if (!removeFilesTarget) return t("danger_files_none");
    return t("danger_files_description");
  };
  const canRemoveFiles = !deleting && !isGameDownloading && !!removeFilesTarget;

  return (
    <div className="game-options-modal__danger-zone">
      <div className="game-options-modal__header">
        <h2>{t("danger_zone_section_title")}</h2>
        <h4 className="game-options-modal__danger-zone-description">
          {t("danger_zone_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__danger-table">
        <DangerRow
          label={t("danger_playtime_label")}
          description={t("danger_playtime_description", { time: playTime })}
        >
          <Button
            onClick={onOpenChangePlaytime}
            theme="outline"
            className="game-options-modal__warning-button"
          >
            {t("danger_change")}
          </Button>
        </DangerRow>

        <DangerRow
          label={t("danger_reset_playtime_label")}
          description={t("danger_reset_playtime_description")}
        >
          <Button onClick={onOpenResetPlaytime} theme="danger">
            {t("danger_reset")}
          </Button>
        </DangerRow>

        {game.shop !== "custom" && (
          <DangerRow
            label={t("danger_achievements_label")}
            description={getAchievementsDescription()}
            disabled={!canResetAchievements}
          >
            <Button
              onClick={onOpenResetAchievements}
              theme="danger"
              disabled={!canResetAchievements}
            >
              {t("danger_reset")}
            </Button>
          </DangerRow>
        )}

        {game.shop !== "custom" && (
          <DangerRow
            label={t("danger_files_label")}
            description={getFilesDescription()}
            disabled={!canRemoveFiles}
          >
            <Button
              onClick={() => {
                if (removeFilesTarget) onOpenRemoveFiles(removeFilesTarget);
              }}
              theme="danger"
              disabled={!canRemoveFiles}
            >
              {t("danger_remove")}
            </Button>
          </DangerRow>
        )}

        <DangerRow
          label={t("danger_library_label")}
          description={t("danger_library_description")}
          disabled={deleting}
        >
          <Button
            onClick={onOpenRemoveFromLibrary}
            theme="danger"
            disabled={deleting}
          >
            {t("danger_remove")}
          </Button>
        </DangerRow>
      </div>

      {isFeatureEnabled(Feature.Screenshots) ? (
        <MyScreenshotsDangerZone shop={game.shop} objectId={game.objectId} />
      ) : null}
    </div>
  );
}
