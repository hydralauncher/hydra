import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsLocalApi } from "./settings-local-api";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteam } from "./settings-steam";
import { SettingsEpic } from "./settings-epic";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteam />
        <SettingsEpic />
        <SettingsRetroAchievements />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("local_api")}</h3>
        <SettingsLocalApi />
      </div>
    </div>
  );
}
