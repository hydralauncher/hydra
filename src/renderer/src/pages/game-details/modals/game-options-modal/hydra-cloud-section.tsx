import { useTranslation } from "react-i18next";

import type { LibraryGame } from "@types";
import { platformToEmulationSavePlatform } from "@renderer/helpers";
import { CloudSyncPanel } from "../../cloud-sync/cloud-sync-panel";
import { GameEmulationSaves } from "../../cloud-sync/game-emulation-saves";

interface HydraCloudLegacySettingsSectionProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

export function HydraCloudLegacySettingsSection({
  game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<HydraCloudLegacySettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  const platform =
    game.shop === "launchbox"
      ? platformToEmulationSavePlatform(game.platform)
      : null;
  if (platform) {
    return (
      <div className="game-options-modal__cloud-panel">
        <GameEmulationSaves platform={platform} objectId={game.objectId} />
      </div>
    );
  }

  return (
    <div className="game-options-modal__cloud-panel">
      <CloudSyncPanel
        automaticCloudSync={automaticCloudSync}
        onToggleAutomaticCloudSync={onToggleAutomaticCloudSync}
      />
    </div>
  );
}
