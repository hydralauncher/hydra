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

interface BehaviorSectionProps {
  className?: string;
}

interface BehaviorForm {
  preferQuitInsteadOfHiding: boolean;
  runAtStartup: boolean;
  startMinimized: boolean;
  hideToTrayOnGameStart: boolean;
  launchToLibraryPage: boolean;
  launchInBigPicture: boolean;
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
  launchInBigPicture: false,
  enableAutoInstall: false,
};

export function BehaviorSection({ className }: Readonly<BehaviorSectionProps>) {
  const userPreferences = useUserPreferences();
  const [showRunAtStartup, setShowRunAtStartup] = useState(false);
  const [form, setForm] = useState<BehaviorForm>(DEFAULT_FORM);

  useEffect(() => {
    let isMounted = true;

    globalThis.window.electron
      .isPortableVersion()
      .then((isPortableVersion) => {
        if (!isMounted) return;

        setShowRunAtStartup(!isPortableVersion);
      })
      .catch(() => {
        if (!isMounted) return;

        setShowRunAtStartup(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      preferQuitInsteadOfHiding:
        userPreferences.preferQuitInsteadOfHiding ?? false,
      runAtStartup: userPreferences.runAtStartup ?? false,
      startMinimized: userPreferences.startMinimized ?? false,
      hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
      launchToLibraryPage: userPreferences.launchToLibraryPage ?? false,
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      enableAutoInstall: userPreferences.enableAutoInstall ?? false,
    });
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
        label: "Quit app instead of hiding",
        checked: form.preferQuitInsteadOfHiding,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ preferQuitInsteadOfHiding: checked }),
      },
      {
        id: "hide-to-tray-on-game-start",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.hideToTrayOnGameStart,
        label: "Hide to tray on game start",
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
              label: "Launch with system",
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
              label: "Launch minimized",
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
        label: "Launch Hydra in library page",
        checked: form.launchToLibraryPage,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ launchToLibraryPage: checked }),
      },
      {
        id: "launch-in-big-picture",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.launchInBigPicture,
        label: "Launch Hydra in Big Picture",
        checked: form.launchInBigPicture,
        disabled: false,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ launchInBigPicture: checked }),
      },
      ...(isLinux
        ? [
            {
              id: "enable-auto-install",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.enableAutoInstall,
              label: "Enable auto install",
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
