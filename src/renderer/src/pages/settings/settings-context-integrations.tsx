import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSelfHosted } from "./settings-self-hosted";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsRetroAchievements />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("self_hosted_server")}</h3>
        <SettingsSelfHosted />
      </div>
    </div>
  );
}
