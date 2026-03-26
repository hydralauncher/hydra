import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("integrations", { defaultValue: "Integrations" })}</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
