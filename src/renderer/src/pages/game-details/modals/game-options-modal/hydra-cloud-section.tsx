import { useTranslation } from "react-i18next";

import type { LibraryGame } from "@types";
import { platformToSystem } from "@renderer/helpers";
import { CloudSyncPanel } from "../../cloud-sync/cloud-sync-panel";
import { GameEmulationSaves } from "../../cloud-sync/game-emulation-saves";

interface HydraCloudSettingsSectionProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

export function HydraCloudSettingsSection({
  game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<HydraCloudSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  const system =
    game.shop === "launchbox" ? platformToSystem(game.platform) : null;
  if (system === "ps1" || system === "ps2") {
    return (
      <div className="game-options-modal__cloud-panel">
        <GameEmulationSaves platform={system} objectId={game.objectId} />
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
