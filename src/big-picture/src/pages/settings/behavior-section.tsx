import "./behavior-section.scss";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Checkbox,
  DropdownSelect,
  type DropdownSelectOption,
  VerticalFocusGroup,
} from "../../components";
import type { FocusOverrides } from "../../services";
import { useUserPreferences } from "../../hooks";
import type { HydraAudioDevice, HydraDisplay } from "@types";
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
  bigPictureDisplayId: string;
  bigPictureAudioDeviceId: string;
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
  bigPictureDisplayId: "default",
  bigPictureAudioDeviceId: "default",
  enableAutoInstall: false,
};

const DEFAULT_BIG_PICTURE_DISPLAY_ID = "default";
const DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID = "default";

export function BehaviorSection({ className }: Readonly<BehaviorSectionProps>) {
  const userPreferences = useUserPreferences();
  const [showRunAtStartup, setShowRunAtStartup] = useState(false);
  const [form, setForm] = useState<BehaviorForm>(DEFAULT_FORM);
  const [displays, setDisplays] = useState<HydraDisplay[]>([]);
  const [audioDevices, setAudioDevices] = useState<HydraAudioDevice[]>([]);

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

    globalThis.window.electron
      .getDisplays()
      .then((nextDisplays) => {
        if (!isMounted) return;

        setDisplays(nextDisplays);
      })
      .catch(() => {
        if (!isMounted) return;

        setDisplays([]);
      });

    globalThis.window.electron
      .getAudioDevices()
      .then((nextAudioDevices) => {
        if (!isMounted) return;

        setAudioDevices(nextAudioDevices);
      })
      .catch(() => {
        if (!isMounted) return;

        setAudioDevices([]);
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
      bigPictureDisplayId:
        userPreferences.bigPictureDisplayId ?? DEFAULT_BIG_PICTURE_DISPLAY_ID,
      bigPictureAudioDeviceId:
        userPreferences.bigPictureAudioDeviceId ??
        DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID,
      enableAutoInstall: userPreferences.enableAutoInstall ?? false,
    });
  }, [userPreferences]);

  const isLinux = globalThis.window.electron.platform === "linux";

  const updateUserPreferences = useCallback(
    async (
      values: Partial<BehaviorForm>,
      autoLaunchOptions?: { enabled: boolean; minimized: boolean }
    ) => {
      setForm((prev) => ({ ...prev, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);

      if (autoLaunchOptions) {
        globalThis.window.electron.autoLaunch(autoLaunchOptions);
      }
    },
    []
  );

  const updateBigPictureDisplay = async (displayId: string) => {
    setForm((prev) => ({ ...prev, bigPictureDisplayId: displayId }));

    await globalThis.window.electron.updateUserPreferences({
      bigPictureDisplayId:
        displayId === DEFAULT_BIG_PICTURE_DISPLAY_ID ? null : displayId,
    });
  };

  const updateBigPictureAudioDevice = async (audioDeviceId: string) => {
    setForm((prev) => ({ ...prev, bigPictureAudioDeviceId: audioDeviceId }));

    await globalThis.window.electron.updateUserPreferences({
      bigPictureAudioDeviceId:
        audioDeviceId === DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID
          ? null
          : audioDeviceId,
    });
  };

  const items = useMemo<BehaviorItem[]>(() => {
    const baseItems: BehaviorItem[] = [
      {
        id: "prefer-quit-instead-of-hiding",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.preferQuitInsteadOfHiding,
        label: "Quit app instead of hiding",
        checked: form.preferQuitInsteadOfHiding,
        disabled: false,
        onChange: async (checked: boolean) => {
          await updateUserPreferences({ preferQuitInsteadOfHiding: checked });
        },
      },
      {
        id: "hide-to-tray-on-game-start",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.hideToTrayOnGameStart,
        label: "Hide to tray on game start",
        checked: form.hideToTrayOnGameStart,
        disabled: false,
        onChange: async (checked: boolean) => {
          await updateUserPreferences({ hideToTrayOnGameStart: checked });
        },
      },
      ...(showRunAtStartup
        ? [
            {
              id: "launch-with-system",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.runAtStartup,
              label: "Launch with system",
              checked: form.runAtStartup,
              disabled: false,
              onChange: async (checked: boolean) => {
                await updateUserPreferences(
                  { runAtStartup: checked },
                  {
                    enabled: checked,
                    minimized: form.startMinimized,
                  }
                );
              },
            },
            {
              id: "launch-minimized",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.startMinimized,
              label: "Launch minimized",
              checked: form.runAtStartup && form.startMinimized,
              disabled: !form.runAtStartup,
              onChange: async (checked: boolean) => {
                await updateUserPreferences(
                  { startMinimized: checked },
                  {
                    enabled: form.runAtStartup,
                    minimized: checked,
                  }
                );
              },
            },
          ]
        : []),
      {
        id: "launch-to-library-page",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.launchToLibraryPage,
        label: "Launch Hydra in library page",
        checked: form.launchToLibraryPage,
        disabled: false,
        onChange: async (checked: boolean) => {
          await updateUserPreferences({ launchToLibraryPage: checked });
        },
      },
      {
        id: "launch-in-big-picture",
        focusId: BEHAVIOR_ITEM_FOCUS_IDS.launchInBigPicture,
        label: "Launch Hydra in Big Picture",
        checked: form.launchInBigPicture,
        disabled: false,
        onChange: async (checked: boolean) => {
          await updateUserPreferences({ launchInBigPicture: checked });
        },
      },
      ...(isLinux
        ? [
            {
              id: "enable-auto-install",
              focusId: BEHAVIOR_ITEM_FOCUS_IDS.enableAutoInstall,
              label: "Enable auto install",
              checked: form.enableAutoInstall,
              disabled: false,
              onChange: async (checked: boolean) => {
                await updateUserPreferences({ enableAutoInstall: checked });
              },
            },
          ]
        : []),
    ];

    return baseItems;
  }, [form, isLinux, showRunAtStartup, updateUserPreferences]);

  const displayOptions = useMemo<Array<DropdownSelectOption<string>>>(() => {
    const selectedDisplayMissing =
      form.bigPictureDisplayId !== DEFAULT_BIG_PICTURE_DISPLAY_ID &&
      displays.every((display) => display.id !== form.bigPictureDisplayId);

    return [
      {
        value: DEFAULT_BIG_PICTURE_DISPLAY_ID,
        label: "System default monitor",
      },
      ...displays.map((display) => ({
        value: display.id,
        label: display.isPrimary ? `${display.label} (Primary)` : display.label,
      })),
      ...(selectedDisplayMissing
        ? [
            {
              value: form.bigPictureDisplayId,
              label: `Missing display (${form.bigPictureDisplayId})`,
            },
          ]
        : []),
    ];
  }, [displays, form.bigPictureDisplayId]);

  const audioDeviceOptions = useMemo<
    Array<DropdownSelectOption<string>>
  >(() => {
    const selectedAudioDeviceMissing =
      form.bigPictureAudioDeviceId !== DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID &&
      audioDevices.every(
        (device) => device.id !== form.bigPictureAudioDeviceId
      );

    return [
      {
        value: DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID,
        label: "System default audio device",
      },
      ...audioDevices.map((device) => ({
        value: device.id,
        label: device.isDefault ? `${device.label} (Default)` : device.label,
      })),
      ...(selectedAudioDeviceMissing
        ? [
            {
              value: form.bigPictureAudioDeviceId,
              label: `Missing audio device (${form.bigPictureAudioDeviceId})`,
            },
          ]
        : []),
    ];
  }, [audioDevices, form.bigPictureAudioDeviceId]);

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
                  type: "item",
                  itemId: BEHAVIOR_ITEM_FOCUS_IDS.bigPictureDisplay,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [items]);

  const displayNavigationOverrides = useMemo<FocusOverrides>(() => {
    const focusableItems = items.filter((item) => !item.disabled);
    const previousItem = focusableItems[focusableItems.length - 1];

    return {
      up: previousItem
        ? {
            type: "item",
            itemId: previousItem.focusId,
          }
        : {
            type: "item",
            itemId: LANGUAGE_SECTION_BUTTON_ID,
          },
      down: {
        type: "item",
        itemId: BEHAVIOR_ITEM_FOCUS_IDS.bigPictureAudioDevice,
      },
    };
  }, [items]);

  const audioDeviceNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BEHAVIOR_ITEM_FOCUS_IDS.bigPictureDisplay,
      },
      down: {
        type: "block",
      },
    }),
    []
  );

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

          <DropdownSelect
            label="Big Picture launching monitor"
            value={form.bigPictureDisplayId}
            options={displayOptions}
            focusId={BEHAVIOR_ITEM_FOCUS_IDS.bigPictureDisplay}
            focusNavigationOverrides={displayNavigationOverrides}
            onValueChange={async (displayId) => {
              await updateBigPictureDisplay(displayId);
            }}
          />

          <DropdownSelect
            label="Big Picture output device"
            value={form.bigPictureAudioDeviceId}
            options={audioDeviceOptions}
            focusId={BEHAVIOR_ITEM_FOCUS_IDS.bigPictureAudioDevice}
            focusNavigationOverrides={audioDeviceNavigationOverrides}
            onValueChange={async (audioDeviceId) => {
              await updateBigPictureAudioDevice(audioDeviceId);
            }}
          />
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
