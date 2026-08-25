import { useState, useCallback, useMemo } from "react";
import { useFeature, useAppSelector } from "@renderer/hooks";
import { SettingsTorBox } from "./settings-torbox";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsPremiumize } from "./settings-premiumize";
import { SettingsAllDebrid } from "./settings-all-debrid";
import { ChevronRightIcon } from "@primer/octicons-react";
import { CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./settings-debrid.scss";

interface CollapseState {
  torbox: boolean;
  realDebrid: boolean;
  premiumize: boolean;
  allDebrid: boolean;
}

interface DebridSectionProps {
  title: string;
  isConnected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function DebridSection({
  title,
  isConnected,
  isExpanded,
  onToggle,
  children,
}: Readonly<DebridSectionProps>) {
  const { t } = useTranslation("settings");

  return (
    <div
      className={`settings-debrid__section ${isConnected ? "settings-debrid__section--connected" : ""}`}
    >
      <div
        className="settings-debrid__section-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onToggle()}
        aria-expanded={isExpanded}
      >
        <button
          type="button"
          className="settings-debrid__collapse-button"
          aria-label={
            isExpanded
              ? t("collapse_debrid_section", { provider: title })
              : t("expand_debrid_section", { provider: title })
          }
        >
          <span
            className={`settings-debrid__collapse-icon ${isExpanded ? "settings-debrid__collapse-icon--expanded" : ""}`}
          >
            <ChevronRightIcon size={16} />
          </span>
        </button>

        <h3 className="settings-debrid__section-title">{title}</h3>

        {isConnected && (
          <CheckCircle size={14} className="settings-debrid__check-icon" />
        )}

        <span
          className={`settings-debrid__status-badge ${isConnected ? "settings-debrid__status-badge--connected" : "settings-debrid__status-badge--disconnected"}`}
        >
          {isConnected
            ? t("connected", { defaultValue: "Conectado" })
            : t("disconnected", { defaultValue: "Desconectado" })}
        </span>
      </div>

      {isExpanded && (
        <div className="settings-debrid__section-body">{children}</div>
      )}
    </div>
  );
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

      <DebridSection
        title={t("debrid_provider_real_debrid")}
        isConnected={!!userPreferences?.realDebridApiToken}
        isExpanded={!collapseState.realDebrid}
        onToggle={() => toggleSection("realDebrid")}
      >
        <SettingsRealDebrid />
      </DebridSection>

      {isPremiumizeEnabled && (
        <DebridSection
          title={t("debrid_provider_premiumize")}
          isConnected={!!userPreferences?.premiumizeApiToken}
          isExpanded={!collapseState.premiumize}
          onToggle={() => toggleSection("premiumize")}
        >
          <SettingsPremiumize />
        </DebridSection>
      )}

      {isAllDebridEnabled && (
        <DebridSection
          title={t("debrid_provider_alldebrid")}
          isConnected={!!userPreferences?.allDebridApiToken}
          isExpanded={!collapseState.allDebrid}
          onToggle={() => toggleSection("allDebrid")}
        >
          <SettingsAllDebrid />
        </DebridSection>
      )}

      {isTorBoxEnabled && (
        <DebridSection
          title={t("debrid_provider_torbox")}
          isConnected={!!userPreferences?.torBoxApiToken}
          isExpanded={!collapseState.torbox}
          onToggle={() => toggleSection("torbox")}
        >
          <SettingsTorBox />
        </DebridSection>
      )}
    </div>
  );
}
