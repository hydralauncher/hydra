import "./content.scss";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Checkbox, VerticalFocusGroup } from "../../components";
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
  const [screenshotsPath, setScreenshotsPath] = useState("");

  useEffect(() => {
    void globalThis.window.electron
      .getScreenshotsPath()
      .then(setScreenshotsPath);
  }, []);

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

  const handleChooseScreenshotsPath = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      defaultPath: screenshotsPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = result.filePaths[0];

    if (result.canceled || !selectedPath) return;

    setScreenshotsPath(selectedPath);
    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: selectedPath,
    });
  }, [screenshotsPath]);

  const handleOpenScreenshotsPath = useCallback(async () => {
    const currentPath =
      screenshotsPath ||
      (await globalThis.window.electron.getScreenshotsPath());
    await globalThis.window.electron.openFolder(currentPath);
  }, [screenshotsPath]);

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

  const navigationFocusIds = useMemo(
    () => [
      ...items.map((item) => item.focusId),
      ...(supportsSouvenirs
        ? [CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory]
        : []),
    ],
    [items, supportsSouvenirs]
  );

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      navigationFocusIds.map((focusId, index) => {
        const previousFocusId = navigationFocusIds[index - 1];
        const nextFocusId = navigationFocusIds[index + 1];

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
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [navigationFocusIds]);

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

            {supportsSouvenirs && (
              <div className="content-settings-section__screenshots-directory">
                <div className="content-settings-section__screenshots-copy">
                  <span className="content-settings-section__screenshots-label">
                    {t("screenshots_directory")}
                  </span>
                  <span
                    className="content-settings-section__screenshots-path"
                    title={screenshotsPath}
                  >
                    {screenshotsPath}
                  </span>
                </div>

                <div className="content-settings-section__screenshots-actions">
                  <Button
                    variant="secondary"
                    focusId={CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory}
                    focusNavigationOverrides={{
                      ...navigationOverridesByFocusId[
                        CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                      ],
                      left: { type: "block" },
                      right: {
                        type: "item",
                        itemId: CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory,
                      },
                    }}
                    onClick={() => void handleChooseScreenshotsPath()}
                  >
                    {t("change_screenshots_directory")}
                  </Button>
                  <Button
                    variant="secondary"
                    focusId={CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory}
                    focusNavigationOverrides={{
                      left: {
                        type: "item",
                        itemId:
                          CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
                      },
                      right: { type: "block" },
                      up: items.at(-1)
                        ? {
                            type: "item",
                            itemId: items.at(-1)!.focusId,
                          }
                        : SETTINGS_HEADER_RETURN_TARGET,
                      down: { type: "block" },
                    }}
                    onClick={() => void handleOpenScreenshotsPath()}
                  >
                    {t("open_screenshots_directory")}
                  </Button>
                </div>
              </div>
            )}
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
