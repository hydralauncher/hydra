import "./big-picture.scss";

import type {
  BigPictureDiagnosticsPosition,
  HydraAudioDevice,
  HydraDisplay,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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

function getPositionLabel(
  position: BigPictureDiagnosticsPosition,
  t: (key: string) => string
) {
  return t(`settings_diagnostics_position_${position.replace(/-/g, "_")}`);
}

export function BigPictureSettingsSection({
  className,
}: Readonly<BigPictureSettingsSectionProps>) {
  const { t } = useTranslation("big_picture");
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
      setForm((current) => ({ ...current, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleBigPictureDisplayChange = useCallback(
    async (displayId: string) => {
      setForm((current) => ({
        ...current,
        bigPictureDisplayId: displayId,
      }));

      await globalThis.window.electron.updateUserPreferences({
        bigPictureDisplayId:
          displayId === DEFAULT_BIG_PICTURE_DISPLAY_ID ? null : displayId,
      });
    },
    []
  );

  const handleBigPictureAudioDeviceChange = useCallback(
    async (audioDeviceId: string) => {
      setForm((current) => ({
        ...current,
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

  const handleLaunchInBigPictureChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ launchInBigPicture: checked });
    },
    [updateUserPreferences]
  );

  const handleBigPictureSoundsChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureSoundsEnabled: checked });
    },
    [updateUserPreferences]
  );

  const handleVirtualKeyboardChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureVirtualKeyboardEnabled: checked });
    },
    [updateUserPreferences]
  );

  const handleDiagnosticsEnabledChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ bigPictureDiagnosticsEnabled: checked });
    },
    [updateUserPreferences]
  );

  const handleDiagnosticsPositionChange = useCallback(
    (position: BigPictureDiagnosticsPosition) => {
      updateUserPreferences({ bigPictureDiagnosticsPosition: position });
    },
    [updateUserPreferences]
  );

  const startupItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "launch-in-big-picture",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
        label: t("settings_launch_in_big_picture"),
        checked: form.launchInBigPicture,
        onChange: handleLaunchInBigPictureChange,
      },
    ];
  }, [form.launchInBigPicture, handleLaunchInBigPictureChange, t]);

  const inputItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-virtual-keyboard",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
        label: t("settings_enable_virtual_keyboard"),
        checked: form.bigPictureVirtualKeyboardEnabled,
        onChange: handleVirtualKeyboardChange,
      },
    ];
  }, [form.bigPictureVirtualKeyboardEnabled, handleVirtualKeyboardChange, t]);

  const audioItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-big-picture-sounds",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
        label: t("settings_enable_big_picture_sounds"),
        checked: form.bigPictureSoundsEnabled,
        onChange: handleBigPictureSoundsChange,
      },
    ];
  }, [form.bigPictureSoundsEnabled, handleBigPictureSoundsChange, t]);

  const diagnosticsItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "enable-diagnostics",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableDiagnostics,
        label: t("settings_enable_diagnostics"),
        checked: form.bigPictureDiagnosticsEnabled,
        onChange: handleDiagnosticsEnabledChange,
      },
    ];
  }, [form.bigPictureDiagnosticsEnabled, handleDiagnosticsEnabledChange, t]);

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
      label: getPositionLabel(position, t),
    }));
  }, [t]);

  const displayOptions = useMemo<Array<DropdownSelectOption<string>>>(() => {
    const selectedDisplayMissing =
      form.bigPictureDisplayId !== DEFAULT_BIG_PICTURE_DISPLAY_ID &&
      displays.every((display) => display.id !== form.bigPictureDisplayId);

    return [
      {
        value: DEFAULT_BIG_PICTURE_DISPLAY_ID,
        label: t("settings_system_default_monitor"),
      },
      ...displays.map((display) => ({
        value: display.id,
        label: display.isPrimary
          ? `${display.label} (${t("settings_primary_monitor")})`
          : display.label,
      })),
      ...(selectedDisplayMissing
        ? [
            {
              value: form.bigPictureDisplayId,
              label: `${t("settings_missing_monitor")} (${form.bigPictureDisplayId})`,
            },
          ]
        : []),
    ];
  }, [displays, form.bigPictureDisplayId, t]);

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
        label: t("settings_system_default_audio_device"),
      },
      ...audioDevices.map((device) => ({
        value: device.id,
        label: device.isDefault
          ? `${device.label} (${t("settings_default_audio_device")})`
          : device.label,
      })),
      ...(selectedAudioDeviceMissing
        ? [
            {
              value: form.bigPictureAudioDeviceId,
              label: `${t("settings_missing_audio_device")} (${form.bigPictureAudioDeviceId})`,
            },
          ]
        : []),
    ];
  }, [audioDevices, form.bigPictureAudioDeviceId, t]);

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
            down: (() => {
              if (nextItem) {
                return { type: "item" as const, itemId: nextItem.focusId };
              }
              if (form.bigPictureDiagnosticsEnabled) {
                return {
                  type: "item" as const,
                  itemId: BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
                };
              }
              return { type: "block" as const };
            })(),
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
        title={t("settings_startup_section_title")}
        description={t("settings_startup_section_description")}
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
              label={t("settings_big_picture_launching_monitor")}
              value={form.bigPictureDisplayId}
              options={displayOptions}
              focusId={BIG_PICTURE_LAUNCHING_MONITOR_SELECT_ID}
              focusNavigationOverrides={displaySelectNavigationOverrides}
              onValueChange={handleBigPictureDisplayChange}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings_audio_section_title")}
        description={t("settings_audio_section_description")}
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
              label={t("settings_big_picture_output_device")}
              value={form.bigPictureAudioDeviceId}
              options={audioDeviceOptions}
              focusId={BIG_PICTURE_OUTPUT_DEVICE_SELECT_ID}
              focusNavigationOverrides={audioDeviceSelectNavigationOverrides}
              onValueChange={handleBigPictureAudioDeviceChange}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title={t("settings_input_section_title")}
        description={t("settings_input_section_description")}
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
        title={t("settings_diagnostics_section_title")}
        description={t("settings_diagnostics_section_description")}
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
              label={t("settings_diagnostics_position")}
              value={form.bigPictureDiagnosticsPosition}
              options={diagnosticsPositionOptions}
              disabled={!form.bigPictureDiagnosticsEnabled}
              focusId={BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID}
              focusNavigationOverrides={diagnosticsSelectNavigationOverrides}
              onValueChange={handleDiagnosticsPositionChange}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>
    </div>
  );
}
