import { getCloudSavePresentation } from "@renderer/pages/game-details/cloud-save-v2/cloud-save-presentation";
import { CloudSaveStatusIcon } from "@renderer/pages/game-details/cloud-save-v2/cloud-save-status-icon";
import { useTranslation } from "react-i18next";
import type { FocusOverrides } from "../../../../services";
import { Button } from "../../../common";
import { GAME_HERO_OPEN_CLOUD_SAVE_ID } from "../navigation";
import { useBigPictureCloudSave } from "./cloud-save-v2-context";

interface BigPictureCloudSaveHeroButtonProps {
  focusNavigationOverrides: FocusOverrides;
}

export function BigPictureCloudSaveHeroButton({
  focusNavigationOverrides,
}: Readonly<BigPictureCloudSaveHeroButtonProps>) {
  const { t } = useTranslation("game_details");
  const {
    overview,
    isRefreshing,
    isSyncing,
    hasError,
    progress,
    canUseCloudSaves,
    hasExecutablePath,
    openManager,
  } = useBigPictureCloudSave();
  const presentation = getCloudSavePresentation({
    canUseCloudSaves,
    hasExecutablePath,
    isChecking: hasExecutablePath && isRefreshing && overview === null,
    isSyncing,
    hasError,
    hasUnconfiguredCustomPaths:
      (overview?.unconfiguredCustomPathCount ?? 0) > 0,
    state: overview?.state ?? null,
    progressStage: isSyncing ? (progress?.stage ?? null) : null,
  });

  return (
    <Button
      focusId={GAME_HERO_OPEN_CLOUD_SAVE_ID}
      focusNavigationOverrides={focusNavigationOverrides}
      variant="secondary"
      icon={<CloudSaveStatusIcon icon={presentation.icon} size={24} />}
      onClick={openManager}
    >
      {t(presentation.labelKey)}
    </Button>
  );
}
