import { useState, useCallback, useMemo } from "react";
import { useFeature, useAppSelector } from "@renderer/hooks";
import { SettingsTorBox } from "./settings-torbox";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsPremiumize } from "./settings-premiumize";
import { SettingsAllDebrid } from "./settings-all-debrid";
import { ChevronRightIcon, CheckCircleFillIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./settings-debrid.scss";

interface CollapseState {
  torbox: boolean;
  realDebrid: boolean;
  premiumize: boolean;
  allDebrid: boolean;
}

export function SettingsDebrid() {
  const { t } = useTranslation("settings");
  const { isFeatureEnabled, Feature } = useFeature();
  const isTorBoxEnabled = isFeatureEnabled(Feature.TorBox);
  const isPremiumizeEnabled = isFeatureEnabled(Feature.Premiumize);
  const isAllDebridEnabled = isFeatureEnabled(Feature.AllDebrid);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const initialCollapseState = useMemo<CollapseState>(() => {
    return {
      torbox: !userPreferences?.torBoxApiToken,
      realDebrid: !userPreferences?.realDebridApiToken,
      premiumize: !userPreferences?.premiumizeApiToken,
      allDebrid: !userPreferences?.allDebridApiToken,
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

      <div
        className={`settings-debrid__section ${
          collapseState.realDebrid ? "" : "settings-debrid__section--expanded"
        }`}
      >
        <div className="settings-debrid__section-header">
          <button
            type="button"
            className="settings-debrid__collapse-button"
            onClick={() => toggleSection("realDebrid")}
            aria-label={
              collapseState.realDebrid
                ? t("expand_debrid_section", {
                    provider: t("debrid_provider_real_debrid"),
                  })
                : t("collapse_debrid_section", {
                    provider: t("debrid_provider_real_debrid"),
                  })
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
          <h3 className="settings-debrid__section-title">
            {t("debrid_provider_real_debrid")}
          </h3>
          {userPreferences?.realDebridApiToken && (
            <CheckCircleFillIcon
              size={16}
              className="settings-debrid__check-icon"
            />
          )}
        </div>

        {!collapseState.realDebrid && <SettingsRealDebrid />}
      </div>

      {isPremiumizeEnabled && (
        <div
          className={`settings-debrid__section ${
            collapseState.premiumize ? "" : "settings-debrid__section--expanded"
          }`}
        >
          <div className="settings-debrid__section-header">
            <button
              type="button"
              className="settings-debrid__collapse-button"
              onClick={() => toggleSection("premiumize")}
              aria-label={
                collapseState.premiumize
                  ? t("expand_debrid_section", {
                      provider: t("debrid_provider_premiumize"),
                    })
                  : t("collapse_debrid_section", {
                      provider: t("debrid_provider_premiumize"),
                    })
              }
            >
              <span
                className={`settings-debrid__collapse-icon ${
                  collapseState.premiumize
                    ? ""
                    : "settings-debrid__collapse-icon--expanded"
                }`}
              >
                <ChevronRightIcon size={16} />
              </span>
            </button>
            <h3 className="settings-debrid__section-title">
              {t("debrid_provider_premiumize")}
            </h3>
            {userPreferences?.premiumizeApiToken && (
              <CheckCircleFillIcon
                size={16}
                className="settings-debrid__check-icon"
              />
            )}
          </div>

          {!collapseState.premiumize && <SettingsPremiumize />}
        </div>
      )}

      {isAllDebridEnabled && (
        <div
          className={`settings-debrid__section ${
            collapseState.allDebrid ? "" : "settings-debrid__section--expanded"
          }`}
        >
          <div className="settings-debrid__section-header">
            <button
              type="button"
              className="settings-debrid__collapse-button"
              onClick={() => toggleSection("allDebrid")}
              aria-label={
                collapseState.allDebrid
                  ? t("expand_debrid_section", {
                      provider: t("debrid_provider_alldebrid"),
                    })
                  : t("collapse_debrid_section", {
                      provider: t("debrid_provider_alldebrid"),
                    })
              }
            >
              <span
                className={`settings-debrid__collapse-icon ${
                  collapseState.allDebrid
                    ? ""
                    : "settings-debrid__collapse-icon--expanded"
                }`}
              >
                <ChevronRightIcon size={16} />
              </span>
            </button>
            <h3 className="settings-debrid__section-title">
              {t("debrid_provider_alldebrid")}
            </h3>
            {userPreferences?.allDebridApiToken && (
              <CheckCircleFillIcon
                size={16}
                className="settings-debrid__check-icon"
              />
            )}
          </div>

          {!collapseState.allDebrid && <SettingsAllDebrid />}
        </div>
      )}

      {isTorBoxEnabled && (
        <div
          className={`settings-debrid__section ${
            collapseState.torbox ? "" : "settings-debrid__section--expanded"
          }`}
        >
          <div className="settings-debrid__section-header">
            <button
              type="button"
              className="settings-debrid__collapse-button"
              onClick={() => toggleSection("torbox")}
              aria-label={
                collapseState.torbox
                  ? t("expand_debrid_section", {
                      provider: t("debrid_provider_torbox"),
                    })
                  : t("collapse_debrid_section", {
                      provider: t("debrid_provider_torbox"),
                    })
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
            <h3 className="settings-debrid__section-title">
              {t("debrid_provider_torbox")}
            </h3>
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
