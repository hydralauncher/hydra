import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { useFeature } from "@renderer/hooks";
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
  const { isFeatureEnabled, Feature } = useFeature();

  return (
    <div className="game-options-modal__danger-zone">
      <div className="game-options-modal__header">
        <h2>{t("danger_zone_section_title")}</h2>
        <h4 className="game-options-modal__danger-zone-description">
          {t("danger_zone_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__danger-zone-buttons">
        <Button
          onClick={onOpenRemoveFromLibrary}
          theme="danger"
          disabled={deleting}
        >
          {t("remove_from_library")}
        </Button>

        {game.shop !== "custom" && (
          <Button
            onClick={onOpenResetAchievements}
            theme="danger"
            disabled={
              deleting ||
              isDeletingAchievements ||
              !hasAchievements ||
              !userDetails
            }
          >
            {t("reset_achievements")}
          </Button>
        )}

        <Button onClick={onOpenChangePlaytime} theme="danger">
          {t("update_game_playtime")}
        </Button>

        <Button onClick={onOpenResetPlaytime} theme="danger">
          {t("reset_playtime")}
        </Button>

        {game.shop !== "custom" && (
          <Button
            onClick={() => {
              if (removeFilesTarget) onOpenRemoveFiles(removeFilesTarget);
            }}
            theme="danger"
            disabled={deleting || isGameDownloading || !removeFilesTarget}
          >
            {t("remove_files")}
          </Button>
        )}
      </div>

      {isFeatureEnabled(Feature.Screenshots) ? (
        <MyScreenshotsDangerZone shop={game.shop} objectId={game.objectId} />
      ) : null}
    </div>
  );
}
