import "./downloads-behavior-section.scss";

import { useEffect, useMemo, useState } from "react";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOADS_BEHAVIOR_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface DownloadsBehaviorSectionProps {
  className?: string;
  lastItemDownTarget?: FocusOverrideTarget;
}

interface DownloadsBehaviorForm {
  seedAfterDownloadComplete: boolean;
  showDownloadSpeedInMegabytes: boolean;
  extractFilesByDefault: boolean;
  deleteArchiveFilesAfterExtractionByDefault: boolean;
  createStartMenuShortcut: boolean;
}

interface DownloadsBehaviorItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: DownloadsBehaviorForm = {
  seedAfterDownloadComplete: false,
  showDownloadSpeedInMegabytes: false,
  extractFilesByDefault: true,
  deleteArchiveFilesAfterExtractionByDefault: false,
  createStartMenuShortcut: true,
};

export function DownloadsBehaviorSection({
  className,
  lastItemDownTarget,
}: Readonly<DownloadsBehaviorSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<DownloadsBehaviorForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      seedAfterDownloadComplete:
        userPreferences.seedAfterDownloadComplete ?? false,
      showDownloadSpeedInMegabytes:
        userPreferences.showDownloadSpeedInMegabytes ?? false,
      extractFilesByDefault: userPreferences.extractFilesByDefault ?? true,
      deleteArchiveFilesAfterExtractionByDefault:
        userPreferences.deleteArchiveFilesAfterExtractionByDefault ?? false,
      createStartMenuShortcut: userPreferences.createStartMenuShortcut ?? true,
    });
  }, [userPreferences]);

  const isWindows = globalThis.window.electron.platform === "win32";

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
    ];

    if (isWindows) {
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
  }, [form, isWindows]);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      items.map((item, index) => {
        const previousItem = items[index - 1];
        const nextItem = items[index + 1];

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
