import "./content.scss";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { ConfirmationModal } from "../../components/modals";
import { useUserDetails, useUserPreferences } from "../../hooks";
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
  enableAchievementSouvenirs: boolean;
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
  enableAchievementSouvenirs: false,
};

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const { hasActiveSubscription } = useUserDetails();
  const [form, setForm] = useState<ContentForm>(DEFAULT_FORM);
  const [showWaylandSouvenirsWarning, setShowWaylandSouvenirsWarning] =
    useState(false);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
      disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      showHiddenAchievementsDescription:
        userPreferences.showHiddenAchievementsDescription ?? false,
      enableSteamAchievements: userPreferences.enableSteamAchievements ?? false,
      enableAchievementSouvenirs:
        userPreferences.enableAchievementSouvenirs ?? false,
    });
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<ContentForm>) => {
      setForm((currentForm) => ({ ...currentForm, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleAchievementSouvenirsChange = useCallback(
    (checked: boolean) => {
      if (checked && globalThis.window.electron.isWayland) {
        setShowWaylandSouvenirsWarning(true);
        return;
      }

      void updateUserPreferences({ enableAchievementSouvenirs: checked });
    },
    [updateUserPreferences]
  );

  const handleWaylandSouvenirsConfirm = useCallback(() => {
    setShowWaylandSouvenirsWarning(false);
    return updateUserPreferences({ enableAchievementSouvenirs: true });
  }, [updateUserPreferences]);

  const supportsSouvenirs = hasActiveSubscription;

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
      ...(supportsSouvenirs
        ? [
            {
              id: "enable-achievement-souvenirs",
              focusId: CONTENT_ITEM_FOCUS_IDS.enableAchievementSouvenirs,
              label: "Enable souvenirs for achievements",
              checked: form.enableAchievementSouvenirs,
              onChange: handleAchievementSouvenirsChange,
            },
          ]
        : []),
    ];
  }, [
    form,
    handleAchievementSouvenirsChange,
    supportsSouvenirs,
    updateUserPreferences,
  ]);

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

      <ConfirmationModal
        visible={showWaylandSouvenirsWarning}
        title={t("wayland_souvenirs_warning_title")}
        description={t("wayland_souvenirs_warning_description")}
        confirmLabel={t("wayland_souvenirs_warning_confirm")}
        onClose={() => setShowWaylandSouvenirsWarning(false)}
        onConfirm={handleWaylandSouvenirsConfirm}
      />
    </div>
  );
}
