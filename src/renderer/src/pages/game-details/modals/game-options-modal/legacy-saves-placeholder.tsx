import { useTranslation } from "react-i18next";

export function LegacySavesPlaceholder() {
  const { t } = useTranslation("game_details");

  return (
    <div className="game-options-modal__cloud-panel">
      <div className="game-options-modal__panel-header">
        <h2>{t("settings_category_legacy_saves")}</h2>
      </div>
    </div>
  );
}
