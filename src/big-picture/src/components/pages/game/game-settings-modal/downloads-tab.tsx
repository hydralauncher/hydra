import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { Button, VerticalFocusGroup } from "../../../common";
import { DownloadGameModal } from "../../../modals";
import { resolvePreferredGameAssets } from "../../../../helpers";
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
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, null),
    [game]
  );
  const modalGame = useMemo(
    () => ({
      objectId: game.objectId,
      shop: game.shop,
      title: preferredAssets.title || game.title,
      iconUrl: preferredAssets.iconUrl,
      downloadSources: preferredAssets.downloadSources ?? game.downloadSources,
      libraryHeroImageUrl: preferredAssets.heroSrc || null,
      libraryImageUrl: preferredAssets.libraryImageUrl,
      coverImageUrl: preferredAssets.coverSrc || null,
    }),
    [game, preferredAssets]
  );

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
        game={modalGame}
        onClose={() => setIsDownloadModalOpen(false)}
      />
    </VerticalFocusGroup>
  );
}
