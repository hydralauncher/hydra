import { SettingsDebrid } from "./settings-debrid";

export function SettingsContextIntegrations() {
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>Debrid services</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
