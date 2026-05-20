import "./content.scss";

import { useEffect, useMemo, useState } from "react";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  CONTENT_ITEM_FOCUS_IDS,
  CONTENT_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

interface ContentForm {
  autoplayGameTrailers: boolean;
  disableNsfwAlert: boolean;
  showHiddenAchievementsDescription: boolean;
  enableSteamAchievements: boolean;
}

interface ContentItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: ContentForm = {
  autoplayGameTrailers: true,
  disableNsfwAlert: false,
  showHiddenAchievementsDescription: false,
  enableSteamAchievements: false,
};

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<ContentForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
      disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      showHiddenAchievementsDescription:
        userPreferences.showHiddenAchievementsDescription ?? false,
      enableSteamAchievements: userPreferences.enableSteamAchievements ?? false,
    });
  }, [userPreferences]);

  const updateUserPreferences = async (values: Partial<ContentForm>) => {
    const nextForm = { ...form, ...values };
    setForm(nextForm);

    await globalThis.window.electron.updateUserPreferences(values);
  };

  const items = useMemo<ContentItem[]>(() => {
    return [
      {
        id: "autoplay-game-trailers",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        label: "Autoplay trailers on game page",
        checked: form.autoplayGameTrailers,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayGameTrailers: checked }),
      },
      {
        id: "disable-nsfw-alert",
        focusId: CONTENT_ITEM_FOCUS_IDS.disableNsfwAlert,
        label: "Disable NSFW alert",
        checked: form.disableNsfwAlert,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ disableNsfwAlert: checked }),
      },
      {
        id: "show-hidden-achievements-description",
        focusId: CONTENT_ITEM_FOCUS_IDS.showHiddenAchievementsDescription,
        label: "Show hidden achievement description",
        checked: form.showHiddenAchievementsDescription,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            showHiddenAchievementsDescription: checked,
          }),
      },
      {
        id: "enable-steam-achievements",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableSteamAchievements,
        label: "Enable search for Steam achievements",
        checked: form.enableSteamAchievements,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ enableSteamAchievements: checked }),
      },
    ];
  }, [form]);

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
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [items]);

  return (
    <div
      className={
        className
          ? `content-settings-section ${className}`
          : "content-settings-section"
      }
    >
      <SettingsSection
        title="Preferences"
        description="Choose how Hydra should handle trailers, content warnings, and achievement details."
      >
        <VerticalFocusGroup regionId={CONTENT_SECTION_REGION_ID} asChild>
          <div className="content-settings-section__content">
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
    </div>
  );
}
