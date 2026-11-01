import "./downloads-behavior-section.scss";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOADS_BEHAVIOR_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import type { UserPreferences } from "@types";

interface DownloadsBehaviorSectionProps {
  className?: string;
  lastItemDownTarget?: FocusOverrideTarget;
}

interface DownloadsBehaviorForm {
  seedAfterDownloadComplete: boolean;
  showDownloadSpeedInMegabytes: boolean;
  extractFilesByDefault: boolean;
  deleteArchiveFilesAfterExtractionByDefault: boolean;
  extractInPlaceByDefault: boolean;
  createStartMenuShortcut: boolean;
}

interface DownloadsBehaviorItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: DownloadsBehaviorForm = {
  seedAfterDownloadComplete: false,
  showDownloadSpeedInMegabytes: false,
  extractFilesByDefault: true,
  deleteArchiveFilesAfterExtractionByDefault: true,
  extractInPlaceByDefault: true,
  createStartMenuShortcut: true,
};

const buildForm = (
  preferences: UserPreferences | null
): DownloadsBehaviorForm =>
  preferences
    ? {
        seedAfterDownloadComplete:
          preferences.seedAfterDownloadComplete ?? false,
        showDownloadSpeedInMegabytes:
          preferences.showDownloadSpeedInMegabytes ?? false,
        extractFilesByDefault: preferences.extractFilesByDefault ?? true,
        deleteArchiveFilesAfterExtractionByDefault:
          preferences.deleteArchiveFilesAfterExtractionByDefault ?? true,
        extractInPlaceByDefault: preferences.extractInPlaceByDefault ?? true,
        createStartMenuShortcut: preferences.createStartMenuShortcut ?? true,
      }
    : DEFAULT_FORM;

export function DownloadsBehaviorSection({
  className,
  lastItemDownTarget,
}: Readonly<DownloadsBehaviorSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<DownloadsBehaviorForm>(() =>
    buildForm(userPreferences)
  );

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const isWindows = globalThis.window.electron.platform === "win32";
  const isLinux = globalThis.window.electron.platform === "linux";

  const updateUserPreferences = async (
    values: Partial<DownloadsBehaviorForm>
  ) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);
  };

  const items = useMemo<DownloadsBehaviorItem[]>(() => {
    const baseItems: DownloadsBehaviorItem[] = [
      {
        id: "seed-after-download-complete",
        focusId: DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.seedAfterDownloadComplete,
        label: "Seed after download complete",
        checked: form.seedAfterDownloadComplete,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ seedAfterDownloadComplete: checked }),
      },
      {
        id: "extract-files-by-default",
        focusId: DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.extractFilesByDefault,
        label: "Extract files by default",
        checked: form.extractFilesByDefault,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ extractFilesByDefault: checked }),
      },
      {
        id: "show-download-speed-in-megabytes",
        focusId: DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.showDownloadSpeedInMegabytes,
        label: "Show download speed in megabytes",
        checked: form.showDownloadSpeedInMegabytes,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ showDownloadSpeedInMegabytes: checked }),
      },
      {
        id: "delete-archive-files-after-extraction-by-default",
        focusId:
          DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.deleteArchiveFilesAfterExtractionByDefault,
        label: "Delete archive files after extraction",
        checked: form.deleteArchiveFilesAfterExtractionByDefault,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            deleteArchiveFilesAfterExtractionByDefault: checked,
          }),
      },
      {
        id: "extract-in-place-by-default",
        focusId: DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.extractInPlaceByDefault,
        label: t("extract_in_place"),
        checked:
          form.deleteArchiveFilesAfterExtractionByDefault &&
          form.extractInPlaceByDefault,
        disabled: !form.deleteArchiveFilesAfterExtractionByDefault,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            extractInPlaceByDefault: checked,
          }),
      },
    ];

    if (isWindows || isLinux) {
      baseItems.push({
        id: "create-start-menu-shortcut",
        focusId: DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.createStartMenuShortcut,
        label: "Create shortcuts on download",
        checked: form.createStartMenuShortcut,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ createStartMenuShortcut: checked }),
      });
    }

    return baseItems;
  }, [form, isWindows, isLinux, t]);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    const enabledItems = items.filter((item) => !item.disabled);

    return Object.fromEntries(
      enabledItems.map((item, index) => {
        const previousItem = enabledItems[index - 1];
        const nextItem = enabledItems[index + 1];

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
              : lastItemDownTarget
                ? lastItemDownTarget
                : undefined,
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [items, lastItemDownTarget]);

  return (
    <SettingsSection
      title="Behavior"
      description="Control how downloads behave by default."
      className={className}
    >
      <VerticalFocusGroup
        regionId={DOWNLOADS_BEHAVIOR_SECTION_REGION_ID}
        asChild
      >
        <div className="downloads-behavior-section__content">
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
