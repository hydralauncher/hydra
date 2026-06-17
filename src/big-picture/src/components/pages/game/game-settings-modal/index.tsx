import type { LibraryGame } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarModal, type SidebarModalTab } from "../../../common";
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
  onClose: () => void;
}

export function GameSettingsModal({
  visible,
  launchSettings,
  customizationSettings,
  onClose,
}: Readonly<GameSettingsModalProps>) {
  const { t } = useTranslation(["game_details", "header"]);
  const [activeTabId, setActiveTabId] = useState<GameSettingsTabId>("launch");
  const shouldShowCompatibilityTab =
    globalThis.window.electron.platform === "linux";
  const settingsLabel = t("settings", { ns: "header" });

  useEffect(() => {
    if (visible) {
      setActiveTabId("launch");
    }
  }, [visible]);

  const tabs = useMemo<SidebarModalTab[]>(
    () => [
      {
        id: "launch",
        label: "Launch",
        content: <GameLaunchSettingsTab {...launchSettings} />,
      },
      {
        id: "customization",
        label: "Customization",
        content: <GameCustomizationSettingsTab {...customizationSettings} />,
      },
      {
        id: "hydra_cloud",
        label: t("settings_category_hydra_cloud"),
        content: <p>Hydra Cloud</p>,
      },
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
        content: <p>Downloads</p>,
      },
      {
        id: "danger_zone",
        label: t("settings_category_danger_zone"),
        content: <p>Danger Zone</p>,
      },
    ],
    [customizationSettings, launchSettings, shouldShowCompatibilityTab, t]
  );

  return (
    <SidebarModal
      visible={visible}
      onClose={onClose}
      title={settingsLabel}
      ariaLabel={settingsLabel}
      contentEntryFocusId={
        activeTabId === "launch"
          ? GAME_LAUNCH_SETTINGS_PRIMARY_CONTROL_ID
          : activeTabId === "customization"
            ? GAME_CUSTOMIZATION_SETTINGS_PRIMARY_CONTROL_ID
            : undefined
      }
      tabs={tabs}
      activeTabId={activeTabId}
      onActiveTabChange={(tabId) => setActiveTabId(tabId as GameSettingsTabId)}
    />
  );
}
