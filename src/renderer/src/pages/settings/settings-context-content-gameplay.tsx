import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { QuestionIcon } from "@primer/octicons-react";

import "./settings-behavior.scss";

export function SettingsContextContentGameplay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    autoplayGameTrailers: true,
    disableNsfwAlert: false,
    showHiddenAchievementsDescription: false,
    enableSteamAchievements: false,
    enableAchievementScreenshots: false,
    enableNewDownloadOptionsBadges: true,
    hideClassicsBookmark: false,
    classicsUseHeroLayout: false,
  });

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
      disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      showHiddenAchievementsDescription:
        userPreferences.showHiddenAchievementsDescription ?? false,
      enableSteamAchievements: userPreferences.enableSteamAchievements ?? false,
      enableAchievementScreenshots:
        userPreferences.enableAchievementScreenshots ?? false,
      enableNewDownloadOptionsBadges:
        userPreferences.enableNewDownloadOptionsBadges ?? true,
      hideClassicsBookmark: userPreferences.hideClassicsBookmark ?? false,
      classicsUseHeroLayout: userPreferences.classicsUseHeroLayout ?? false,
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

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

        {window.electron.platform !== "linux" && (
          <>
            <div className="settings-behavior__checkbox-container--with-tooltip">
              <CheckboxField
                label={t("enable_achievement_screenshots")}
                checked={form.enableAchievementScreenshots}
                onChange={() => {
                  if (!hasActiveSubscription) {
                    showHydraCloudModal("achievements");
                    return;
                  }

                  handleChange({
                    enableAchievementScreenshots:
                      !form.enableAchievementScreenshots,
                  });
                }}
              />

              <small
                className="settings-behavior__checkbox-container--tooltip"
                data-open-article="achievement-souvenirs"
              >
                <QuestionIcon size={12} />
              </small>
            </div>

            <Button
              className="settings-behavior__open-screenshots-button"
              theme="outline"
              onClick={async () =>
                window.electron.openFolder(
                  await window.electron.getScreenshotsPath()
                )
              }
            >
              {t("open_screenshots_directory")}
            </Button>
          </>
        )}

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
    </div>
  );
}
