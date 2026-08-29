import type { LibraryGame } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarModal, type SidebarModalTab } from "../../../common";
import { resolvePreferredGameAssets } from "../../../../helpers";
import { useUserDetails } from "../../../../hooks/use-user-details.hook";

import "./styles.scss";
import {
  GameCustomizationSettingsTab,
  type GameCustomizationSettingsProps,
  GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
} from "./customization-tab";
import {
  GameLaunchSettingsTab,
  type GameLaunchSettingsProps,
  GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
} from "./launch-tab";
import {
  GameCloudSettingsTab,
  type GameCloudSettingsProps,
  GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-tab";
import {
  GameCloudV2SettingsTab,
  GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
} from "./cloud-v2-tab";
import {
  GameDownloadsSettingsTab,
  GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
} from "./downloads-tab";
import {
  GameDangerZoneSettingsTab,
  GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
} from "./danger-zone-tab";
import {
  GameCompatibilitySettingsTab,
  GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
} from "./compatibility-tab";
import {
  shouldShowCloudSaveV2Tab,
  shouldShowLegacyCloudSaveTab,
} from "./cloud-tab-visibility";

type GameSettingsTabId =
  | "launch"
  | "customization"
  | "hydra_cloud"
  | "hydra_cloud_legacy"
  | "compatibility"
  | "downloads"
  | "danger_zone";

const GAME_SETTINGS_TAB_FOCUS_IDS: Record<GameSettingsTabId, string> = {
  launch: GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID,
  customization: GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID,
  hydra_cloud: GAME_CLOUD_V2_SETTINGS_PRIMARY_CONTROL_ID,
  hydra_cloud_legacy: GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID,
  downloads: GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
  danger_zone: GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
  compatibility: GAME_COMPATIBILITY_SETTINGS_PRIMARY_CONTROL_ID,
};

interface GameSettingsModalProps {
  visible: boolean;
  game: LibraryGame;
  launchSettings: GameLaunchSettingsProps;
  customizationSettings: GameCustomizationSettingsProps;
  cloudSettings: GameCloudSettingsProps;
  onClose: () => void;
}

export function GameSettingsModal({
  visible,
  game,
  launchSettings,
  customizationSettings,
  cloudSettings,
  onClose,
}: Readonly<GameSettingsModalProps>) {
  const { t } = useTranslation(["game_details", "header"]);
  const [activeTabId, setActiveTabId] = useState<GameSettingsTabId>("launch");
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, null),
    [game]
  );
  const isDev = import.meta.env.DEV;
  const shouldShowCompatibilityTab =
    globalThis.window.electron.platform === "linux" || isDev;
  const shouldShowDownloadsTab = game.shop !== "custom";
  const settingsLabel = t("settings", { ns: "header" });

  useEffect(() => {
    if (visible) {
      setActiveTabId("launch");
    }
  }, []);

  const launchContent = useMemo(
    () => <GameLaunchSettingsTab {...launchSettings} />,
    [launchSettings]
  );
  const customizationContent = useMemo(
    () => <GameCustomizationSettingsTab {...customizationSettings} />,
    [customizationSettings]
  );
  const cloudContent = useMemo(
    () => <GameCloudSettingsTab {...cloudSettings} />,
    [cloudSettings]
  );
  const handleSelectExecutableFromCloudV2 = useCallback(() => {
    setActiveTabId("launch");
  }, []);
  const cloudV2Content = useMemo(
    () => (
      <GameCloudV2SettingsTab
        onSelectExecutable={handleSelectExecutableFromCloudV2}
      />
    ),
    [handleSelectExecutableFromCloudV2]
  );
  const downloadContent = useMemo(
    () => <GameDownloadsSettingsTab game={game} />,
    [game]
  );
  const dangerContent = useMemo(
    () => <GameDangerZoneSettingsTab game={game} onClose={onClose} />,
    [game, onClose]
  );
  const compatibilityContent = useMemo(
    () => <GameCompatibilitySettingsTab game={game} />,
    [game]
  );

  const isSignedIn = userDetails !== null;
  const shouldShowCloudV2Tab = shouldShowCloudSaveV2Tab(
    game.shop,
    isSignedIn,
    hasActiveSubscription
  );
  const shouldShowLegacyCloudTab = shouldShowLegacyCloudSaveTab(
    game.shop,
    isSignedIn,
    hasActiveSubscription
  );

  useEffect(() => {
    const isUnavailableTab =
      (activeTabId === "hydra_cloud" && !shouldShowCloudV2Tab) ||
      (activeTabId === "hydra_cloud_legacy" && !shouldShowLegacyCloudTab) ||
      (activeTabId === "downloads" && !shouldShowDownloadsTab);

    if (isUnavailableTab) {
      setActiveTabId("launch");
    }
  }, [
    activeTabId,
    shouldShowCloudV2Tab,
    shouldShowLegacyCloudTab,
    shouldShowDownloadsTab,
  ]);

  const tabs = useMemo<SidebarModalTab<GameSettingsTabId>[]>(
    () => [
      {
        id: "launch",
        label: t("settings_category_launch"),
        content: launchContent,
      },
      {
        id: "customization",
        label: t("settings_category_customization"),
        content: customizationContent,
      },
      ...(shouldShowCloudV2Tab
        ? [
            {
              id: "hydra_cloud",
              label: t("settings_category_hydra_cloud"),
              content: cloudV2Content,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowLegacyCloudTab
        ? [
            {
              id: "hydra_cloud_legacy",
              label: t("settings_category_hydra_cloud"),
              content: cloudContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowCompatibilityTab
        ? [
            {
              id: "compatibility",
              label: t("settings_category_compatibility"),
              content: compatibilityContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      ...(shouldShowDownloadsTab
        ? [
            {
              id: "downloads",
              label: t("settings_category_downloads"),
              content: downloadContent,
            } satisfies SidebarModalTab<GameSettingsTabId>,
          ]
        : []),
      {
        id: "danger_zone",
        label: t("settings_category_danger_zone"),
        content: dangerContent,
      },
    ],
    [
      cloudContent,
      cloudV2Content,
      compatibilityContent,
      customizationContent,
      dangerContent,
      downloadContent,
      launchContent,
      shouldShowCloudV2Tab,
      shouldShowLegacyCloudTab,
      shouldShowCompatibilityTab,
      shouldShowDownloadsTab,
      t,
    ]
  );

  return (
    <SidebarModal
      visible={visible}
      onClose={onClose}
      title={settingsLabel}
      coverImage={preferredAssets.heroSrc || undefined}
      className="game-settings-modal"
      ariaLabel={settingsLabel}
      contentEntryFocusId={GAME_SETTINGS_TAB_FOCUS_IDS[activeTabId]}
      tabs={tabs}
      activeTabId={activeTabId}
      onActiveTabChange={setActiveTabId}
    />
  );
}
