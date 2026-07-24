import { useContext, useEffect, useState } from "react";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import {
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  resolveHydraOverlayPreferences,
} from "@shared";

export function SettingsContextOverlay() {
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
        <h3>Hydra overlay</h3>
        <p className="settings-context-panel__description">
          Open your game hub with Shift + Tab without leaving the game.
        </p>
        <CheckboxField
          label="Enable Hydra overlay"
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
            <h3>Performance</h3>
            <p className="settings-context-panel__description">
              Choose which live metrics appear in the performance panel.
            </p>
            <CheckboxField
              label="Enable performance monitoring"
              checked={form.overlayPerformanceEnabled}
              disabled={!form.overlayEnabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceEnabled: !form.overlayPerformanceEnabled,
                })
              }
            />
            <CheckboxField
              label="Frames per second"
              checked={form.overlayPerformanceShowFps}
              disabled={performanceDisabled}
              onChange={() =>
                handleChange({
                  overlayPerformanceShowFps: !form.overlayPerformanceShowFps,
                })
              }
            />
            <CheckboxField
              label="Average FPS"
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
              label="Frame time"
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
              label="1% low FPS"
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
            <h3>Performance</h3>
            <p className="settings-context-panel__description">
              Use MangoHud for Linux performance metrics. Hydra does not inject
              or display a duplicate Linux performance panel.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
