import "./big-picture.scss";

import type {
  BigPictureDiagnosticsPosition,
  HydraAudioDevice,
  HydraDisplay,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Checkbox, DropdownSelect, VerticalFocusGroup } from "../../components";
import type { DropdownSelectOption } from "../../components/common/dropdown-select";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  BIG_PICTURE_AUDIO_SECTION_REGION_ID,
  BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
  BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  BIG_PICTURE_LAUNCHING_MONITOR_SELECT_ID,
  BIG_PICTURE_OUTPUT_DEVICE_SELECT_ID,
  BIG_PICTURE_SECTION_REGION_ID,
  BIG_PICTURE_STARTUP_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface BigPictureSettingsSectionProps {
  className?: string;
}

interface BigPictureForm {
  launchInBigPicture: boolean;
  bigPictureDisplayId: string;
  bigPictureAudioDeviceId: string;
  bigPictureSoundsEnabled: boolean;
  bigPictureVirtualKeyboardEnabled: boolean;
  bigPictureDiagnosticsEnabled: boolean;
  bigPictureDiagnosticsPosition: BigPictureDiagnosticsPosition;
}

interface BigPictureItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: BigPictureForm = {
  launchInBigPicture: false,
  bigPictureDisplayId: "default",
  bigPictureAudioDeviceId: "default",
  bigPictureSoundsEnabled: true,
  bigPictureVirtualKeyboardEnabled: true,
  bigPictureDiagnosticsEnabled: false,
  bigPictureDiagnosticsPosition: "bottom-center",
};

const DEFAULT_BIG_PICTURE_DISPLAY_ID = "default";
const DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID = "default";

function getPositionLabel(position: BigPictureDiagnosticsPosition) {
  return position
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function BigPictureSettingsSection({
  className,
}: Readonly<BigPictureSettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<BigPictureForm>(DEFAULT_FORM);
  const [displays, setDisplays] = useState<HydraDisplay[]>([]);
  const [audioDevices, setAudioDevices] = useState<HydraAudioDevice[]>([]);

  useEffect(() => {
    let isMounted = true;

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
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      bigPictureDisplayId:
        userPreferences.bigPictureDisplayId ?? DEFAULT_BIG_PICTURE_DISPLAY_ID,
      bigPictureAudioDeviceId:
        userPreferences.bigPictureAudioDeviceId ??
        DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID,
      bigPictureSoundsEnabled: userPreferences.bigPictureSoundsEnabled ?? true,
      bigPictureVirtualKeyboardEnabled:
        userPreferences.bigPictureVirtualKeyboardEnabled ?? true,
      bigPictureDiagnosticsEnabled:
        userPreferences.bigPictureDiagnosticsEnabled ?? false,
      bigPictureDiagnosticsPosition:
        userPreferences.bigPictureDiagnosticsPosition ?? "bottom-center",
    });
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<BigPictureForm>) => {
      setForm((currentForm) => ({ ...currentForm, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const updateBigPictureDisplay = useCallback(async (displayId: string) => {
    setForm((currentForm) => ({
      ...currentForm,
      bigPictureDisplayId: displayId,
    }));

    await globalThis.window.electron.updateUserPreferences({
      bigPictureDisplayId:
        displayId === DEFAULT_BIG_PICTURE_DISPLAY_ID ? null : displayId,
    });
  }, []);

  const updateBigPictureAudioDevice = useCallback(
    async (audioDeviceId: string) => {
      setForm((currentForm) => ({
        ...currentForm,
        bigPictureAudioDeviceId: audioDeviceId,
      }));

      await globalThis.window.electron.updateUserPreferences({
        bigPictureAudioDeviceId:
          audioDeviceId === DEFAULT_BIG_PICTURE_AUDIO_DEVICE_ID
            ? null
            : audioDeviceId,
      });
    },
    []
  );

  const startupItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "launch-in-big-picture",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
        label: "Launch Hydra in Big Picture",
        checked: form.launchInBigPicture,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            launchInBigPicture: checked,
          }),
      },
    ];
  }, [form.launchInBigPicture, updateUserPreferences]);

  const inputItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-virtual-keyboard",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
        label: "Enable virtual keyboard",
        checked: form.bigPictureVirtualKeyboardEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            bigPictureVirtualKeyboardEnabled: checked,
          }),
      },
    ];
  }, [form.bigPictureVirtualKeyboardEnabled, updateUserPreferences]);

  const audioItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-big-picture-sounds",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
        label: "Enable Big Picture sounds",
        checked: form.bigPictureSoundsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            bigPictureSoundsEnabled: checked,
          }),
      },
    ];
  }, [form.bigPictureSoundsEnabled, updateUserPreferences]);

  const diagnosticsItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-diagnostics",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableDiagnostics,
        label: "Enable diagnostics",
        checked: form.bigPictureDiagnosticsEnabled,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            bigPictureDiagnosticsEnabled: checked,
          }),
      },
    ];
  }, [form.bigPictureDiagnosticsEnabled, updateUserPreferences]);

  const diagnosticsPositionOptions = useMemo<
    Array<DropdownSelectOption<BigPictureDiagnosticsPosition>>
  >(() => {
    return (
      [
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ] as BigPictureDiagnosticsPosition[]
    ).map((position) => ({
      value: position,
      label: getPositionLabel(position),
    }));
  }, []);

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

  const inputNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_OUTPUT_DEVICE_SELECT_ID,
    };

    return Object.fromEntries(
      inputItems.map((item, index) => {
        const previousItem = inputItems[index - 1];
        const nextItem = inputItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableDiagnostics,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [inputItems]);

  const audioNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_LAUNCHING_MONITOR_SELECT_ID,
    };

    return Object.fromEntries(
      audioItems.map((item, index) => {
        const previousItem = audioItems[index - 1];
        const nextItem = audioItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_OUTPUT_DEVICE_SELECT_ID,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [audioItems]);

  const startupNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      startupItems.map((item, index) => {
        const previousItem = startupItems[index - 1];
        const nextItem = startupItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : {
                  type: "item",
                  itemId: BIG_PICTURE_LAUNCHING_MONITOR_SELECT_ID,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [startupItems]);

  const diagnosticsNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
    };

    return Object.fromEntries(
      diagnosticsItems.map((item, index) => {
        const previousItem = diagnosticsItems[index - 1];
        const nextItem = diagnosticsItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : previousFallback,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : form.bigPictureDiagnosticsEnabled
                ? {
                    type: "item",
                    itemId: BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
                  }
                : {
                    type: "block",
                  },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [diagnosticsItems, form.bigPictureDiagnosticsEnabled]);

  const displaySelectNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
      },
      down: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
      },
    }),
    []
  );

  const audioDeviceSelectNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
      },
      down: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
      },
    }),
    []
  );

  const diagnosticsSelectNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableDiagnostics,
      },
      down: {
        type: "block",
      },
    }),
    []
  );

  return (
    <div
      className={
        className
          ? `big-picture-settings-section ${className}`
          : "big-picture-settings-section"
      }
    >
      <SettingsSection
        title="Startup"
        description="Choose how Hydra should start when Big Picture mode is available."
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_STARTUP_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {startupItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  startupNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}

            <DropdownSelect
              className="big-picture-settings-section__select"
              label="Big Picture launching monitor"
              value={form.bigPictureDisplayId}
              options={displayOptions}
              focusId={BIG_PICTURE_LAUNCHING_MONITOR_SELECT_ID}
              focusNavigationOverrides={displaySelectNavigationOverrides}
              onValueChange={async (displayId) => {
                await updateBigPictureDisplay(displayId);
              }}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title="Audio"
        description="Choose whether Big Picture should play navigation sounds."
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_AUDIO_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {audioItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  audioNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}

            <DropdownSelect
              className="big-picture-settings-section__select"
              label="Big Picture output device"
              value={form.bigPictureAudioDeviceId}
              options={audioDeviceOptions}
              focusId={BIG_PICTURE_OUTPUT_DEVICE_SELECT_ID}
              focusNavigationOverrides={audioDeviceSelectNavigationOverrides}
              onValueChange={async (audioDeviceId) => {
                await updateBigPictureAudioDevice(audioDeviceId);
              }}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title="Input"
        description="Choose how Big Picture should handle on-screen keyboard input."
      >
        <VerticalFocusGroup regionId={BIG_PICTURE_SECTION_REGION_ID} asChild>
          <div className="big-picture-settings-section__content">
            {inputItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  inputNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title="Diagnostics"
        description="Choose whether Big Picture should expose navigation diagnostics."
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {diagnosticsItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                focusId={item.focusId}
                navigationOverrides={
                  diagnosticsNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}

            <DropdownSelect
              className="big-picture-settings-section__select"
              label="Diagnostics position"
              value={form.bigPictureDiagnosticsPosition}
              options={diagnosticsPositionOptions}
              disabled={!form.bigPictureDiagnosticsEnabled}
              focusId={BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID}
              focusNavigationOverrides={diagnosticsSelectNavigationOverrides}
              onValueChange={(value) => {
                void updateUserPreferences({
                  bigPictureDiagnosticsPosition: value,
                });
              }}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>
    </div>
  );
}
