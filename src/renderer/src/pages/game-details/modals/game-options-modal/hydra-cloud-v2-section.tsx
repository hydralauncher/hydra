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
    isAutomaticSyncEnabled,
    isRefreshing,
    isSyncing,
    isGameRunning,
    hasError,
    errorMessageKey,
    progress,
    hasExecutablePath,
    requiresRom,
    requiresDisc,
    retroArchExecutableStatus,
    retryRetroArchExecutable,
    openRetroArchSettings,
    rpcs3ConfigStatus,
    retryRpcs3Config,
    rpcs3DiscStatus,
    rpcs3IdentityError,
    retryRpcs3Disc,
    openRpcs3Settings,
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
        requiresRom={requiresRom}
        requiresDisc={requiresDisc}
        retroArchExecutableStatus={retroArchExecutableStatus}
        onRetryRetroArchExecutable={retryRetroArchExecutable}
        onConfigureRetroArch={openRetroArchSettings}
        rpcs3ConfigStatus={rpcs3ConfigStatus}
        onRetryRpcs3Config={retryRpcs3Config}
        rpcs3DiscStatus={rpcs3DiscStatus}
        rpcs3IdentityError={rpcs3IdentityError}
        onRetryRpcs3Disc={retryRpcs3Disc}
        onConfigureRpcs3={openRpcs3Settings}
        isAutomaticSyncEnabled={isAutomaticSyncEnabled ?? true}
        hasError={hasError}
        errorMessageKey={errorMessageKey}
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
