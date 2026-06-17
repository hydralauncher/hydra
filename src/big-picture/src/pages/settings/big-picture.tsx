import "./big-picture.scss";

import type { BigPictureDiagnosticsPosition } from "@types";
import { useEffect, useMemo, useState } from "react";

import { Checkbox, DropdownSelect, VerticalFocusGroup } from "../../components";
import type { DropdownSelectOption } from "../../components/common/dropdown-select";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  BIG_PICTURE_AUDIO_SECTION_REGION_ID,
  BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
  BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
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
  bigPictureSoundsEnabled: true,
  bigPictureVirtualKeyboardEnabled: true,
  bigPictureDiagnosticsEnabled: false,
  bigPictureDiagnosticsPosition: "bottom-center",
};

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
    });
  }, [userPreferences]);

  const updateUserPreferences = async (values: Partial<BigPictureForm>) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);
  };

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
  }, [form.launchInBigPicture]);

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
  }, [form.bigPictureVirtualKeyboardEnabled]);

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
  }, [form.bigPictureSoundsEnabled]);

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
  }, [form.bigPictureDiagnosticsEnabled]);

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
      itemId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
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
                  itemId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
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
