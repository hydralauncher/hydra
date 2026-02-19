import { useState, useCallback, useMemo } from "react";
import { useFeature, useAppSelector } from "@renderer/hooks";
import { SettingsTorBox } from "./settings-torbox";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { ChevronRightIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./settings-debrid.scss";

interface CollapseState {
  torbox: boolean;
  realDebrid: boolean;
}

export function SettingsDebrid() {
  const { t } = useTranslation("settings");
  const { isFeatureEnabled, Feature } = useFeature();
  const isTorBoxEnabled = isFeatureEnabled(Feature.TorBox);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const initialCollapseState = useMemo<CollapseState>(() => {
    return {
      torbox: !userPreferences?.torBoxApiToken,
      realDebrid: !userPreferences?.realDebridApiToken,
    };
  }, [userPreferences]);

  const [collapseState, setCollapseState] =
    useState<CollapseState>(initialCollapseState);

  const toggleSection = useCallback((section: keyof CollapseState) => {
    setCollapseState((prevState) => ({
      ...prevState,
      [section]: !prevState[section],
    }));
  }, []);

  return (
    <div className="settings-debrid">
      <p className="settings-debrid__description">{t("debrid_description")}</p>

      <div className="settings-debrid__section">
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={() => toggleSection("realDebrid")}
            aria-label={
              collapseState.realDebrid
                ? "Expand Real-Debrid section"
                : "Collapse Real-Debrid section"
            }
          >
            <span
              className={`settings-debrid__collapse-icon ${
                collapseState.realDebrid
                  ? ""
                  : "settings-debrid__collapse-icon--expanded"
              }`}
            >
              <ChevronRightIcon size={16} />
            </span>
          </button>
          <h3 className="settings-debrid__section-title">Real-Debrid</h3>
          {userPreferences?.realDebridApiToken && (
            <CheckCircleFillIcon
              size={16}
              className="settings-debrid__check-icon"
            />
          )}
        </div>

        {!collapseState.realDebrid && <SettingsRealDebrid />}
      </div>

      {isTorBoxEnabled && (
        <div className="settings-debrid__section">
          <div className="settings-debrid__section-header">
            <button
              type="button"
              className="settings-debrid__collapse-button"
              onClick={() => toggleSection("torbox")}
              aria-label={
                collapseState.torbox
                  ? "Expand TorBox section"
                  : "Collapse TorBox section"
              }
            >
              <span
                className={`settings-debrid__collapse-icon ${
                  collapseState.torbox
                    ? ""
                    : "settings-debrid__collapse-icon--expanded"
                }`}
              >
                <ChevronRightIcon size={16} />
              </span>
            </button>
            <h3 className="settings-debrid__section-title">TorBox</h3>
            {userPreferences?.torBoxApiToken && (
              <CheckCircleFillIcon
                size={16}
                className="settings-debrid__check-icon"
              />
            )}
          </div>

          {!collapseState.torbox && <SettingsTorBox />}
        </div>
      )}
    </div>
  );
}
