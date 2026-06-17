import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { Tabs, type TabsItem, VerticalFocusGroup } from "../../components";
import { useGamepad, useNavigation } from "../../hooks";
import {
  NavigationAudioService,
  type FocusOverrideTarget,
} from "../../services";
import { GamepadButtonType } from "../../types";
import { useVirtualKeyboardStore } from "../../stores";
import { AccountPrivacySettingsSection } from "./account-privacy";
import { BigPictureSettingsSection } from "./big-picture";
import { CompatibilitySettingsSection } from "./compatibility";
import { ContentSettingsSection } from "./content";
import { DownloadsSettingsSection } from "./downloads";
import { EmulationSettingsSection } from "./emulation";
import { GeneralSettingsSection } from "./general";
import { IntegrationsSettingsSection } from "./integrations";
import { SETTINGS_PAGE_REGION_ID } from "./navigation";
import { NotificationsSettingsSection } from "./notifications";
import { useUserDetails } from "../../hooks";
import {
  ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
  COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
  COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
  CONTENT_ITEM_FOCUS_IDS,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOADS_SOURCES_SECTION_REGION_ID,
  DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  getIntegrationProviderCheckboxFocusId,
  NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS,
} from "./settings-navigation";

import "./page.scss";

const ALL_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "downloads", label: "Downloads" },
  { id: "notifications", label: "Notifications" },
  { id: "content", label: "Content" },
  { id: "big-picture", label: "Big Picture" },
  { id: "emulation", label: "Emulation" },
  { id: "integrations", label: "Integrations" },
  { id: "compatibility", label: "Compatibility" },
  { id: "account-privacy", label: "Account and Privacy" },
] as const;

const SETTINGS_PAGE_FADE_TRANSITION = {
  duration: 0.24,
  ease: "easeOut",
} as const;

const SETTINGS_TAB_FADE_TRANSITION = {
  duration: 0.18,
  ease: "easeOut",
} as const;

type SettingsTabId = (typeof ALL_SETTINGS_TABS)[number]["id"];
type SettingsSectionId = "sources";
type SettingsSectionComponentProps = {
  className?: string;
};

function getSettingsTabFromSearch(search: string): SettingsTabId | null {
  const tab = new URLSearchParams(search).get("tab");

  return ALL_SETTINGS_TABS.some((item) => item.id === tab)
    ? (tab as SettingsTabId)
    : null;
}

function getSettingsSectionFromSearch(
  search: string
): SettingsSectionId | null {
  const section = new URLSearchParams(search).get("section");

  return section === "sources" ? "sources" : null;
}

function SettingsBumper({ label }: Readonly<{ label: "LB" | "RB" }>) {
  return <div className="settings-page__bumper">{label}</div>;
}

const SETTINGS_TAB_CONTENT: Record<
  SettingsTabId,
  (props: SettingsSectionComponentProps) => React.JSX.Element | null
> = {
  general: GeneralSettingsSection,
  downloads: DownloadsSettingsSection,
  notifications: NotificationsSettingsSection,
  content: ContentSettingsSection,
  "big-picture": BigPictureSettingsSection,
  emulation: EmulationSettingsSection,
  integrations: IntegrationsSettingsSection,
  compatibility: CompatibilitySettingsSection,
  "account-privacy": AccountPrivacySettingsSection,
};

function SettingsTabPanel({
  selectedTab,
  initialFocusTarget,
  children,
}: Readonly<{
  selectedTab: SettingsTabId;
  initialFocusTarget: FocusOverrideTarget | null;
  children: React.JSX.Element;
}>) {
  const { setFocus, setFocusRegion } = useNavigation();

  useEffect(() => {
    if (!initialFocusTarget) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      if (initialFocusTarget.type === "item") {
        setFocus(initialFocusTarget.itemId);
        return;
      }

      if (initialFocusTarget.type === "region") {
        setFocusRegion(
          initialFocusTarget.regionId,
          initialFocusTarget.entryDirection,
          {
            initialFocusId: initialFocusTarget.initialFocusId,
            preferRememberedFocus: initialFocusTarget.preferRememberedFocus,
          }
        );
      }
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [initialFocusTarget, setFocus, setFocusRegion]);

  return (
    <motion.div
      key={selectedTab}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SETTINGS_TAB_FADE_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

export default function Settings() {
  const { userDetails } = useUserDetails();
  const { search } = useLocation();
  const [selectedTab, setSelectedTab] = useState<SettingsTabId>(
    getSettingsTabFromSearch(search) ?? ALL_SETTINGS_TABS[0].id
  );
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const requestedSection = useMemo(
    () => getSettingsSectionFromSearch(search),
    [search]
  );

  const visibleTabs = useMemo(() => {
    return ALL_SETTINGS_TABS.filter((tab) => {
      if (tab.id === "emulation") return false;
      if (tab.id !== "account-privacy") return true;

      return Boolean(userDetails);
    });
  }, [userDetails]);

  const selectedTabIndex = visibleTabs.findIndex(
    (tab) => tab.id === selectedTab
  );
  const SelectedTabContent =
    SETTINGS_TAB_CONTENT[selectedTab] ?? GeneralSettingsSection;

  useEffect(() => {
    const requestedTab = getSettingsTabFromSearch(search);
    if (requestedTab && visibleTabs.some((tab) => tab.id === requestedTab)) {
      setSelectedTab(requestedTab);
      return;
    }

    if (visibleTabs.some((tab) => tab.id === selectedTab)) return;

    const fallbackTab = visibleTabs[0]?.id ?? ALL_SETTINGS_TABS[0].id;
    setSelectedTab(fallbackTab);
  }, [search, selectedTab, visibleTabs]);

  const selectTabByIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, visibleTabs.length - 1)
      );
      const nextTab = visibleTabs[clampedIndex];

      if (!nextTab || nextTab.id === selectedTab) return false;

      setSelectedTab(nextTab.id);
      return true;
    },
    [selectedTab, visibleTabs]
  );

  useEffect(() => {
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (
          virtualKeyboardTarget ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex <= 0
        ) {
          return;
        }

        if (selectTabByIndex(selectedTabIndex - 1)) {
          NavigationAudioService.getInstance().play("scroll");
        }
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (
          virtualKeyboardTarget ||
          !isActiveGamepadEvent(event) ||
          selectedTabIndex >= visibleTabs.length - 1
        ) {
          return;
        }

        if (selectTabByIndex(selectedTabIndex + 1)) {
          NavigationAudioService.getInstance().play("scroll");
        }
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
    virtualKeyboardTarget,
    visibleTabs.length,
  ]);

  const tabItems = useMemo(() => {
    return visibleTabs.map(
      (tab): TabsItem<SettingsTabId> => ({
        value: tab.id,
        label: tab.label,
      })
    );
  }, [visibleTabs]);

  const initialFocusTarget = useMemo<FocusOverrideTarget | null>(() => {
    const platform = globalThis.window.electron.platform;

    switch (selectedTab) {
      case "general":
        return {
          type: "item",
          itemId: DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
        };
      case "downloads":
        return requestedSection === "sources"
          ? {
              type: "region",
              regionId: DOWNLOADS_SOURCES_SECTION_REGION_ID,
              entryDirection: "down",
              preferRememberedFocus: false,
            }
          : {
              type: "item",
              itemId:
                DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.seedAfterDownloadComplete,
            };
      case "notifications":
        return {
          type: "item",
          itemId:
            NOTIFICATIONS_LIBRARY_ITEM_FOCUS_IDS.downloadNotificationsEnabled,
        };
      case "content":
        return {
          type: "item",
          itemId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        };
      case "big-picture":
        return {
          type: "item",
          itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
        };
      case "emulation":
        return {
          type: "item",
          itemId: EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps1,
        };
      case "integrations":
        return {
          type: "item",
          itemId: getIntegrationProviderCheckboxFocusId("real-debrid"),
        };
      case "compatibility":
        return {
          type: "item",
          itemId:
            platform === "win32"
              ? COMPATIBILITY_COMMON_REDIST_BUTTON_ID
              : COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
        };
      case "account-privacy":
        return userDetails
          ? {
              type: "item",
              itemId: ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
            }
          : null;
      default:
        return null;
    }
  }, [requestedSection, selectedTab, userDetails]);

  return (
    <VerticalFocusGroup regionId={SETTINGS_PAGE_REGION_ID} asChild>
      <motion.section
        className="settings-page"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={SETTINGS_PAGE_FADE_TRANSITION}
      >
        <div className="settings-page__stack">
          <div className="settings-page__tabs-wrap">
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
          </div>

          <section className="settings-page__content">
            <AnimatePresence mode="wait" initial={false}>
              <SettingsTabPanel
                selectedTab={selectedTab}
                initialFocusTarget={initialFocusTarget}
              >
                <SelectedTabContent className="settings-page__copy" />
              </SettingsTabPanel>
            </AnimatePresence>
          </section>
        </div>
      </motion.section>
    </VerticalFocusGroup>
  );
}
