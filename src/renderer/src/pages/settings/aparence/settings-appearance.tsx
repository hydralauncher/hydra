import "./settings-appearance.scss";
import { ThemeActions } from "./index";

export const SettingsAppearance = () => {
  return (
    <div className="settings-appearance">
      <p className="settings-appearance__description">Appearance</p>

      <ThemeActions />
    </div>
  );
};
