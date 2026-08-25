import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  ConfirmationModal,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import {
  FileDirectoryIcon,
  HistoryIcon,
  QuestionIcon,
} from "@primer/octicons-react";
import { useLocation } from "react-router-dom";
import { isAchievementSouvenirsEnabled } from "@shared";
import type { UserPreferences } from "@types";

import "./settings-behavior.scss";

const buildForm = (preferences: UserPreferences | null) => ({
  autoplayGameTrailers: preferences?.autoplayGameTrailers ?? true,
  disableNsfwAlert: preferences?.disableNsfwAlert ?? false,
  showHiddenAchievementsDescription:
    preferences?.showHiddenAchievementsDescription ?? false,
  enableSteamAchievements: preferences?.enableSteamAchievements ?? false,
  enableAchievementSouvenirs: isAchievementSouvenirsEnabled(
    preferences?.enableAchievementSouvenirs,
    window.electron.platform
  ),
  enableNewDownloadOptionsBadges:
    preferences?.enableNewDownloadOptionsBadges ?? true,
  hideClassicsBookmark: preferences?.hideClassicsBookmark ?? false,
  classicsUseHeroLayout: preferences?.classicsUseHeroLayout ?? false,
  hideLibraryGameBadges: preferences?.hideLibraryGameBadges ?? false,
  hideLibraryClassicsBadges: preferences?.hideLibraryClassicsBadges ?? false,
  hideLibraryAchievementProgress:
    preferences?.hideLibraryAchievementProgress ?? false,
  autoplayAnimatedArtwork: preferences?.autoplayAnimatedArtwork ?? false,
});

export function SettingsContextContentGameplay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const { hash } = useLocation();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [showWaylandSouvenirsWarning, setShowWaylandSouvenirsWarning] =
    useState(false);
  const [screenshotsPath, setScreenshotsPath] = useState("");
  const canManageScreenshots =
    hasActiveSubscription && form.enableAchievementSouvenirs;

  useEffect(() => {
    void window.electron.getScreenshotsPath().then(setScreenshotsPath);
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  useEffect(() => {
    if (hash !== "#achievement-souvenirs") return;

    const frameId = window.requestAnimationFrame(() => {
      const souvenirToggle = document.getElementById("achievement-souvenirs");
      souvenirToggle?.scrollIntoView({ block: "center" });
      souvenirToggle?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [hash, hasActiveSubscription]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleAchievementSouvenirsChange = () => {
    if (form.enableAchievementSouvenirs) {
      handleChange({ enableAchievementSouvenirs: false });
      return;
    }

    if (window.electron.isWayland) {
      setShowWaylandSouvenirsWarning(true);
      return;
    }

    handleChange({ enableAchievementSouvenirs: true });
  };

  const handleWaylandSouvenirsConfirm = () => {
    setShowWaylandSouvenirsWarning(false);
    handleChange({ enableAchievementSouvenirs: true });
  };

  const handleChooseScreenshotsPath = async () => {
    if (!canManageScreenshots) return;

    const { canceled, filePaths } = await window.electron.showOpenDialog({
      defaultPath: screenshotsPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = filePaths[0];

    if (canceled || !selectedPath) return;

    setScreenshotsPath(selectedPath);
    await updateUserPreferences({
      achievementScreenshotsPath: selectedPath,
    });
  };

  const handleOpenScreenshotsPath = async () => {
    if (!canManageScreenshots) return;

    const currentPath =
      screenshotsPath || (await window.electron.getScreenshotsPath());
    await window.electron.openFolder(currentPath);
  };

  const handleResetScreenshotsPath = async () => {
    if (!canManageScreenshots) return;

    await updateUserPreferences({ achievementScreenshotsPath: undefined });
    setScreenshotsPath(await window.electron.getScreenshotsPath());
  };

  const hasCustomScreenshotsPath = Boolean(
    userPreferences?.achievementScreenshotsPath
  );

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("content_preferences")}</h3>

        <CheckboxField
          label={t("autoplay_trailers_on_game_page")}
          checked={form.autoplayGameTrailers}
          onChange={() =>
            handleChange({
              autoplayGameTrailers: !form.autoplayGameTrailers,
            })
          }
        />

        <CheckboxField
          label={t("disable_nsfw_alert")}
          checked={form.disableNsfwAlert}
          onChange={() =>
            handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
          }
        />

        <CheckboxField
          label={t("show_hidden_achievement_description")}
          checked={form.showHiddenAchievementsDescription}
          onChange={() =>
            handleChange({
              showHiddenAchievementsDescription:
                !form.showHiddenAchievementsDescription,
            })
          }
        />

        <CheckboxField
          label={t("enable_new_download_options_badges")}
          checked={form.enableNewDownloadOptionsBadges}
          onChange={() =>
            handleChange({
              enableNewDownloadOptionsBadges:
                !form.enableNewDownloadOptionsBadges,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gameplay_metadata")}</h3>

        <div className={`settings-behavior__checkbox-container--with-tooltip`}>
          <CheckboxField
            label={t("enable_steam_achievements")}
            checked={form.enableSteamAchievements}
            onChange={() =>
              handleChange({
                enableSteamAchievements: !form.enableSteamAchievements,
              })
            }
          />

          <small
            className="settings-behavior__checkbox-container--tooltip"
            data-open-article="steam-achievements"
          >
            <QuestionIcon size={12} />
          </small>
        </div>

        {hasActiveSubscription ? (
          <CheckboxField
            id="achievement-souvenirs"
            label={t("enable_achievement_souvenirs")}
            checked={form.enableAchievementSouvenirs}
            onChange={handleAchievementSouvenirsChange}
          />
        ) : (
          <button
            type="button"
            className="settings-behavior__hydra-cloud-row"
            onClick={() => showHydraCloudModal("achievements")}
          >
            <CheckboxField
              id="achievement-souvenirs"
              label={t("enable_achievement_souvenirs")}
              checked={false}
              disabled
              readOnly
            />

            <span className="settings-behavior__hydra-cloud-badge">
              Hydra Cloud
            </span>
          </button>
        )}

        <div className="settings-behavior__screenshots-directory">
          <TextField
            label={t("screenshots_directory")}
            value={screenshotsPath}
            readOnly
            disabled
            rightContent={
              <>
                <Button
                  theme="outline"
                  disabled={!canManageScreenshots}
                  onClick={handleChooseScreenshotsPath}
                >
                  <FileDirectoryIcon size={14} />
                  {t("change_screenshots_directory")}
                </Button>
                {hasCustomScreenshotsPath && (
                  <Button
                    className="settings-behavior__reset-screenshots-button"
                    theme="outline"
                    disabled={!canManageScreenshots}
                    tooltip={t("reset_screenshots_directory")}
                    aria-label={t("reset_screenshots_directory")}
                    onClick={handleResetScreenshotsPath}
                  >
                    <HistoryIcon size={14} />
                  </Button>
                )}
              </>
            }
          />

          <Button
            className="settings-behavior__open-screenshots-button"
            theme="outline"
            disabled={!canManageScreenshots}
            onClick={handleOpenScreenshotsPath}
          >
            <FileDirectoryIcon size={14} />
            {t("open_screenshots_directory")}
          </Button>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("library_appearance")}</h3>

        <CheckboxField
          label={t("hide_library_game_badges")}
          checked={form.hideLibraryGameBadges}
          onChange={() =>
            handleChange({
              hideLibraryGameBadges: !form.hideLibraryGameBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_classics_badges")}
          checked={form.hideLibraryClassicsBadges}
          onChange={() =>
            handleChange({
              hideLibraryClassicsBadges: !form.hideLibraryClassicsBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_achievement_progress")}
          checked={form.hideLibraryAchievementProgress}
          onChange={() =>
            handleChange({
              hideLibraryAchievementProgress:
                !form.hideLibraryAchievementProgress,
            })
          }
        />

        <CheckboxField
          label={t("autoplay_animated_artwork")}
          checked={form.autoplayAnimatedArtwork}
          onChange={() =>
            handleChange({
              autoplayAnimatedArtwork: !form.autoplayAnimatedArtwork,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("classics_appearance")}</h3>

        <CheckboxField
          label={t("hide_classics_bookmark")}
          checked={form.hideClassicsBookmark}
          onChange={() =>
            handleChange({
              hideClassicsBookmark: !form.hideClassicsBookmark,
            })
          }
        />

        <CheckboxField
          label={t("classics_use_hero_layout")}
          checked={form.classicsUseHeroLayout}
          onChange={() =>
            handleChange({
              classicsUseHeroLayout: !form.classicsUseHeroLayout,
            })
          }
        />
      </div>
      <ConfirmationModal
        visible={showWaylandSouvenirsWarning}
        title={t("wayland_souvenirs_warning_title")}
        descriptionText={t("wayland_souvenirs_warning_description")}
        cancelButtonLabel={t("wayland_souvenirs_warning_cancel")}
        confirmButtonLabel={t("wayland_souvenirs_warning_confirm")}
        clickOutsideToClose={false}
        onConfirm={handleWaylandSouvenirsConfirm}
        onClose={() => setShowWaylandSouvenirsWarning(false)}
      />
    </div>
  );
}
