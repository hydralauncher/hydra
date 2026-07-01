import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { AchievementCustomNotificationPosition } from "@types";
import { UnmuteIcon } from "@primer/octicons-react";
import { BellIcon, SlidersHorizontalIcon } from "lucide-react";

import "./settings-general.scss";

export function SettingsContextNotifications() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const volumeUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  const [form, setForm] = useState({
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    friendRequestNotificationsEnabled: false,
    friendStartGameNotificationsEnabled: true,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
  });

  useEffect(() => {
    if (!userPreferences) return;

    setForm((prev) => ({
      ...prev,
      downloadNotificationsEnabled:
        userPreferences.downloadNotificationsEnabled ?? false,
      repackUpdatesNotificationsEnabled:
        userPreferences.repackUpdatesNotificationsEnabled ?? false,
      achievementNotificationsEnabled:
        userPreferences.achievementNotificationsEnabled ?? true,
      achievementCustomNotificationsEnabled:
        userPreferences.achievementCustomNotificationsEnabled ?? true,
      achievementCustomNotificationPosition:
        userPreferences.achievementCustomNotificationPosition ?? "top-left",
      achievementSoundVolume: Math.round(
        (userPreferences.achievementSoundVolume ?? 0.15) * 100
      ),
      friendRequestNotificationsEnabled:
        userPreferences.friendRequestNotificationsEnabled ?? false,
      friendStartGameNotificationsEnabled:
        userPreferences.friendStartGameNotificationsEnabled ?? true,
    }));
  }, [userPreferences]);

  useEffect(() => {
    return () => {
      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }
    };
  }, []);

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

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("library_notifications")}</h3>

        <CheckboxField
          label={t("enable_download_notifications")}
          checked={form.downloadNotificationsEnabled}
          onChange={() =>
            handleChange({
              downloadNotificationsEnabled: !form.downloadNotificationsEnabled,
            })
          }
        />

        <CheckboxField
          label={t("enable_repack_list_notifications")}
          checked={form.repackUpdatesNotificationsEnabled}
          onChange={() =>
            handleChange({
              repackUpdatesNotificationsEnabled:
                !form.repackUpdatesNotificationsEnabled,
            })
          }
        />

        <CheckboxField
          label={t("enable_friend_request_notifications")}
          checked={form.friendRequestNotificationsEnabled}
          onChange={() =>
            handleChange({
              friendRequestNotificationsEnabled:
                !form.friendRequestNotificationsEnabled,
            })
          }
        />

        <CheckboxField
          label={t("enable_friend_start_game_notifications")}
          checked={form.friendStartGameNotificationsEnabled}
          onChange={() =>
            handleChange({
              friendStartGameNotificationsEnabled:
                !form.friendStartGameNotificationsEnabled,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("achievement_notifications")}</h3>

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

        <Button
          theme="outline"
          className="settings-general__test-achievement-notification-button"
          disabled={!form.achievementNotificationsEnabled}
          onClick={() => window.electron.showAchievementTestNotification()}
        >
          <BellIcon size={16} />
          {t("test_notification")}
        </Button>

        <Button
          theme="outline"
          className="settings-general__test-achievement-notification-button"
          disabled={
            !form.achievementNotificationsEnabled ||
            !form.achievementCustomNotificationsEnabled
          }
          onClick={() =>
            window.electron.openAchievementNotificationCustomizerWindow()
          }
        >
          <SlidersHorizontalIcon size={16} />
          {t("achievement_notification_customizer")}
        </Button>

        {form.achievementNotificationsEnabled && (
          <div className="settings-general__volume-control">
            <label htmlFor="achievement-volume">
              {t("achievement_sound_volume")}
            </label>
            <div className="settings-general__volume-slider-wrapper">
              <UnmuteIcon size={16} className="settings-general__volume-icon" />
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
                className="settings-general__volume-slider"
                style={
                  {
                    "--volume-percent": `${form.achievementSoundVolume}%`,
                  } as React.CSSProperties
                }
              />
              <span className="settings-general__volume-value">
                {form.achievementSoundVolume}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
