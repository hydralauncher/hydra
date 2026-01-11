import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField, Button, SelectField } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-achievements.scss";
import { QuestionIcon, UnmuteIcon } from "@primer/octicons-react";
import { AchievementCustomNotificationPosition } from "@types";

export function SettingsAchievements() {
  const { t } = useTranslation("settings");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);

  const [form, setForm] = useState({
    showHiddenAchievementsDescription: false,
    enableSteamAchievements: false,
    enableAchievementScreenshots: false,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
  });

  const volumeUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (userPreferences) {
      setForm((prev) => ({
        ...prev,
        showHiddenAchievementsDescription:
          userPreferences.showHiddenAchievementsDescription ?? false,
        enableSteamAchievements:
          userPreferences.enableSteamAchievements ?? false,
        enableAchievementScreenshots:
          userPreferences.enableAchievementScreenshots ?? false,
        achievementNotificationsEnabled:
          userPreferences.achievementNotificationsEnabled ?? true,
        achievementCustomNotificationsEnabled:
          userPreferences.achievementCustomNotificationsEnabled ?? true,
        achievementCustomNotificationPosition:
          userPreferences.achievementCustomNotificationPosition ?? "top-left",
        achievementSoundVolume: Math.round(
          (userPreferences.achievementSoundVolume ?? 0.15) * 100
        ),
      }));
    }
  }, [userPreferences]);

  const achievementCustomNotificationPositionOptions = useMemo(() => {
    return [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ].map((position) => ({
      key: position,
      value: position,
      label: t(position),
    }));
  }, [t]);

  const handleChange = async (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await updateUserPreferences(values);
  };

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      setForm((prev) => ({ ...prev, achievementSoundVolume: newVolume }));

      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }

      volumeUpdateTimeoutRef.current = setTimeout(() => {
        updateUserPreferences({ achievementSoundVolume: newVolume / 100 });
      }, 300);
    },
    [updateUserPreferences]
  );

  const handleChangeAchievementCustomNotificationPosition = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value as AchievementCustomNotificationPosition;

    await handleChange({ achievementCustomNotificationPosition: value });
    window.electron.updateAchievementCustomNotificationWindow();
  };

  return (
    <div className="settings-achievements">
      <div className="settings-achievements__section settings-achievements__section--achievements">
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

        <div className="settings-achievements__checkbox-container--with-tooltip">
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
            className="settings-achievements__checkbox-container--tooltip"
            data-open-article="steam-achievements"
          >
            <QuestionIcon size={12} />
          </small>
        </div>

        <div className="settings-achievements__checkbox-container--with-tooltip">
          <CheckboxField
            label={t("enable_achievement_screenshots")}
            checked={form.enableAchievementScreenshots}
            disabled={window.electron.platform === "linux"}
            onChange={() =>
              handleChange({
                enableAchievementScreenshots:
                  !form.enableAchievementScreenshots,
              })
            }
          />

          <small
            className="settings-achievements__checkbox-container--tooltip"
            data-open-article="achievement-souvenirs"
          >
            <QuestionIcon size={12} />
          </small>
        </div>

        <div className="settings-achievements__button-container">
          <Button
            theme="outline"
            disabled={window.electron.platform === "linux"}
            onClick={async () => {
              const screenshotsPath =
                await window.electron.getScreenshotsPath();
              window.electron.openFolder(screenshotsPath);
            }}
          >
            {t("open_screenshots_directory")}
          </Button>
        </div>
      </div>

      <div className="settings-achievements__section settings-achievements__section--notifications">
        <h3 className="settings-achievements__section-title">
          {t("notifications")}
        </h3>

        <CheckboxField
          label={t("enable_achievement_notifications")}
          checked={form.achievementNotificationsEnabled}
          onChange={async () => {
            await handleChange({
              achievementNotificationsEnabled:
                !form.achievementNotificationsEnabled,
            });
            window.electron.updateAchievementCustomNotificationWindow();
          }}
        />

        <CheckboxField
          label={t("enable_achievement_custom_notifications")}
          checked={form.achievementCustomNotificationsEnabled}
          disabled={!form.achievementNotificationsEnabled}
          onChange={async () => {
            await handleChange({
              achievementCustomNotificationsEnabled:
                !form.achievementCustomNotificationsEnabled,
            });
            window.electron.updateAchievementCustomNotificationWindow();
          }}
        />

        {form.achievementNotificationsEnabled &&
          form.achievementCustomNotificationsEnabled && (
            <>
              <SelectField
                className="settings-achievements__achievement-custom-notification-position__select-variation"
                label={t("achievement_custom_notification_position")}
                value={form.achievementCustomNotificationPosition}
                onChange={handleChangeAchievementCustomNotificationPosition}
                options={achievementCustomNotificationPositionOptions}
              />

              <Button
                className="settings-achievements__test-achievement-notification-button"
                onClick={() =>
                  window.electron.showAchievementTestNotification()
                }
              >
                {t("test_notification")}
              </Button>
            </>
          )}

        {form.achievementNotificationsEnabled && (
          <div className="settings-achievements__volume-control">
            <label htmlFor="achievement-volume">
              {t("achievement_sound_volume")}
            </label>
            <div className="settings-achievements__volume-slider-wrapper">
              <UnmuteIcon
                size={16}
                className="settings-achievements__volume-icon"
              />
              <input
                id="achievement-volume"
                type="range"
                min="0"
                max="100"
                value={form.achievementSoundVolume}
                onChange={(e) => {
                  const volumePercent = parseInt(e.target.value, 10);
                  if (!isNaN(volumePercent)) {
                    handleVolumeChange(volumePercent);
                  }
                }}
                className="settings-achievements__volume-slider"
                style={
                  {
                    "--volume-percent": `${form.achievementSoundVolume}%`,
                  } as React.CSSProperties
                }
              />
              <span className="settings-achievements__volume-value">
                {form.achievementSoundVolume}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
