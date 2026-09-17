import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button } from "@renderer/components";
import type { LibraryGame, UserDetails } from "@types";

interface DangerZoneSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isDeletingAchievements: boolean;
  hasAchievements: boolean;
  isGameDownloading: boolean;
  userDetails: UserDetails | null;
  onOpenRemoveFromLibrary: () => void;
  onOpenResetAchievements: () => void;
  onOpenChangePlaytime: () => void;
  onOpenResetPlaytime: () => void;
  onOpenRemoveFiles: () => void;
}

interface DangerZoneRowProps {
  title: string;
  description: string;
  actionLabel: string;
  theme: "outline" | "danger";
  disabled?: boolean;
  onClick: () => void;
}

function DangerZoneRow({
  title,
  description,
  actionLabel,
  theme,
  disabled = false,
  onClick,
}: Readonly<DangerZoneRowProps>) {
  return (
    <div
      className={cn("game-options-modal__danger-zone-row", {
        "game-options-modal__danger-zone-row--disabled": disabled,
      })}
    >
      <div className="game-options-modal__danger-zone-row-text">
        <span className="game-options-modal__danger-zone-row-title">
          {title}
        </span>
        <span className="game-options-modal__danger-zone-row-description">
          {description}
        </span>
      </div>

      <Button
        className="game-options-modal__danger-zone-action"
        theme={theme}
        disabled={disabled}
        onClick={onClick}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

interface DangerZoneGroupProps {
  label: string;
  destructive?: boolean;
  children: ReactNode;
}

function DangerZoneGroup({
  label,
  destructive = false,
  children,
}: Readonly<DangerZoneGroupProps>) {
  return (
    <div className="game-options-modal__danger-zone-group">
      <span className="game-options-modal__danger-zone-group-label">
        {label}
      </span>
      <div
        className={cn("game-options-modal__danger-zone-card", {
          "game-options-modal__danger-zone-card--destructive": destructive,
        })}
      >
        {children}
      </div>
    </div>
  );
}

export function DangerZoneSection({
  game,
  deleting,
  isDeletingAchievements,
  hasAchievements,
  isGameDownloading,
  userDetails,
  onOpenRemoveFromLibrary,
  onOpenResetAchievements,
  onOpenChangePlaytime,
  onOpenResetPlaytime,
  onOpenRemoveFiles,
}: Readonly<DangerZoneSectionProps>) {
  const { t } = useTranslation("game_details");

  const isCustomGame = game.shop === "custom";
  const hasDownloadedFiles = Boolean(game.download?.downloadPath);

  const resetAchievementsDisabled =
    deleting || isDeletingAchievements || !hasAchievements || !userDetails;

  const resetAchievementsDescription = (() => {
    if (!userDetails)
      return t("danger_zone_reset_achievements_sign_in_required");
    if (!hasAchievements)
      return t("danger_zone_reset_achievements_none_unlocked");
    return t("danger_zone_reset_achievements_description");
  })();

  const removeFilesDisabled =
    isGameDownloading || deleting || !hasDownloadedFiles;

  const removeFilesDescription = (() => {
    if (isGameDownloading)
      return t("danger_zone_remove_files_download_in_progress");
    if (!hasDownloadedFiles)
      return t("danger_zone_remove_files_nothing_downloaded");
    return t("danger_zone_remove_files_description");
  })();

  return (
    <div className="game-options-modal__danger-zone">
      <div className="game-options-modal__header">
        <h2>{t("danger_zone_section_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("danger_zone_section_description")}
        </h4>
      </div>

      <DangerZoneGroup label={t("danger_zone_progress_group")}>
        <DangerZoneRow
          title={t("update_game_playtime")}
          description={t("danger_zone_update_playtime_description")}
          actionLabel={t("danger_zone_update_action")}
          theme="outline"
          onClick={onOpenChangePlaytime}
        />

        <DangerZoneRow
          title={t("reset_playtime")}
          description={t("danger_zone_reset_playtime_description")}
          actionLabel={t("danger_zone_reset_action")}
          theme="outline"
          onClick={onOpenResetPlaytime}
        />

        {!isCustomGame && (
          <DangerZoneRow
            title={t("reset_achievements")}
            description={resetAchievementsDescription}
            actionLabel={t("danger_zone_reset_action")}
            theme="outline"
            disabled={resetAchievementsDisabled}
            onClick={onOpenResetAchievements}
          />
        )}
      </DangerZoneGroup>

      <DangerZoneGroup label={t("danger_zone_removal_group")} destructive>
        {!isCustomGame && (
          <DangerZoneRow
            title={t("remove_files")}
            description={removeFilesDescription}
            actionLabel={t("remove_files")}
            theme="danger"
            disabled={removeFilesDisabled}
            onClick={onOpenRemoveFiles}
          />
        )}

        <DangerZoneRow
          title={t("remove_from_library")}
          description={t("danger_zone_remove_from_library_description")}
          actionLabel={t("remove")}
          theme="danger"
          disabled={deleting}
          onClick={onOpenRemoveFromLibrary}
        />
      </DangerZoneGroup>
    </div>
  );
}
