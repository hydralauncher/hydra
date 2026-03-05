import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import type { LibraryGame } from "@types";

interface DownloadsSettingsSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isGameDownloading: boolean;
  repacksLength: number;
  onOpenRepacks: () => void;
  onOpenDownloadFolder: () => Promise<void>;
}

export function DownloadsSettingsSection({
  game,
  deleting,
  isGameDownloading,
  repacksLength,
  onOpenRepacks,
  onOpenDownloadFolder,
}: Readonly<DownloadsSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  return (
    <div className="game-options-modal__downloads">
      <div className="game-options-modal__header">
        <h2>{t("downloads_section_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("downloads_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__row">
        <Button
          onClick={onOpenRepacks}
          theme="outline"
          disabled={deleting || isGameDownloading || !repacksLength}
        >
          {t("open_download_options")}
        </Button>
        {game.download?.downloadPath && (
          <Button
            onClick={onOpenDownloadFolder}
            theme="outline"
            disabled={deleting}
          >
            {t("open_download_location")}
          </Button>
        )}
      </div>
    </div>
  );
}
