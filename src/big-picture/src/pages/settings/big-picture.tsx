import "./big-picture.scss";

import type { BigPictureDiagnosticsPosition } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, DropdownSelect, VerticalFocusGroup } from "../../components";
import type { DropdownSelectOption } from "../../components/common/dropdown-select";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  BIG_PICTURE_AUDIO_SECTION_REGION_ID,
  BIG_PICTURE_BEHAVIOR_SECTION_REGION_ID,
  BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
  BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  BIG_PICTURE_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface BigPictureSettingsSectionProps {
  className?: string;
}

interface BigPictureForm {
  launchInBigPicture: boolean;
  bigPictureSoundsEnabled: boolean;
  bigPictureVirtualKeyboardEnabled: boolean;
  bigPictureDiagnosticsEnabled: boolean;
  bigPictureDiagnosticsPosition: BigPictureDiagnosticsPosition;
  restoreBigPictureFocusOnGameClose: boolean;
}

interface BigPictureItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  secondaryText?: string;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: BigPictureForm = {
  launchInBigPicture: false,
  bigPictureSoundsEnabled: true,
  bigPictureVirtualKeyboardEnabled: true,
  bigPictureDiagnosticsEnabled: false,
  bigPictureDiagnosticsPosition: "bottom-center",
  restoreBigPictureFocusOnGameClose: true,
};

function getPositionLabel(
  position: BigPictureDiagnosticsPosition,
  t: (key: string) => string
) {
  return t(`settings_diagnostics_position_${position.replaceAll("-", "_")}`);
}

export function BigPictureSettingsSection({
  className,
}: Readonly<BigPictureSettingsSectionProps>) {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const isWayland = globalThis.window.electron.isWayland;
  const [form, setForm] = useState<BigPictureForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      bigPictureSoundsEnabled: userPreferences.bigPictureSoundsEnabled ?? true,
      bigPictureVirtualKeyboardEnabled:
        userPreferences.bigPictureVirtualKeyboardEnabled ?? true,
      bigPictureDiagnosticsEnabled:
        userPreferences.bigPictureDiagnosticsEnabled ?? false,
      bigPictureDiagnosticsPosition:
        userPreferences.bigPictureDiagnosticsPosition ?? "bottom-center",
      restoreBigPictureFocusOnGameClose:
        userPreferences.restoreBigPictureFocusOnGameClose ?? true,
    });
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<BigPictureForm>) => {
      setForm((current) => ({ ...current, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
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

  const handleRestoreFocusOnGameCloseChange = useCallback(
    (checked: boolean) => {
      updateUserPreferences({ restoreBigPictureFocusOnGameClose: checked });
    },
    [updateUserPreferences]
  );

  const handleDiagnosticsPositionChange = useCallback(
    (position: BigPictureDiagnosticsPosition) => {
      updateUserPreferences({ bigPictureDiagnosticsPosition: position });
    },
    [updateUserPreferences]
  );

  const behaviorItems = useMemo<BigPictureItem[]>(() => {
    return [
      {
        id: "launch-in-big-picture",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
        label: t("settings_launch_in_big_picture"),
        checked: form.launchInBigPicture,
        onChange: handleLaunchInBigPictureChange,
      },
      {
        id: "restore-focus-on-game-close",
        focusId: BIG_PICTURE_ITEM_FOCUS_IDS.restoreFocusOnGameClose,
        label: t("settings_restore_big_picture_focus_on_game_close"),
        checked: form.restoreBigPictureFocusOnGameClose,
        secondaryText: isWayland
          ? t("settings_restore_big_picture_focus_wayland_hint")
          : undefined,
        onChange: handleRestoreFocusOnGameCloseChange,
      },
    ];
  }, [
    form.launchInBigPicture,
    form.restoreBigPictureFocusOnGameClose,
    handleLaunchInBigPictureChange,
    handleRestoreFocusOnGameCloseChange,
    isWayland,
    t,
  ]);

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

  const inputNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const previousFallback: FocusOverrideTarget = {
      type: "item",
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
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
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.restoreFocusOnGameClose,
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
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [audioItems]);

  const behaviorNavigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      behaviorItems.map((item, index) => {
        const previousItem = behaviorItems[index - 1];
        const nextItem = behaviorItems[index + 1];

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
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [behaviorItems]);

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
        title={t("settings_behavior_section_title")}
        description={t("settings_behavior_section_description")}
      >
        <VerticalFocusGroup
          regionId={BIG_PICTURE_BEHAVIOR_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            {behaviorItems.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                disabled={item.disabled}
                secondaryText={item.secondaryText}
                focusId={item.focusId}
                navigationOverrides={
                  behaviorNavigationOverridesByFocusId[item.focusId]
                }
                block
                onChange={item.onChange}
              />
            ))}
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
