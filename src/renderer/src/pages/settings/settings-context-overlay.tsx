import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import {
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  resolveHydraOverlayPreferences,
} from "@shared";

export function SettingsContextOverlay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [form, setForm] = useState(DEFAULT_HYDRA_OVERLAY_PREFERENCES);

  useEffect(() => {
    if (!userPreferences) return;
    setForm(resolveHydraOverlayPreferences(userPreferences));
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...values }));
    void updateUserPreferences(values);
  };

  const performanceDisabled =
    !form.overlayEnabled || !form.overlayPerformanceEnabled;
  const performanceAvailable = globalThis.electron.platform !== "linux";

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("hydra_overlay")}</h3>
        <p className="settings-context-panel__description">
          {t("hydra_overlay_description")}
        </p>
        <CheckboxField
          label={t("enable_hydra_overlay")}
          checked={form.overlayEnabled}
          onChange={() =>
            handleChange({ overlayEnabled: !form.overlayEnabled })
          }
        />
      </div>

      {performanceAvailable ? (
        <>
          <hr className="settings-context-panel__divider" />

          <div className="settings-context-panel__group">
            <h3>{t("overlay_performance")}</h3>
            <p className="settings-context-panel__description">
              {t("overlay_performance_description")}
            </p>
            <CheckboxField
              label={t("enable_overlay_performance")}
              checked={form.overlayPerformanceEnabled}
              disabled={!form.overlayEnabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceEnabled: !form.overlayPerformanceEnabled,
                })
              }
            />
            <CheckboxField
              label={t("overlay_frames_per_second")}
              checked={form.overlayPerformanceShowFps}
              disabled={performanceDisabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceShowFps: !form.overlayPerformanceShowFps,
                })
              }
            />
            <CheckboxField
              label={t("overlay_average_fps")}
              checked={form.overlayPerformanceShowAverageFps}
              disabled={performanceDisabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceShowAverageFps:
                    !form.overlayPerformanceShowAverageFps,
                })
              }
            />
            <CheckboxField
              label={t("overlay_frame_time")}
              checked={form.overlayPerformanceShowFrameTime}
              disabled={performanceDisabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceShowFrameTime:
                    !form.overlayPerformanceShowFrameTime,
                })
              }
            />
            <CheckboxField
              label={t("overlay_one_percent_low")}
              checked={form.overlayPerformanceShowOnePercentLow}
              disabled={performanceDisabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceShowOnePercentLow:
                    !form.overlayPerformanceShowOnePercentLow,
                })
              }
            />
          </div>
        </>
      ) : (
        <>
          <hr className="settings-context-panel__divider" />
          <div className="settings-context-panel__group">
            <h3>{t("overlay_performance")}</h3>
            <p className="settings-context-panel__description">
              {t("overlay_linux_performance_description")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
