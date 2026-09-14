import { useTranslation } from "react-i18next";

import {
  BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID,
  BigPictureCloudSavePanel,
  useBigPictureCloudSave,
} from "../cloud-save-v2";
import { SettingsSection } from "../../../../pages/settings/settings-section";

import "./cloud-v2-tab.scss";

export const GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID =
  BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID;

interface GameCloudV2SettingsTabProps {
  onSelectExecutable: () => void;
}

export function GameCloudV2SettingsTab({
  onSelectExecutable,
}: Readonly<GameCloudV2SettingsTabProps>) {
  const { t } = useTranslation("game_details");
  const { panelProps } = useBigPictureCloudSave();

  return (
    <div className="game-cloud-v2-settings-tab">
      <SettingsSection
        title={t("cloud_save_v2_modal_title")}
        description={t("cloud_save_v2_modal_description")}
      >
        <BigPictureCloudSavePanel
          {...panelProps}
          showLaunchConflictWarning={false}
          stealFocusOnActionAppear={false}
          onSelectExecutable={onSelectExecutable}
        />
      </SettingsSection>
    </div>
  );
}
