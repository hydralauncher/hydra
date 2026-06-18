import { Cloud } from "@phosphor-icons/react";
import type { GameArtifact, LibraryGame } from "@types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, VerticalFocusGroup } from "../../../common";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { CloudSavesList } from "./cloud-saves-list";

import "./cloud-tab.scss";

export const GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID =
  "game-cloud-settings-primary-control";
const GAME_CLOUD_SETTINGS_AUTO_SYNC_ID = "game-cloud-settings-auto-sync";

export interface GameCloudSettingsProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (checked: boolean) => void;
}

export function GameCloudSettingsTab({
  game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<GameCloudSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);

  const loadArtifacts = useCallback(async () => {
    const params = new URLSearchParams({
      objectId: game.objectId,
      shop: game.shop,
    });
    const result = await window.electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => []);
    setArtifacts(result ?? []);
  }, [game.objectId, game.shop]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  const handleCreateBackup = useCallback(async () => {
    if (creatingBackup) return;
    setCreatingBackup(true);
    try {
      await window.electron.uploadSaveGame(game.objectId, game.shop, null);
      await loadArtifacts();
    } finally {
      setCreatingBackup(false);
    }
  }, [creatingBackup, game.objectId, game.shop, loadArtifacts]);

  if (game.shop === "custom") {
    return <p>{t("settings_not_available_for_custom_games")}</p>;
  }

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      <SettingsSection
        className="game-cloud-settings-tab__section"
        title={t("cloud_saves_section_title")}
        description={t(game.shop === "launchbox"
          ? "cloud_saves_section_description_memory"
          : "cloud_saves_section_description")}
      >
        <div className="game-cloud-settings-tab__section-content">
          <Button
            focusId={GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}
            variant="primary"
            className="game-cloud-settings-tab__new-backup-button"
            onClick={() => void handleCreateBackup()}
            loading={creatingBackup}
            icon={<Cloud size={20} />}
          >
            {t("create_backup")}
          </Button>

          <Checkbox
            block
            focusId={GAME_CLOUD_SETTINGS_AUTO_SYNC_ID}
            label={t("enable_automatic_cloud_sync")}
            checked={automaticCloudSync}
            onChange={onToggleAutomaticCloudSync}
          />
        </div>
      </SettingsSection>

      <CloudSavesList artifacts={artifacts} />
    </VerticalFocusGroup>
  );
}
