import { useTranslation } from "react-i18next";

import type { LibraryGame } from "@types";
import { WebDavSyncPanel } from "../../webdav-sync/webdav-sync-panel";

interface WebDavSettingsSectionProps {
  game: LibraryGame;
  automaticWebDavSync: boolean;
  onToggleAutomaticWebDavSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

export function WebDavSettingsSection({
  game,
  automaticWebDavSync,
  onToggleAutomaticWebDavSync,
}: Readonly<WebDavSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  return (
    <div className="game-options-modal__cloud-panel">
      <WebDavSyncPanel
        automaticWebDavSync={automaticWebDavSync}
        onToggleAutomaticWebDavSync={onToggleAutomaticWebDavSync}
      />
    </div>
  );
}
