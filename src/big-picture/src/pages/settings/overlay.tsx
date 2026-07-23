import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  resolveHydraOverlayPreferences,
} from "@shared";

import { Checkbox, VerticalFocusGroup } from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  OVERLAY_ITEM_FOCUS_IDS,
  OVERLAY_PERFORMANCE_SECTION_REGION_ID,
  OVERLAY_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

import "./big-picture.scss";

interface OverlaySettingsSectionProps {
  className?: string;
}

export function OverlaySettingsSection({
  className,
}: Readonly<OverlaySettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState(DEFAULT_HYDRA_OVERLAY_PREFERENCES);

  useEffect(() => {
    if (!userPreferences) return;
    setForm(resolveHydraOverlayPreferences(userPreferences));
  }, [userPreferences]);

  const update = useCallback(async (values: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...values }));
    await globalThis.window.electron.updateUserPreferences(values);
  }, []);

  const performanceDisabled =
    !form.overlayEnabled || !form.overlayPerformanceEnabled;

  const navigationOverrides = useMemo<Record<string, FocusOverrides>>(() => {
    const ids = OVERLAY_ITEM_FOCUS_IDS;
    return {
      [ids.enabled]: {
        up: SETTINGS_HEADER_RETURN_TARGET,
        down: { type: "item", itemId: ids.performanceEnabled },
      },
      [ids.performanceEnabled]: {
        up: { type: "item", itemId: ids.enabled },
        down: { type: "item", itemId: ids.fps },
      },
      [ids.fps]: {
        up: { type: "item", itemId: ids.performanceEnabled },
        down: { type: "item", itemId: ids.averageFps },
      },
      [ids.averageFps]: {
        up: { type: "item", itemId: ids.fps },
        down: { type: "item", itemId: ids.frameTime },
      },
      [ids.frameTime]: {
        up: { type: "item", itemId: ids.averageFps },
        down: { type: "item", itemId: ids.onePercentLow },
      },
      [ids.onePercentLow]: {
        up: { type: "item", itemId: ids.frameTime },
        down: { type: "block" },
      },
    };
  }, []);

  return (
    <div
      className={
        className
          ? `big-picture-settings-section ${className}`
          : "big-picture-settings-section"
      }
    >
      <SettingsSection
        title="Hydra overlay"
        description="Open your game hub with Shift + F3 without leaving the game."
      >
        <VerticalFocusGroup regionId={OVERLAY_SECTION_REGION_ID} asChild>
          <div className="big-picture-settings-section__content">
            <Checkbox
              id="overlay-enabled"
              label="Enable Hydra overlay"
              checked={form.overlayEnabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.enabled}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.enabled]
              }
              block
              onChange={(checked) => void update({ overlayEnabled: checked })}
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>

      <SettingsSection
        title="Performance"
        description="Choose which live metrics appear in the performance panel."
      >
        <VerticalFocusGroup
          regionId={OVERLAY_PERFORMANCE_SECTION_REGION_ID}
          asChild
        >
          <div className="big-picture-settings-section__content">
            <Checkbox
              id="overlay-performance-enabled"
              label="Enable performance monitoring"
              checked={form.overlayPerformanceEnabled}
              disabled={!form.overlayEnabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.performanceEnabled}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.performanceEnabled]
              }
              block
              onChange={(checked) =>
                void update({ overlayPerformanceEnabled: checked })
              }
            />
            <Checkbox
              id="overlay-performance-fps"
              label="Frames per second"
              checked={form.overlayPerformanceShowFps}
              disabled={performanceDisabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.fps}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.fps]
              }
              block
              onChange={(checked) =>
                void update({ overlayPerformanceShowFps: checked })
              }
            />
            <Checkbox
              id="overlay-performance-average-fps"
              label="Average FPS"
              checked={form.overlayPerformanceShowAverageFps}
              disabled={performanceDisabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.averageFps}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.averageFps]
              }
              block
              onChange={(checked) =>
                void update({ overlayPerformanceShowAverageFps: checked })
              }
            />
            <Checkbox
              id="overlay-performance-frame-time"
              label="Frame time"
              checked={form.overlayPerformanceShowFrameTime}
              disabled={performanceDisabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.frameTime}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.frameTime]
              }
              block
              onChange={(checked) =>
                void update({ overlayPerformanceShowFrameTime: checked })
              }
            />
            <Checkbox
              id="overlay-performance-one-percent-low"
              label="1% low FPS"
              checked={form.overlayPerformanceShowOnePercentLow}
              disabled={performanceDisabled}
              focusId={OVERLAY_ITEM_FOCUS_IDS.onePercentLow}
              navigationOverrides={
                navigationOverrides[OVERLAY_ITEM_FOCUS_IDS.onePercentLow]
              }
              block
              onChange={(checked) =>
                void update({ overlayPerformanceShowOnePercentLow: checked })
              }
            />
          </div>
        </VerticalFocusGroup>
      </SettingsSection>
    </div>
  );
}
