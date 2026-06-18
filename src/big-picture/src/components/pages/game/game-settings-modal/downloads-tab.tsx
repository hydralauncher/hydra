import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { Button, VerticalFocusGroup } from "../../../common";
import { DownloadGameModal } from "../../../modals";
import { SettingsSection } from "../../../../pages/settings/settings-section";

import "./downloads-tab.scss";

export const GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID =
  "game-downloads-settings-primary-control";

interface GameDownloadsSettingsTabProps {
  game: LibraryGame;
}

export function GameDownloadsSettingsTab({
  game,
}: Readonly<GameDownloadsSettingsTabProps>) {
  const { t } = useTranslation("game_details");
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  return (
    <VerticalFocusGroup className="game-downloads-settings-tab">
      <SettingsSection
        className="game-downloads-settings-tab__section"
        title={t("settings_category_downloads")}
        description={t("settings_category_downloads_description")}
      >
        <div className="game-downloads-settings-tab__section-content">
          <Button
            focusId={GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID}
            variant="primary"
            onClick={() => setIsDownloadModalOpen(true)}
          >
            {t("open_download_options")}
          </Button>
        </div>
      </SettingsSection>

      <DownloadGameModal
        visible={isDownloadModalOpen}
        game={game}
        onClose={() => setIsDownloadModalOpen(false)}
      />
    </VerticalFocusGroup>
  );
}
