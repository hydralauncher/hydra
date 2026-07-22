import { useTranslation } from "react-i18next";

import { CloudSavePanel, useCloudSaveV2 } from "../../cloud-save-v2";

interface HydraCloudV2SettingsSectionProps {
  onSelectExecutable: () => void;
}

export function HydraCloudV2SettingsSection({
  onSelectExecutable,
}: Readonly<HydraCloudV2SettingsSectionProps>) {
  const { t } = useTranslation("game_details");
  const {
    overview,
    isRefreshing,
    isSyncing,
    isGameRunning,
    hasError,
    progress,
    hasExecutablePath,
    openFileBrowser,
    runCloudSaveOperation,
    setAutomaticSyncEnabled,
    requestConflictResolution,
  } = useCloudSaveV2();

  return (
    <div className="game-options-modal__cloud-panel game-options-modal__cloud-panel--v2">
      <div className="game-options-modal__panel-header">
        <h2>{t("cloud_save_v2_modal_title")}</h2>
        <p>{t("cloud_save_v2_modal_description")}</p>
      </div>

      <CloudSavePanel
        showLaunchConflictWarning={false}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        isGameRunning={isGameRunning}
        hasExecutablePath={hasExecutablePath}
        isAutomaticSyncEnabled={overview?.isAutomaticSyncEnabled ?? true}
        hasError={hasError}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onOpenFileBrowser={openFileBrowser}
        onSelectExecutable={onSelectExecutable}
        onAutomaticSyncChange={setAutomaticSyncEnabled}
        onResolveConflict={requestConflictResolution}
      />
    </div>
  );
}
