import { useCallback, useEffect, useMemo, useState } from "react";

import { Tabs, type TabsItem } from "../../components";
import { useGamepad } from "../../hooks";
import { GamepadButtonType } from "../../types";

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

function SettingsBumper({ label }: Readonly<{ label: "LB" | "RB" }>) {
  return <div className="settings-page__bumper">{label}</div>;
}

export default function Settings() {
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(
    SETTINGS_TABS[0].id
  );
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();

  const selectedTabIndex = SETTINGS_TABS.findIndex(
    (tab) => tab.id === selectedTab
  );
  const selectedTabMeta = SETTINGS_TABS[selectedTabIndex] ?? SETTINGS_TABS[0];

  const selectTabByIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, SETTINGS_TABS.length - 1)
      );
      const nextTab = SETTINGS_TABS[clampedIndex];

      if (!nextTab) return;

      setSelectedTab(nextTab.id);
    },
    []
  );

  useEffect(() => {
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event) || selectedTabIndex <= 0) return;

        selectTabByIndex(selectedTabIndex - 1);
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

        selectTabByIndex(selectedTabIndex + 1);
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
      (tab): TabsItem<SettingsTabId> => ({
        value: tab.id,
        label: tab.label,
      })
    );
  }, []);

  return (
    <section className="settings-page">
      <div className="settings-page__stack">
        <Tabs
          className="settings-page__tabs"
          items={tabItems}
          value={selectedTab}
          onValueChange={setSelectedTab}
          variant="settings"
          ariaLabel="Settings categories"
          beforeTabs={<SettingsBumper label="LB" />}
          afterTabs={<SettingsBumper label="RB" />}
        />

        <section className="settings-page__content">
          <p className="settings-page__copy">
            {selectedTabMeta.label} content coming soon.
          </p>
        </section>
      </div>
    </section>
  );
}
