import type { LibraryGame } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarModal, type SidebarModalTab } from "../../../common";
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
  GameDownloadsSettingsTab,
  GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID,
} from "./downloads-tab";
import {
  GameDangerZoneSettingsTab,
  GAME_DANGER_ZONE_PRIMARY_CONTROL_ID,
} from "./danger-zone-tab";

type GameSettingsTabId =
  | "launch"
  | "customization"
  | "hydra_cloud"
  | "compatibility"
  | "downloads"
  | "danger_zone";

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
  const shouldShowCompatibilityTab =
    globalThis.window.electron.platform === "linux";
  const settingsLabel = t("settings", { ns: "header" });

  useEffect(() => {
    if (visible) {
      setActiveTabId("launch");
    }
  }, [visible]);

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
  const downloadContent = useMemo(
    () => <GameDownloadsSettingsTab game={game} />,
    [game]
  );
  const dangerContent = useMemo(
    () => <GameDangerZoneSettingsTab game={game} onClose={onClose} />,
    [game, onClose]
  );

  const shouldShowCloudTab =
    userDetails !== null && hasActiveSubscription;

  useEffect(() => {
    if (!shouldShowCloudTab && activeTabId === "hydra_cloud") {
      setActiveTabId("launch");
    }
  }, [shouldShowCloudTab, activeTabId]);

  const tabs = useMemo<SidebarModalTab[]>(
    () => [
      {
        id: "launch",
        label: "Launch",
        content: launchContent,
      },
      {
        id: "customization",
        label: "Customization",
        content: customizationContent,
      },
      ...(shouldShowCloudTab
        ? [
            {
              id: "hydra_cloud",
              label: t("settings_category_hydra_cloud"),
              content: cloudContent,
            } satisfies SidebarModalTab,
          ]
        : []),
      ...(shouldShowCompatibilityTab
        ? [
            {
              id: "compatibility",
              label: t("settings_category_compatibility"),
              content: <p>Compatibility</p>,
            } satisfies SidebarModalTab,
          ]
        : []),
      {
        id: "downloads",
        label: t("settings_category_downloads"),
        content: downloadContent,
      },
      {
        id: "danger_zone",
        label: t("settings_category_danger_zone"),
        content: dangerContent,
      },
    ],
    [cloudContent, customizationContent, dangerContent, downloadContent, launchContent, shouldShowCloudTab, shouldShowCompatibilityTab, t]
  );

  return (
    <SidebarModal
      visible={visible}
      onClose={onClose}
      title={settingsLabel}
      className="game-settings-modal"
      ariaLabel={settingsLabel}
      contentEntryFocusId={
        activeTabId === "launch"
          ? GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID
          : activeTabId === "customization"
            ? GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID
            : activeTabId === "hydra_cloud"
              ? GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID
              : activeTabId === "downloads"
                ? GAME_DOWNLOADS_SETTINGS_PRIMARY_CONTROL_ID
                : activeTabId === "danger_zone"
                  ? GAME_DANGER_ZONE_PRIMARY_CONTROL_ID
                  : undefined
      }
      tabs={tabs}
      activeTabId={activeTabId}
      onActiveTabChange={(tabId) => setActiveTabId(tabId as GameSettingsTabId)}
    />
  );
}
