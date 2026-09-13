import "./behavior-section.scss";

import { useEffect, useMemo, useState } from "react";

import { Checkbox, VerticalFocusGroup } from "../../components";
import type { FocusOverrides } from "../../services";
import { useUserPreferences } from "../../hooks";
import {
  BEHAVIOR_ITEM_FOCUS_IDS,
  BEHAVIOR_SECTION_REGION_ID,
  LANGUAGE_SECTION_BUTTON_ID,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import type { UserPreferences } from "@types";

interface BehaviorSectionProps {
  className?: string;
}

interface BehaviorForm {
  preferQuitInsteadOfHiding: boolean;
  runAtStartup: boolean;
  startMinimized: boolean;
  hideToTrayOnGameStart: boolean;
  launchToLibraryPage: boolean;
  enableAutoInstall: boolean;
}

interface BehaviorItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: BehaviorForm = {
  preferQuitInsteadOfHiding: false,
  runAtStartup: false,
  startMinimized: false,
  hideToTrayOnGameStart: false,
  launchToLibraryPage: false,
  enableAutoInstall: false,
};

const buildForm = (preferences: UserPreferences | null): BehaviorForm =>
  preferences
    ? {
        preferQuitInsteadOfHiding:
          preferences.preferQuitInsteadOfHiding ?? false,
        runAtStartup: preferences.runAtStartup ?? false,
        startMinimized: preferences.startMinimized ?? false,
        hideToTrayOnGameStart: preferences.hideToTrayOnGameStart ?? false,
        launchToLibraryPage: preferences.launchToLibraryPage ?? false,
        enableAutoInstall: preferences.enableAutoInstall ?? false,
      }
    : DEFAULT_FORM;

export function BehaviorSection({ className }: Readonly<BehaviorSectionProps>) {
  const userPreferences = useUserPreferences();
  const showRunAtStartup = !globalThis.window.electron.isPortableVersion;
  const [form, setForm] = useState<BehaviorForm>(() =>
    buildForm(userPreferences)
  );

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const isLinux = globalThis.window.electron.platform === "linux";

  const updateUserPreferences = async (
    values: Partial<BehaviorForm>,
    autoLaunchOptions?: { enabled: boolean; minimized: boolean }
  ) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);

    if (autoLaunchOptions) {
      globalThis.window.electron.autoLaunch(autoLaunchOptions);
    }
  };

  const items = useMemo<BehaviorItem[]>(() => {
    const baseItems: BehaviorItem[] = [
      {
        id: "prefer-quit-instead-of-hiding",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.preferQuitInsteadOfHiding,
        label: "Don't hide Hydra when closing",
        checked: form.preferQuitInsteadOfHiding,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ preferQuitInsteadOfHiding: checked }),
      },
      {
        id: "hide-to-tray-on-game-start",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.hideToTrayOnGameStart,
        label: "Hide Hydra to tray on game startup",
        checked: form.hideToTrayOnGameStart,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ hideToTrayOnGameStart: checked }),
      },
      ...(showRunAtStartup
        ? [
            {
              id: "launch-with-system",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.runAtStartup,
              label: "Launch Hydra on system start-up",
              checked: form.runAtStartup,
              disabled: false,
              onChange: (checked: boolean) =>
                void updateUserPreferences(
                  { runAtStartup: checked },
                  {
                    enabled: checked,
                    minimized: form.startMinimized,
                  }
                ),
            },
            {
              id: "launch-minimized",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.startMinimized,
              label: "Launch Hydra minimized",
              checked: form.runAtStartup && form.startMinimized,
              disabled: !form.runAtStartup,
              onChange: (checked: boolean) =>
                void updateUserPreferences(
                  { startMinimized: checked },
                  {
                    enabled: form.runAtStartup,
                    minimized: checked,
                  }
                ),
            },
          ]
        : []),
      {
        id: "launch-to-library-page",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.launchToLibraryPage,
        label: "Launch Hydra in the Library page",
        checked: form.launchToLibraryPage,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ launchToLibraryPage: checked }),
      },
      ...(isLinux
        ? [
            {
              id: "enable-auto-install",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.enableAutoInstall,
              label: "Download updates automatically",
              checked: form.enableAutoInstall,
              disabled: false,
              onChange: (checked: boolean) =>
                void updateUserPreferences({ enableAutoInstall: checked }),
            },
          ]
        : []),
    ];

    return baseItems;
  }, [form, isLinux, showRunAtStartup]);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const focusableItems = items.filter((item) => !item.disabled);

    return Object.fromEntries(
      focusableItems.map((item, index) => {
        const previousItem = focusableItems[index - 1];
        const nextItem = focusableItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : {
                  type: "item",
                  itemId: LANGUAGE_SECTION_BUTTON_ID,
                },
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [items]);

  return (
    <SettingsSection
      title="Behavior"
      description="Quality of Life stuff to make your experience better."
      className={className}
    >
      <VerticalFocusGroup regionId={BEHAVIOR_SECTION_REGION_ID} asChild>
        <div className="behavior-section__content">
          {items.map((item) => (
            <Checkbox
              key={item.id}
              id={item.id}
              label={item.label}
              checked={item.checked}
              disabled={item.disabled}
              focusId={item.focusId}
              navigationOverrides={navigationOverridesByFocusId[item.focusId]}
              block
              onChange={item.onChange}
            />
          ))}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
