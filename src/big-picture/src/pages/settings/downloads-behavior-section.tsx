import "./downloads-behavior-section.scss";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Checkbox,
  DropdownSelect,
  Input,
  VerticalFocusGroup,
} from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS,
  DOWNLOADS_BEHAVIOR_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import type { UserPreferences } from "@types";
import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS,
  MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS,
} from "@shared";

interface DownloadsBehaviorSectionProps {
  className?: string;
  lastItemDownTarget?: FocusOverrideTarget;
}

interface DownloadsBehaviorForm {
  maxConcurrentDownloads: number;
  maxDownloadSpeedMegabytes: string;
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
  maxConcurrentDownloads: DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  maxDownloadSpeedMegabytes: "",
  seedAfterDownloadComplete: false,
  showDownloadSpeedInMegabytes: false,
  extractFilesByDefault: true,
  deleteArchiveFilesAfterExtractionByDefault: false,
  createStartMenuShortcut: true,
};

const buildForm = (
  preferences: UserPreferences | null
): DownloadsBehaviorForm =>
  preferences
    ? {
        maxConcurrentDownloads:
          Number.isInteger(preferences.maxConcurrentDownloads) &&
          preferences.maxConcurrentDownloads! >=
            MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS &&
          preferences.maxConcurrentDownloads! <=
            MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS
            ? preferences.maxConcurrentDownloads!
            : DEFAULT_MAX_CONCURRENT_DOWNLOADS,
        maxDownloadSpeedMegabytes:
          typeof preferences.maxDownloadSpeedBytesPerSecond === "number" &&
          preferences.maxDownloadSpeedBytesPerSecond > 0
            ? formatDownloadSpeedLimit(
                preferences.maxDownloadSpeedBytesPerSecond,
                preferences.showDownloadSpeedInMegabytes ?? false
              )
            : "",
        seedAfterDownloadComplete:
          preferences.seedAfterDownloadComplete ?? false,
        showDownloadSpeedInMegabytes:
          preferences.showDownloadSpeedInMegabytes ?? false,
        extractFilesByDefault: preferences.extractFilesByDefault ?? true,
        deleteArchiveFilesAfterExtractionByDefault:
          preferences.deleteArchiveFilesAfterExtractionByDefault ?? false,
        createStartMenuShortcut: preferences.createStartMenuShortcut ?? true,
      }
    : DEFAULT_FORM;

const CONCURRENT_DOWNLOAD_OPTIONS = Array.from(
  {
    length:
      MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS -
      MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS +
      1,
  },
  (_, index) => {
    const value = MIN_CONFIGURABLE_CONCURRENT_DOWNLOADS + index;
    return { value: `${value}`, label: `${value}` };
  }
);

const formatDownloadSpeedLimit = (value: number, useMegabytes: boolean) => {
  const unitValue = useMegabytes ? value / (1024 * 1024) : (value * 8) / 1e6;
  return Number.isInteger(unitValue)
    ? `${unitValue}`
    : `${Number(unitValue.toFixed(6))}`;
};

const parseDownloadSpeedLimit = (value: string, useMegabytes: boolean) => {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return useMegabytes
    ? Math.round(parsed * 1024 * 1024)
    : Math.round((parsed * 1e6) / 8);
};

export function DownloadsBehaviorSection({
  className,
  lastItemDownTarget,
}: Readonly<DownloadsBehaviorSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<DownloadsBehaviorForm>(() =>
    buildForm(userPreferences)
  );

  const speedInputDirty = useRef(false);
  const speedLimitBytes = useRef(
    userPreferences?.maxDownloadSpeedBytesPerSecond ?? null
  );

  useEffect(() => {
    if (!userPreferences) return;
    if (!speedInputDirty.current)
      speedLimitBytes.current =
        userPreferences.maxDownloadSpeedBytesPerSecond ?? null;
    setForm((current) => ({
      ...buildForm(userPreferences),
      ...(speedInputDirty.current
        ? { maxDownloadSpeedMegabytes: current.maxDownloadSpeedMegabytes }
        : {}),
    }));
  }, [userPreferences]);

  const isWindows = globalThis.window.electron.platform === "win32";
  const isLinux = globalThis.window.electron.platform === "linux";

  const updateUserPreferences = useCallback(
    async (values: Partial<UserPreferences>) => {
      setForm((current) => ({ ...current, ...values }));

      try {
        await globalThis.window.electron.updateUserPreferences(values);
      } catch (error) {
        console.error("Failed to update download preferences", error);
        setForm(buildForm(userPreferences));
      }
    },
    [userPreferences]
  );

  const handleDownloadSpeedBlur = () => {
    if (!speedInputDirty.current) return;
    speedInputDirty.current = false;
    const maxDownloadSpeedBytesPerSecond = parseDownloadSpeedLimit(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );
    const maxDownloadSpeedMegabytes = maxDownloadSpeedBytesPerSecond
      ? formatDownloadSpeedLimit(
          maxDownloadSpeedBytesPerSecond,
          form.showDownloadSpeedInMegabytes
        )
      : "";

    speedLimitBytes.current = maxDownloadSpeedBytesPerSecond;
    setForm((current) => ({ ...current, maxDownloadSpeedMegabytes }));
    void updateUserPreferences({ maxDownloadSpeedBytesPerSecond });
  };

  const handleSpeedUnitChange = useCallback(
    (showDownloadSpeedInMegabytes: boolean) => {
      const maxDownloadSpeedBytesPerSecond = speedInputDirty.current
        ? parseDownloadSpeedLimit(
            form.maxDownloadSpeedMegabytes,
            form.showDownloadSpeedInMegabytes
          )
        : speedLimitBytes.current;
      speedLimitBytes.current = maxDownloadSpeedBytesPerSecond;
      speedInputDirty.current = false;

      setForm((current) => ({
        ...current,
        showDownloadSpeedInMegabytes,
        maxDownloadSpeedMegabytes: maxDownloadSpeedBytesPerSecond
          ? formatDownloadSpeedLimit(
              maxDownloadSpeedBytesPerSecond,
              showDownloadSpeedInMegabytes
            )
          : "",
      }));
      void updateUserPreferences({
        showDownloadSpeedInMegabytes,
        maxDownloadSpeedBytesPerSecond,
      });
    },
    [
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes,
      updateUserPreferences,
    ]
  );

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
        onChange: (checked: boolean) => handleSpeedUnitChange(checked),
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
  }, [form, handleSpeedUnitChange, isWindows, isLinux, updateUserPreferences]);

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      [
        DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxConcurrentDownloads,
        DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxDownloadSpeed,
        ...items.map((item) => item.focusId),
      ].map((focusId, index, focusIds) => {
        const previousFocusId = focusIds[index - 1];
        const nextFocusId = focusIds[index + 1];

        return [
          focusId,
          {
            up: previousFocusId
              ? {
                  type: "item",
                  itemId: previousFocusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextFocusId
              ? {
                  type: "item",
                  itemId: nextFocusId,
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
          <DropdownSelect
            label="Simultaneous downloads"
            value={`${form.maxConcurrentDownloads}`}
            options={CONCURRENT_DOWNLOAD_OPTIONS}
            onValueChange={(value) =>
              void updateUserPreferences({
                maxConcurrentDownloads: Number(value),
              })
            }
            focusId={DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxConcurrentDownloads}
            focusNavigationOverrides={
              navigationOverridesByFocusId[
                DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxConcurrentDownloads
              ]
            }
          />
          <Input
            type="number"
            min="0"
            step="0.1"
            label={`Maximum download speed (${form.showDownloadSpeedInMegabytes ? "MB/s" : "Mbps"})`}
            hint="Leave blank for unlimited."
            placeholder="Unlimited"
            value={form.maxDownloadSpeedMegabytes}
            onChange={(event) => {
              speedInputDirty.current = true;
              setForm((current) => ({
                ...current,
                maxDownloadSpeedMegabytes: event.target.value,
              }));
            }}
            onBlur={handleDownloadSpeedBlur}
            focusId={DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxDownloadSpeed}
            focusNavigationOverrides={
              navigationOverridesByFocusId[
                DOWNLOADS_BEHAVIOR_ITEM_FOCUS_IDS.maxDownloadSpeed
              ]
            }
          />
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
