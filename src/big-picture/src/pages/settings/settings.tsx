import { useCallback, useEffect, useMemo, useState } from "react";

import { Tabs, type TabsItem, VerticalFocusGroup } from "../../components";
import { useGamepad, useNavigation } from "../../hooks";
import { getItemFocusTarget } from "../../helpers";
import { GamepadButtonType } from "../../types";
import { AccountPrivacySettingsSection } from "./account-privacy";
import { CompatibilitySettingsSection } from "./compatibility";
import { ContentGameplaySettingsSection } from "./content-gameplay";
import { DownloadsSettingsSection } from "./downloads";
import { GeneralSettingsSection } from "./general";
import { IntegrationsSettingsSection } from "./integrations";
import { SETTINGS_PAGE_REGION_ID } from "./navigation";
import { NotificationsSettingsSection } from "./notifications";
import {
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
  SETTINGS_TAB_FOCUS_IDS,
  SETTINGS_TABS_REGION_ID,
} from "./settings-navigation";

import "./page.scss";

const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "downloads", label: "Downloads" },
  { id: "notifications", label: "Notifications" },
  { id: "content-gameplay", label: "Content and Gameplay" },
  { id: "integrations", label: "Integrations" },
  { id: "compatibility", label: "Compatibility" },
  { id: "account-privacy", label: "Account and Privacy" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
type SettingsSectionComponentProps = {
  className?: string;
};

const SETTINGS_TAB_CONTENT: Record<
  SettingsTabId,
  (props: SettingsSectionComponentProps) => React.JSX.Element
> = {
  general: GeneralSettingsSection,
  downloads: DownloadsSettingsSection,
  notifications: NotificationsSettingsSection,
  "content-gameplay": ContentGameplaySettingsSection,
  integrations: IntegrationsSettingsSection,
  compatibility: CompatibilitySettingsSection,
  "account-privacy": AccountPrivacySettingsSection,
};

export default function Settings() {
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(
    SETTINGS_TABS[0].id
  );
  const { setFocus } = useNavigation();
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();

  const selectedTabIndex = SETTINGS_TABS.findIndex(
    (tab) => tab.id === selectedTab
  );
  const SelectedTabContent =
    SETTINGS_TAB_CONTENT[selectedTab] ?? GeneralSettingsSection;

  const focusSettingsTab = useCallback(
    (tabId: SettingsTabId) => {
      globalThis.window.requestAnimationFrame(() => {
        setFocus(SETTINGS_TAB_FOCUS_IDS[tabId]);
      });
    },
    [setFocus]
  );

  const selectTabByIndex = useCallback(
    (nextIndex: number, options?: { focusTab?: boolean }) => {
      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, SETTINGS_TABS.length - 1)
      );
      const nextTab = SETTINGS_TABS[clampedIndex];

      if (!nextTab) return;

      setSelectedTab(nextTab.id);

      if (options?.focusTab) {
        focusSettingsTab(nextTab.id);
      }
    },
    [focusSettingsTab]
  );

  useEffect(() => {
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event) || selectedTabIndex <= 0) return;

        selectTabByIndex(selectedTabIndex - 1, { focusTab: true });
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (
          !isActiveGamepadEvent(event) ||
          selectedTabIndex >= SETTINGS_TABS.length - 1
        ) {
          return;
        }

        selectTabByIndex(selectedTabIndex + 1, { focusTab: true });
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    isActiveGamepadEvent,
    onButtonPressed,
    selectTabByIndex,
    selectedTabIndex,
  ]);

  const tabItems = useMemo(() => {
    return SETTINGS_TABS.map(
      (tab, index): TabsItem<SettingsTabId> => {
        const previousTab = SETTINGS_TABS[index - 1];
        const nextTab = SETTINGS_TABS[index + 1];

        const downTarget =
          tab.id === "downloads"
            ? getItemFocusTarget(
                DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.seedAfterDownloadComplete
              )
            : tab.id === "general"
              ? getItemFocusTarget(DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID)
              : { type: "block" as const };

        return {
          id: SETTINGS_TAB_FOCUS_IDS[tab.id],
          value: tab.id,
          label: tab.label,
          navigationOverrides: {
            left: previousTab
              ? getItemFocusTarget(SETTINGS_TAB_FOCUS_IDS[previousTab.id])
              : { type: "block" },
            right: nextTab
              ? getItemFocusTarget(SETTINGS_TAB_FOCUS_IDS[nextTab.id])
              : { type: "block" },
            down: downTarget,
          },
        };
      }
    );
  }, []);

  return (
    <VerticalFocusGroup regionId={SETTINGS_PAGE_REGION_ID} asChild>
      <section className="settings-page">
        <div className="settings-page__stack">
          <div className="settings-page__tabs-wrap">
            <Tabs
              className="settings-page__tabs"
              items={tabItems}
              value={selectedTab}
              onValueChange={setSelectedTab}
              variant="settings"
              regionId={SETTINGS_TABS_REGION_ID}
              ariaLabel="Settings categories"
            />
          </div>

          <section className="settings-page__content">
            <SelectedTabContent className="settings-page__copy" />
          </section>
        </div>
      </section>
    </VerticalFocusGroup>
  );
}
