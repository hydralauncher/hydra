import "./content.scss";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterClockwiseIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";

import {
  Button,
  Checkbox,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { ConfirmationModal } from "../../components/modals";
import { useUserDetails, useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  CONTENT_ITEM_FOCUS_IDS,
  CONTENT_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import { isAchievementSouvenirsEnabled } from "@shared";
import type { UserPreferences } from "@types";

interface SettingsSectionProps {
  className?: string;
}

interface ContentForm {
  autoplayGameTrailers: boolean;
  disableNsfwAlert: boolean;
  showHiddenAchievementsDescription: boolean;
  enableSteamAchievements: boolean;
  enableAchievementSouvenirs: boolean;
  autoplayAnimatedArtwork: boolean;
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
  enableAchievementSouvenirs: isAchievementSouvenirsEnabled(
    undefined,
    globalThis.window.electron.platform
  ),
  autoplayAnimatedArtwork: false,
};

const buildForm = (preferences: UserPreferences | null): ContentForm =>
  preferences
    ? {
        autoplayGameTrailers: preferences.autoplayGameTrailers ?? true,
        disableNsfwAlert: preferences.disableNsfwAlert ?? false,
        showHiddenAchievementsDescription:
          preferences.showHiddenAchievementsDescription ?? false,
        enableSteamAchievements: preferences.enableSteamAchievements ?? false,
        enableAchievementSouvenirs: isAchievementSouvenirsEnabled(
          preferences.enableAchievementSouvenirs,
          globalThis.window.electron.platform
        ),
        autoplayAnimatedArtwork: preferences.autoplayAnimatedArtwork ?? false,
      }
    : DEFAULT_FORM;

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const { hasActiveSubscription } = useUserDetails();
  const [form, setForm] = useState<ContentForm>(() =>
    buildForm(userPreferences)
  );
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

    setForm(buildForm(userPreferences));
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
  const canManageScreenshots =
    supportsSouvenirs && form.enableAchievementSouvenirs;

  const handleChooseScreenshotsPath = useCallback(async () => {
    if (!canManageScreenshots) return;

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
  }, [canManageScreenshots, screenshotsPath]);

  const handleOpenScreenshotsPath = useCallback(async () => {
    if (!canManageScreenshots) return;

    const currentPath =
      screenshotsPath ||
      (await globalThis.window.electron.getScreenshotsPath());
    await globalThis.window.electron.openFolder(currentPath);
  }, [canManageScreenshots, screenshotsPath]);

  const handleResetScreenshotsPath = useCallback(async () => {
    if (!canManageScreenshots) return;

    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: undefined,
    });
    setScreenshotsPath(await globalThis.window.electron.getScreenshotsPath());
  }, [canManageScreenshots]);

  const items = useMemo<ContentItem[]>(() => {
    return [
      {
        id: "autoplay-game-trailers",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        label: t("autoplay_trailers_on_game_page"),
        checked: form.autoplayGameTrailers,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayGameTrailers: checked }),
      },
      {
        id: "disable-nsfw-alert",
        focusId: CONTENT_ITEM_FOCUS_IDS.disableNsfwAlert,
        label: t("disable_nsfw_alert"),
        checked: form.disableNsfwAlert,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ disableNsfwAlert: checked }),
      },
      {
        id: "show-hidden-achievements-description",
        focusId: CONTENT_ITEM_FOCUS_IDS.showHiddenAchievementsDescription,
        label: t("show_hidden_achievement_description"),
        checked: form.showHiddenAchievementsDescription,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            showHiddenAchievementsDescription: checked,
          }),
      },
      {
        id: "enable-steam-achievements",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableSteamAchievements,
        label: t("enable_steam_achievements"),
        checked: form.enableSteamAchievements,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ enableSteamAchievements: checked }),
      },
      {
        id: "autoplay-animated-artwork",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayAnimatedArtwork,
        label: t("autoplay_animated_artwork"),
        checked: form.autoplayAnimatedArtwork,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayAnimatedArtwork: checked }),
      },
      ...(supportsSouvenirs
        ? [
            {
              id: "enable-achievement-souvenirs",
              focusId: CONTENT_ITEM_FOCUS_IDS.enableAchievementSouvenirs,
              label: t("enable_achievement_souvenirs"),
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
    t,
    updateUserPreferences,
  ]);

  const hasCustomScreenshotsPath = Boolean(
    userPreferences?.achievementScreenshotsPath
  );

  const navigationFocusIds = useMemo(
    () => [
      ...items.map((item) => item.focusId),
      ...(canManageScreenshots
        ? [CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory]
        : []),
    ],
    [canManageScreenshots, items]
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
                <span className="content-settings-section__screenshots-label">
                  {t("screenshots_directory")}
                </span>
                <HorizontalFocusGroup
                  className="content-settings-section__screenshots-path-group"
                  asChild
                >
                  <div>
                    <FocusItem
                      id={CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory}
                      focusable={canManageScreenshots}
                      actions={{
                        primary: () => void handleChooseScreenshotsPath(),
                      }}
                      navigationOverrides={
                        navigationOverridesByFocusId[
                          CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                        ]
                      }
                      asChild
                    >
                      <button
                        type="button"
                        disabled={!canManageScreenshots}
                        className="content-settings-section__screenshots-path"
                        title={screenshotsPath}
                        onClick={() => void handleChooseScreenshotsPath()}
                      >
                        {screenshotsPath}
                      </button>
                    </FocusItem>

                    {hasCustomScreenshotsPath && (
                      <Button
                        variant="secondary"
                        size="icon"
                        disabled={!canManageScreenshots}
                        focusId={
                          CONTENT_ITEM_FOCUS_IDS.resetScreenshotsDirectory
                        }
                        aria-label={t("reset_screenshots_directory")}
                        title={t("reset_screenshots_directory")}
                        icon={<ArrowCounterClockwiseIcon size={18} />}
                        focusNavigationOverrides={{
                          left: {
                            type: "item",
                            itemId:
                              CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
                          },
                          right: {
                            type: "item",
                            itemId:
                              CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory,
                          },
                          ...navigationOverridesByFocusId[
                            CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                          ],
                        }}
                        onClick={() => void handleResetScreenshotsPath()}
                      >
                        {""}
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      disabled={!canManageScreenshots}
                      focusId={CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory}
                      icon={<FolderOpenIcon size={18} />}
                      focusNavigationOverrides={{
                        ...navigationOverridesByFocusId[
                          CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                        ],
                        left: {
                          type: "item",
                          itemId: hasCustomScreenshotsPath
                            ? CONTENT_ITEM_FOCUS_IDS.resetScreenshotsDirectory
                            : CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
                        },
                        right: { type: "block" },
                      }}
                      onClick={() => void handleOpenScreenshotsPath()}
                    >
                      {t("open_screenshots_directory")}
                    </Button>
                  </div>
                </HorizontalFocusGroup>
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
